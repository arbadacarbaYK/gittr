import { isPublisherBlocklisted } from "@/lib/moderation/publisher-blocklist";
import {
  KIND_SOFTWARE_APPLICATION,
  KIND_SOFTWARE_RELEASE,
  type NostrEventLike,
  type ParsedSoftwareApp,
  type ParsedSoftwareRelease,
  appDedupKey,
  collectNip09SoftwareDeletions,
  dedupeSoftwareApps,
  mergeDeletedEventAuthors,
  mergeSoftwareApps,
  omitDeletedSoftwareApps,
  parseSoftwareRelease,
  preferOwnerSoftwareApps,
  slimReleaseRecordsForCatalog,
  slimSoftwareAppForCatalog,
  sortSoftwareAppsByCreatedAt,
} from "@/lib/nostr/nip82-software";
import { RELAY_ZAPSTORE } from "@/lib/nostr/software-catalog-relays";
import {
  loadSoftwareCatalogSnapshot,
  saveSoftwareCatalogSnapshot,
} from "@/lib/nostr/software-catalog-snapshot";
import {
  ZAPSTORE_BACKFILL_MAX_PAGES,
  ZAPSTORE_FIRST_WAVE_PAGES,
  ZAPSTORE_KIND_ONLY_PAGE_LIMIT,
  nextUntilFromCreatedAts,
  olderZapstoreUntil,
  zapstoreAppPageFilter,
  zapstoreCursorNeedsResume,
  zapstoreUntilFromOldestApp,
} from "@/lib/nostr/software-catalog-zapstore-page";

import type { NextApiRequest, NextApiResponse } from "next";

export const config = {
  api: { responseLimit: false },
};

/**
 * Catalog scrape relays. Zapstore holds most NIP-82 apps; others are backups.
 * Do NOT finish on the first EOSE — relay.gittr.space EOSes empty in ~100ms and
 * would abort before Zapstore finishes (that bug returned apps:[] to /apps).
 *
 * Zapstore itself CLOSED kinds-only `limit: 4000` as "filters are too vague"
 * (limit 50 is the max that EOSes). That relay is paged separately.
 */
const CATALOG_RELAYS = [
  RELAY_ZAPSTORE,
  "wss://nos.lol",
  "wss://relay.ngit.dev",
  "wss://relay.gittr.space",
];

const OTHER_CATALOG_RELAYS = CATALOG_RELAYS.filter(
  (url) => !isZapstoreRelayUrl(url)
);

const FETCH_MS = 20000;
/** Grace after the first non-empty EOSE on backup relays. */
const EARLY_EXIT_AFTER_BACKUP_MS = 8000;

function catalogRelayUrl(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (raw && typeof raw === "object" && "url" in raw) {
    return String((raw as { url: string }).url || "");
  }
  return "";
}

function isZapstoreRelayUrl(url: string): boolean {
  return /relay\.zapstore\.dev/i.test(url);
}

function mergeReleaseRecords(
  previous: Record<string, ParsedSoftwareRelease[]> | undefined,
  incoming: Record<string, ParsedSoftwareRelease[]>
): Record<string, ParsedSoftwareRelease[]> {
  const out: Record<string, ParsedSoftwareRelease[]> = {};
  const keys = new Set([
    ...Object.keys(previous || {}),
    ...Object.keys(incoming || {}),
  ]);
  for (const key of keys) {
    const byD = new Map<string, ParsedSoftwareRelease>();
    for (const r of [...(previous?.[key] || []), ...(incoming[key] || [])]) {
      if (!r?.d) continue;
      const prev = byD.get(r.d);
      if (!prev || r.createdAt >= prev.createdAt) byD.set(r.d, r);
    }
    if (byD.size > 0) out[key] = Array.from(byD.values());
  }
  return out;
}

type CatalogResponse = {
  apps: ParsedSoftwareApp[];
  releasesByApp: Record<string, ParsedSoftwareRelease[]>;
  releasesByAppId: Record<string, ParsedSoftwareRelease[]>;
  relayCount: number;
  zapstoreUntil?: number | null;
  zapstoreBackfillDone?: boolean;
  deletedEventAuthors?: Record<string, string>;
  deletedAddressKeys?: string[];
};

function unionAddressKeys(
  a?: string[] | null,
  b?: string[] | null,
  cap = 8000
): string[] {
  const out = new Set<string>();
  for (const key of [...(a || []), ...(b || [])]) {
    const k = String(key || "").toLowerCase();
    if (!k) continue;
    out.add(k);
    if (out.size >= cap) break;
  }
  return [...out];
}

function omitDeletedReleaseRecords(
  rec: Record<string, ParsedSoftwareRelease[]> | undefined,
  authors: Record<string, string>,
  addressKeys: string[]
): Record<string, ParsedSoftwareRelease[]> {
  const addrs = new Set(addressKeys.map((k) => k.toLowerCase()));
  const out: Record<string, ParsedSoftwareRelease[]> = {};
  for (const [key, list] of Object.entries(rec || {})) {
    const kept = (list || []).filter((r) => {
      const id = (r.raw?.id || "").toLowerCase();
      const owner = (r.pubkey || "").toLowerCase();
      if (id && authors[id] === owner) return false;
      if (addrs.has(`30063:${owner}:${r.d}`.toLowerCase())) return false;
      return true;
    });
    if (kept.length > 0) out[key] = kept;
  }
  return out;
}

function slimCatalog(catalog: CatalogResponse): CatalogResponse {
  return {
    apps: (catalog.apps || []).map(slimSoftwareAppForCatalog),
    releasesByApp: slimReleaseRecordsForCatalog(catalog.releasesByApp),
    releasesByAppId: slimReleaseRecordsForCatalog(catalog.releasesByAppId),
    relayCount: catalog.relayCount,
    zapstoreUntil: catalog.zapstoreUntil ?? null,
    zapstoreBackfillDone: !!catalog.zapstoreBackfillDone,
    deletedEventAuthors: catalog.deletedEventAuthors || {},
    deletedAddressKeys: catalog.deletedAddressKeys || [],
  };
}

function upsertRelease(
  map: Map<string, ParsedSoftwareRelease[]>,
  key: string,
  r: ParsedSoftwareRelease
): void {
  const list = map.get(key) ?? [];
  const idx = list.findIndex((x) => x.d === r.d);
  if (idx === -1) {
    map.set(key, [...list, r]);
    return;
  }
  const prev = list[idx]!;
  const next = [...list];
  if (r.createdAt >= prev.createdAt) next[idx] = r;
  map.set(key, next);
}

async function fetchCatalogFromRelays(
  relays: string[],
  authorHex?: string | null
): Promise<CatalogResponse> {
  const { RelayPool } = await import("nostr-relaypool");
  const pool = new RelayPool(relays, { dontAutoReconnect: true });

  const rawApps: NostrEventLike[] = [];
  const releasesByApp = new Map<string, ParsedSoftwareRelease[]>();
  const releasesByAppId = new Map<string, ParsedSoftwareRelease[]>();
  const deletedEventAuthors = new Map<string, string>();
  const deletedAddressKeys = new Set<string>();
  const eoseRelays = new Set<string>();
  const authorScoped =
    !!authorHex && /^[0-9a-f]{64}$/i.test(authorHex)
      ? authorHex.toLowerCase()
      : null;
  // Profile pages only need one publisher — tiny limits + short timeout.
  const appLimit = authorScoped ? 80 : 4000;
  const releaseLimit = authorScoped ? 200 : 12000;
  const fetchMs = authorScoped ? 8000 : FETCH_MS;
  const earlyExitMs = authorScoped ? 2500 : EARLY_EXIT_AFTER_BACKUP_MS;

  await new Promise<void>((resolve) => {
    let settled = false;
    let earlyTimer: ReturnType<typeof setTimeout> | null = null;

    const finish = () => {
      if (settled) return;
      settled = true;
      if (earlyTimer) clearTimeout(earlyTimer);
      clearTimeout(hardTimer);
      resolve();
    };

    const hardTimer = setTimeout(finish, fetchMs);

    const maybeEarlyExit = () => {
      if (rawApps.length === 0) return;
      if (earlyTimer) return;
      earlyTimer = setTimeout(finish, earlyExitMs);
    };

    const appFilter: Record<string, unknown> = {
      kinds: [KIND_SOFTWARE_APPLICATION],
      limit: appLimit,
    };
    const releaseFilter: Record<string, unknown> = {
      kinds: [KIND_SOFTWARE_RELEASE],
      limit: releaseLimit,
    };
    const filters: Record<string, unknown>[] = [appFilter, releaseFilter];
    const deletionFilter: Record<string, unknown> = {
      kinds: [5],
      limit: authorScoped ? 200 : 2000,
    };
    if (authorScoped) {
      appFilter.authors = [authorScoped];
      releaseFilter.authors = [authorScoped];
      deletionFilter.authors = [authorScoped];
      filters.push({
        kinds: [KIND_SOFTWARE_APPLICATION],
        "#p": [authorScoped],
        limit: appLimit,
      });
    }
    filters.push(deletionFilter);

    pool.subscribe(
      filters,
      relays,
      (event: NostrEventLike) => {
        if (event.kind === 5) {
          const author = (event.pubkey || "").toLowerCase();
          if (!/^[0-9a-f]{64}$/.test(author)) return;
          const hits = collectNip09SoftwareDeletions(event);
          for (const id of hits.eventIds) {
            deletedEventAuthors.set(id, author);
          }
          for (const a of hits.addressKeys) deletedAddressKeys.add(a);
          return;
        }
        if (isPublisherBlocklisted(event.pubkey)) return;
        if (event.kind === KIND_SOFTWARE_APPLICATION) {
          rawApps.push(event);
          if (authorScoped) maybeEarlyExit();
          return;
        }
        if (event.kind === KIND_SOFTWARE_RELEASE) {
          const r = parseSoftwareRelease(event);
          if (!r) return;
          upsertRelease(releasesByApp, appDedupKey(r.pubkey, r.appId), r);
          upsertRelease(releasesByAppId, r.appId, r);
        }
      },
      undefined,
      (relayInfo) => {
        const url = catalogRelayUrl(relayInfo)
          .toLowerCase()
          .replace(/\/+$/, "");
        if (url) eoseRelays.add(url);
        if (!authorScoped && rawApps.length > 0) {
          maybeEarlyExit();
        }
        if (eoseRelays.size >= relays.length && rawApps.length > 0) {
          finish();
        }
      }
    );
  });

  try {
    pool.close();
  } catch {
    // ignore
  }

  const appMap = dedupeSoftwareApps(rawApps);
  let apps = Array.from(appMap.values());
  if (authorScoped) {
    apps = preferOwnerSoftwareApps(apps, authorScoped);
  }
  apps = sortSoftwareAppsByCreatedAt(apps);
  const deletionAuthors = Object.fromEntries(deletedEventAuthors);
  const deletionAddrs = [...deletedAddressKeys];
  apps = omitDeletedSoftwareApps(apps, deletionAuthors, deletionAddrs);

  const toRecord = (m: Map<string, ParsedSoftwareRelease[]>) => {
    const out: Record<string, ParsedSoftwareRelease[]> = {};
    for (const [k, v] of m) out[k] = v;
    return out;
  };

  return {
    apps,
    releasesByApp: omitDeletedReleaseRecords(
      toRecord(releasesByApp),
      deletionAuthors,
      deletionAddrs
    ),
    releasesByAppId: omitDeletedReleaseRecords(
      toRecord(releasesByAppId),
      deletionAuthors,
      deletionAddrs
    ),
    relayCount: relays.length,
    deletedEventAuthors: deletionAuthors,
    deletedAddressKeys: deletionAddrs,
  };
}

async function fetchZapstoreAppPages(opts: {
  startUntil?: number | null;
  maxPages: number;
}): Promise<{
  apps: ParsedSoftwareApp[];
  nextUntil: number | null;
  done: boolean;
  pages: number;
}> {
  const { RelayPool } = await import("nostr-relaypool");
  let until =
    opts.startUntil != null && Number.isFinite(opts.startUntil)
      ? opts.startUntil
      : undefined;
  const collected: ParsedSoftwareApp[] = [];
  let done = false;
  let pages = 0;

  for (let i = 0; i < opts.maxPages; i++) {
    const pool = new RelayPool([RELAY_ZAPSTORE], { dontAutoReconnect: true });
    const rawApps: NostrEventLike[] = [];
    try {
      await new Promise<void>((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          clearTimeout(hardTimer);
          resolve();
        };
        const hardTimer = setTimeout(finish, 8000);
        pool.subscribe(
          [zapstoreAppPageFilter(until)],
          [RELAY_ZAPSTORE],
          (event: NostrEventLike) => {
            if (isPublisherBlocklisted(event.pubkey)) return;
            if (event.kind === KIND_SOFTWARE_APPLICATION) {
              rawApps.push(event);
            }
          },
          undefined,
          () => finish()
        );
      });
    } finally {
      try {
        pool.close();
      } catch {
        // ignore
      }
    }

    if (rawApps.length === 0) {
      done = true;
      break;
    }
    pages++;
    collected.push(...Array.from(dedupeSoftwareApps(rawApps).values()));
    const next = nextUntilFromCreatedAts(rawApps.map((e) => e.created_at));
    if (next == null) {
      done = true;
      break;
    }
    if (until != null && next >= until) {
      done = true;
      break;
    }
    until = next;
    if (rawApps.length < ZAPSTORE_KIND_ONLY_PAGE_LIMIT) {
      done = true;
      break;
    }
  }

  return {
    apps: mergeSoftwareApps([], collected),
    nextUntil: until ?? null,
    done,
    pages,
  };
}

const GLOBAL_CACHE_MS = 120_000;
let globalCache: { at: number; catalog: CatalogResponse } | null = null;
let globalInflight: Promise<CatalogResponse> | null = null;
let diskLoad: Promise<void> | null = null;
let zapstoreBackfillInflight: Promise<void> | null = null;

function mergeCatalogResponse(
  previous: CatalogResponse | null | undefined,
  incoming: CatalogResponse
): CatalogResponse {
  const deletedEventAuthors = mergeDeletedEventAuthors(
    previous?.deletedEventAuthors,
    incoming.deletedEventAuthors
  );
  const deletedAddressKeys = unionAddressKeys(
    previous?.deletedAddressKeys,
    incoming.deletedAddressKeys
  );
  const until = olderZapstoreUntil(
    previous?.zapstoreUntil,
    incoming.zapstoreUntil
  );
  const zapstoreBackfillDone = incoming.zapstoreBackfillDone
    ? true
    : !!previous?.zapstoreBackfillDone &&
      until === (previous?.zapstoreUntil ?? until);
  return {
    apps: omitDeletedSoftwareApps(
      mergeSoftwareApps(previous?.apps, incoming.apps),
      deletedEventAuthors,
      deletedAddressKeys
    ),
    releasesByApp: omitDeletedReleaseRecords(
      mergeReleaseRecords(previous?.releasesByApp, incoming.releasesByApp),
      deletedEventAuthors,
      deletedAddressKeys
    ),
    releasesByAppId: omitDeletedReleaseRecords(
      mergeReleaseRecords(previous?.releasesByAppId, incoming.releasesByAppId),
      deletedEventAuthors,
      deletedAddressKeys
    ),
    relayCount: Math.max(previous?.relayCount || 0, incoming.relayCount || 0),
    zapstoreUntil: until,
    zapstoreBackfillDone,
    deletedEventAuthors,
    deletedAddressKeys,
  };
}

function repairZapstoreCursor(catalog: CatalogResponse): CatalogResponse {
  const created = (catalog.apps || []).map((a) => a.createdAt);
  if (
    !catalog.zapstoreBackfillDone ||
    !zapstoreCursorNeedsResume({
      done: true,
      until: catalog.zapstoreUntil,
      appCreatedAts: created,
    })
  ) {
    return catalog;
  }
  return {
    ...catalog,
    zapstoreUntil:
      zapstoreUntilFromOldestApp(created) ?? catalog.zapstoreUntil ?? null,
    zapstoreBackfillDone: false,
  };
}

function persistCatalog(catalog: CatalogResponse): CatalogResponse {
  const slim = slimCatalog(catalog);
  globalCache = { at: Date.now(), catalog: slim };
  void saveSoftwareCatalogSnapshot({
    at: globalCache.at,
    ...slim,
  }).catch(() => {
    /* ignore */
  });
  return slim;
}

async function ensureDiskCatalog(): Promise<void> {
  if (!diskLoad) {
    diskLoad = loadSoftwareCatalogSnapshot()
      .then((snap) => {
        if (!snap?.apps?.length || globalCache) return;
        globalCache = {
          at: snap.at,
          catalog: repairZapstoreCursor({
            apps: omitDeletedSoftwareApps(
              snap.apps,
              snap.deletedEventAuthors || {},
              snap.deletedAddressKeys || []
            ),
            releasesByApp: snap.releasesByApp || {},
            releasesByAppId: snap.releasesByAppId || {},
            relayCount: snap.relayCount || CATALOG_RELAYS.length,
            zapstoreUntil: snap.zapstoreUntil ?? null,
            zapstoreBackfillDone: !!snap.zapstoreBackfillDone,
            deletedEventAuthors: snap.deletedEventAuthors || {},
            deletedAddressKeys: snap.deletedAddressKeys || [],
          }),
        };
      })
      .catch(() => {
        /* ignore */
      });
  }
  await diskLoad;
}

function startZapstoreBackfill(): void {
  const current = globalCache?.catalog;
  if (!current || current.zapstoreBackfillDone) return;
  if (zapstoreBackfillInflight) return;
  zapstoreBackfillInflight = (async () => {
    let fetched = 0;
    while (fetched < ZAPSTORE_BACKFILL_MAX_PAGES) {
      const until = globalCache?.catalog.zapstoreUntil ?? null;
      const remaining = ZAPSTORE_BACKFILL_MAX_PAGES - fetched;
      const page = await fetchZapstoreAppPages({
        startUntil: until,
        maxPages: Math.min(8, remaining),
      });
      fetched += page.pages || 1;
      if (page.apps.length > 0) {
        persistCatalog(
          mergeCatalogResponse(globalCache?.catalog, {
            apps: page.apps,
            releasesByApp: {},
            releasesByAppId: {},
            relayCount: CATALOG_RELAYS.length,
            zapstoreUntil: page.nextUntil,
            zapstoreBackfillDone: page.done,
          })
        );
      } else if (page.done) {
        persistCatalog({
          ...(globalCache?.catalog || {
            apps: [],
            releasesByApp: {},
            releasesByAppId: {},
            relayCount: CATALOG_RELAYS.length,
          }),
          zapstoreUntil: page.nextUntil,
          zapstoreBackfillDone: true,
        });
        break;
      }
      if (page.done) break;
    }
  })()
    .catch(() => {
      /* ignore */
    })
    .finally(() => {
      zapstoreBackfillInflight = null;
    });
}

async function scrapeGlobalCatalog(): Promise<CatalogResponse> {
  const [others, zap] = await Promise.all([
    fetchCatalogFromRelays(OTHER_CATALOG_RELAYS, null),
    fetchZapstoreAppPages({ maxPages: ZAPSTORE_FIRST_WAVE_PAGES }),
  ]);
  const incoming = mergeCatalogResponse(others, {
    apps: zap.apps,
    releasesByApp: {},
    releasesByAppId: {},
    relayCount: CATALOG_RELAYS.length,
    zapstoreUntil: zap.nextUntil,
    zapstoreBackfillDone: zap.done,
  });
  const merged = mergeCatalogResponse(globalCache?.catalog, incoming);
  return persistCatalog(merged);
}

async function getGlobalCatalog(): Promise<CatalogResponse> {
  await ensureDiskCatalog();
  if (globalCache?.catalog) {
    const repaired = repairZapstoreCursor(globalCache.catalog);
    if (
      repaired.zapstoreBackfillDone !==
        globalCache.catalog.zapstoreBackfillDone ||
      repaired.zapstoreUntil !== globalCache.catalog.zapstoreUntil
    ) {
      globalCache.catalog = repaired;
    }
  }
  const now = Date.now();
  if (globalCache && now - globalCache.at < GLOBAL_CACHE_MS) {
    if (!globalCache.catalog.zapstoreBackfillDone) {
      startZapstoreBackfill();
    }
    return globalCache.catalog;
  }
  const stale = globalCache?.catalog;
  if (!globalInflight) {
    globalInflight = scrapeGlobalCatalog()
      .then((catalog) => {
        if (catalog.apps.length > 0) {
          if (!catalog.zapstoreBackfillDone) startZapstoreBackfill();
          return catalog;
        }
        return globalCache?.catalog ?? catalog;
      })
      .finally(() => {
        globalInflight = null;
      });
  }
  if (stale && stale.apps.length > 0) {
    // First-wave scrape is already in flight — do not also walk Zapstore
    // from the top (limit 50 newest) in parallel with that.
    return stale;
  }
  return globalInflight;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const authorRaw = req.query.author;
    const author =
      typeof authorRaw === "string" && /^[0-9a-f]{64}$/i.test(authorRaw)
        ? authorRaw.toLowerCase()
        : null;
    const summary = req.query.summary === "1" || req.query.summary === "true";
    const catalog = author
      ? await fetchCatalogFromRelays(CATALOG_RELAYS, author)
      : await getGlobalCatalog();
    if (summary && !author) {
      const apps = sortSoftwareAppsByCreatedAt(catalog.apps)
        .slice(0, 12)
        .map((a) => ({
          pubkey: a.pubkey,
          appId: a.appId,
          name: a.name,
          createdAt: a.createdAt,
          gittrRepoPath: a.gittrRepoPath,
        }));
      if (apps.length > 0) {
        res.setHeader(
          "Cache-Control",
          "public, s-maxage=30, stale-while-revalidate=120"
        );
      } else {
        res.setHeader("Cache-Control", "no-store");
      }
      return res.status(200).json({ apps, summary: true });
    }
    if (catalog.apps.length > 0) {
      res.setHeader(
        "Cache-Control",
        author ? "public, s-maxage=60, stale-while-revalidate=120" : "no-store"
      );
    } else {
      res.setHeader("Cache-Control", "no-store");
    }
    if (author) {
      return res.status(200).json(catalog);
    }
    return res.status(200).json({
      ...slimCatalog(catalog),
      backfilling:
        !catalog.zapstoreBackfillDone || zapstoreBackfillInflight != null,
    });
  } catch (e) {
    console.error("[software-catalog]", e);
    return res.status(500).json({
      error: "Failed to load software catalog from relays",
    });
  }
}
