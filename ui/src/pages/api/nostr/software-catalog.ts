import type { NextApiRequest, NextApiResponse } from "next";

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

const CATALOG_RELAYS = [
  RELAY_ZAPSTORE,
  "wss://relay.damus.io",
  "wss://nos.lol",
];

const FETCH_MS = 20000;

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

  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const timer = setTimeout(finish, FETCH_MS);

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
      () => {
        clearTimeout(timer);
        finish();
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
    res.setHeader(
      "Cache-Control",
      "public, s-maxage=120, stale-while-revalidate=300"
    );
    return res.status(200).json(catalog);
  } catch (e) {
    console.error("[software-catalog]", e);
    return res.status(500).json({
      error: "Failed to load software catalog from relays",
    });
  }
}
