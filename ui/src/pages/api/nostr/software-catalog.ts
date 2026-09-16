import { isPublisherBlocklisted } from "@/lib/moderation/publisher-blocklist";
import {
  KIND_SOFTWARE_APPLICATION,
  KIND_SOFTWARE_RELEASE,
  type NostrEventLike,
  type ParsedSoftwareApp,
  type ParsedSoftwareRelease,
  appDedupKey,
  dedupeSoftwareApps,
  mergeSoftwareApps,
  parseSoftwareRelease,
  preferOwnerSoftwareApps,
  sortSoftwareAppsByCreatedAt,
} from "@/lib/nostr/nip82-software";
import { RELAY_ZAPSTORE } from "@/lib/nostr/software-catalog-relays";
import {
  loadSoftwareCatalogSnapshot,
  saveSoftwareCatalogSnapshot,
} from "@/lib/nostr/software-catalog-snapshot";

import type { NextApiRequest, NextApiResponse } from "next";

/**
 * Catalog scrape relays. Zapstore holds most NIP-82 apps; others are backups.
 * Do NOT finish on the first EOSE — relay.gittr.space EOSes empty in ~100ms and
 * would abort before Zapstore finishes (that bug returned apps:[] to /apps).
 */
const CATALOG_RELAYS = [
  RELAY_ZAPSTORE,
  "wss://nos.lol",
  "wss://relay.ngit.dev",
  "wss://relay.gittr.space",
];

const FETCH_MS = 20000;
/** Grace after Zapstore EOSE — do not start this on the first app event
 *  (relay.gittr.space can EOSE empty in ~100ms and starve Zapstore). */
const EARLY_EXIT_AFTER_ZAPSTORE_MS = 8000;

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
};

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
  authorHex?: string | null
): Promise<CatalogResponse> {
  const { RelayPool } = await import("nostr-relaypool");
  const pool = new RelayPool(CATALOG_RELAYS, { dontAutoReconnect: true });

  const rawApps: NostrEventLike[] = [];
  const releasesByApp = new Map<string, ParsedSoftwareRelease[]>();
  const releasesByAppId = new Map<string, ParsedSoftwareRelease[]>();
  const eoseRelays = new Set<string>();
  const authorScoped =
    !!authorHex && /^[0-9a-f]{64}$/i.test(authorHex)
      ? authorHex.toLowerCase()
      : null;
  // Profile pages only need one publisher — tiny limits + short timeout.
  const appLimit = authorScoped ? 80 : 4000;
  const releaseLimit = authorScoped ? 200 : 12000;
  const fetchMs = authorScoped ? 8000 : FETCH_MS;
  const earlyExitMs = authorScoped ? 2500 : EARLY_EXIT_AFTER_ZAPSTORE_MS;

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
      // Got apps from at least one relay — paint soon, keep listening briefly.
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
    if (authorScoped) {
      appFilter.authors = [authorScoped];
      releaseFilter.authors = [authorScoped];
      // Also apps that attribute this pubkey via NIP-82 `p` (not authored by them).
      filters.push({
        kinds: [KIND_SOFTWARE_APPLICATION],
        "#p": [authorScoped],
        limit: appLimit,
      });
    }

    pool.subscribe(
      filters,
      CATALOG_RELAYS,
      (event: NostrEventLike) => {
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
        // EOSE from one relay — keep waiting for others (Zapstore) until timeout.
        const url = catalogRelayUrl(relayInfo)
          .toLowerCase()
          .replace(/\/+$/, "");
        if (url) eoseRelays.add(url);
        if (!authorScoped && isZapstoreRelayUrl(url) && rawApps.length > 0) {
          maybeEarlyExit();
        }
        if (eoseRelays.size >= CATALOG_RELAYS.length && rawApps.length > 0) {
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
    // Owner's own 32267 wins over Zapstore `#p` republications of the same id.
    apps = preferOwnerSoftwareApps(apps, authorScoped);
  }
  apps = sortSoftwareAppsByCreatedAt(apps);

  const toRecord = (m: Map<string, ParsedSoftwareRelease[]>) => {
    const out: Record<string, ParsedSoftwareRelease[]> = {};
    for (const [k, v] of m) out[k] = v;
    return out;
  };

  return {
    apps,
    releasesByApp: toRecord(releasesByApp),
    releasesByAppId: toRecord(releasesByAppId),
    relayCount: CATALOG_RELAYS.length,
  };
}

const GLOBAL_CACHE_MS = 120_000;
let globalCache: { at: number; catalog: CatalogResponse } | null = null;
let globalInflight: Promise<CatalogResponse> | null = null;
let diskLoad: Promise<void> | null = null;

function mergeCatalogResponse(
  previous: CatalogResponse | null | undefined,
  incoming: CatalogResponse
): CatalogResponse {
  return {
    apps: mergeSoftwareApps(previous?.apps, incoming.apps),
    releasesByApp: mergeReleaseRecords(
      previous?.releasesByApp,
      incoming.releasesByApp
    ),
    releasesByAppId: mergeReleaseRecords(
      previous?.releasesByAppId,
      incoming.releasesByAppId
    ),
    relayCount: Math.max(previous?.relayCount || 0, incoming.relayCount || 0),
  };
}

async function ensureDiskCatalog(): Promise<void> {
  if (!diskLoad) {
    diskLoad = loadSoftwareCatalogSnapshot()
      .then((snap) => {
        if (!snap?.apps?.length || globalCache) return;
        globalCache = {
          at: snap.at,
          catalog: {
            apps: snap.apps,
            releasesByApp: snap.releasesByApp || {},
            releasesByAppId: snap.releasesByAppId || {},
            relayCount: snap.relayCount || CATALOG_RELAYS.length,
          },
        };
      })
      .catch(() => {
        /* ignore */
      });
  }
  await diskLoad;
}

async function getGlobalCatalog(): Promise<CatalogResponse> {
  await ensureDiskCatalog();
  const now = Date.now();
  if (globalCache && now - globalCache.at < GLOBAL_CACHE_MS) {
    return globalCache.catalog;
  }
  const stale = globalCache?.catalog;
  if (!globalInflight) {
    globalInflight = fetchCatalogFromRelays(null)
      .then((catalog) => {
        if (catalog.apps.length > 0) {
          const merged = mergeCatalogResponse(globalCache?.catalog, catalog);
          globalCache = { at: Date.now(), catalog: merged };
          void saveSoftwareCatalogSnapshot({
            at: globalCache.at,
            ...merged,
          }).catch(() => {
            /* ignore */
          });
          return merged;
        }
        return globalCache?.catalog ?? catalog;
      })
      .finally(() => {
        globalInflight = null;
      });
  }
  if (stale && stale.apps.length > 0) return stale;
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
      ? await fetchCatalogFromRelays(author)
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
          "public, s-maxage=120, stale-while-revalidate=300"
        );
      } else {
        res.setHeader("Cache-Control", "no-store");
      }
      return res.status(200).json({ apps, summary: true });
    }
    // Never CDN-cache an empty catalog — that made /apps stick on zero after a race.
    // Author-scoped responses are short-lived (profile paint).
    if (catalog.apps.length > 0) {
      res.setHeader(
        "Cache-Control",
        author
          ? "public, s-maxage=60, stale-while-revalidate=120"
          : "public, s-maxage=120, stale-while-revalidate=300"
      );
    } else {
      res.setHeader("Cache-Control", "no-store");
    }
    return res.status(200).json(catalog);
  } catch (e) {
    console.error("[software-catalog]", e);
    return res.status(500).json({
      error: "Failed to load software catalog from relays",
    });
  }
}
