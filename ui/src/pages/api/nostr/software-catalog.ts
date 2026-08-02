import { isPublisherBlocklisted } from "@/lib/moderation/publisher-blocklist";
import {
  KIND_SOFTWARE_APPLICATION,
  KIND_SOFTWARE_RELEASE,
  type NostrEventLike,
  type ParsedSoftwareApp,
  type ParsedSoftwareRelease,
  appDedupKey,
  dedupeSoftwareApps,
  parseSoftwareRelease,
} from "@/lib/nostr/nip82-software";
import { RELAY_ZAPSTORE } from "@/lib/nostr/software-catalog-relays";

import type { NextApiRequest, NextApiResponse } from "next";

/**
 * Catalog scrape relays. Zapstore holds most NIP-82 apps; others are backups.
 * Do NOT finish on the first EOSE — relay.gittr.space EOSes empty in ~100ms and
 * would abort before Zapstore finishes (that bug returned apps:[] to /apps).
 */
const CATALOG_RELAYS = [
  RELAY_ZAPSTORE,
  "wss://nos.lol",
  "wss://relay.damus.io",
  "wss://relay.gittr.space",
];

const FETCH_MS = 20000;
/** Once we have apps, don't wait the full 20s for stragglers. */
const EARLY_EXIT_AFTER_APPS_MS = 8000;

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

async function fetchCatalogFromRelays(): Promise<CatalogResponse> {
  const { RelayPool } = await import("nostr-relaypool");
  const pool = new RelayPool(CATALOG_RELAYS);

  const rawApps: NostrEventLike[] = [];
  const releasesByApp = new Map<string, ParsedSoftwareRelease[]>();
  const releasesByAppId = new Map<string, ParsedSoftwareRelease[]>();
  const eoseRelays = new Set<string>();

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

    const hardTimer = setTimeout(finish, FETCH_MS);

    const maybeEarlyExit = () => {
      if (rawApps.length === 0) return;
      if (earlyTimer) return;
      // Got apps from at least one relay — paint soon, keep listening briefly.
      earlyTimer = setTimeout(finish, EARLY_EXIT_AFTER_APPS_MS);
    };

    pool.subscribe(
      [
        { kinds: [KIND_SOFTWARE_APPLICATION], limit: 4000 },
        { kinds: [KIND_SOFTWARE_RELEASE], limit: 12000 },
      ],
      CATALOG_RELAYS,
      (event: NostrEventLike) => {
        if (isPublisherBlocklisted(event.pubkey)) return;
        if (event.kind === KIND_SOFTWARE_APPLICATION) {
          rawApps.push(event);
          maybeEarlyExit();
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
        const url =
          typeof relayInfo === "string"
            ? relayInfo
            : relayInfo &&
              typeof relayInfo === "object" &&
              "url" in (relayInfo as object)
            ? String((relayInfo as { url: string }).url || "")
            : "";
        if (url) eoseRelays.add(url.toLowerCase().replace(/\/+$/, ""));
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
  const apps = Array.from(appMap.values()).sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
  );

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

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const catalog = await fetchCatalogFromRelays();
    // Never CDN-cache an empty catalog — that made /apps stick on zero after a race.
    if (catalog.apps.length > 0) {
      res.setHeader(
        "Cache-Control",
        "public, s-maxage=120, stale-while-revalidate=300"
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
