import { applyKind0NameFields } from "@/lib/nostr/kind0-profile-fields";
import { fetchPrimalUserProfiles } from "@/lib/nostr/primal-user-profile";
import { BoundedTtlCache } from "@/lib/utils/bounded-ttl-cache";

import type { NextApiRequest, NextApiResponse } from "next";

/**
 * Batch kind-0 profile metadata for explore/home avatars.
 * Browser websocket subscriptions often stall; this HTTP path is the reliable source.
 */

type ProfileMeta = {
  picture?: string;
  name?: string;
  display_name?: string;
  about?: string;
  nip05?: string;
  lud16?: string;
  banner?: string;
  created_at?: number;
};

const RELAYS = [
  "wss://purplepag.es",
  "wss://user.kindpag.es",
  "wss://relay.gittr.space",
  "wss://nos.lol",
  "wss://relay.nostr.band",
  "wss://relay.primal.net",
  "wss://relay.noderunners.network",
];

/** Cap unique pubkey metas — unbounded Map grew under explore/home traffic. */
const memoryCache = new BoundedTtlCache<ProfileMeta | null>(60 * 1000, 4000);
const MAX_PUBKEYS = 80;

function normalizePubkey(p: string): string | null {
  const s = String(p || "")
    .trim()
    .toLowerCase();
  return /^[0-9a-f]{64}$/.test(s) ? s : null;
}

async function fetchProfilesBatch(
  pubkeys: string[]
): Promise<Record<string, ProfileMeta>> {
  const { RelayPool } = await import("nostr-relaypool");
  const pool = new RelayPool(RELAYS, { dontAutoReconnect: true });
  const out: Record<string, ProfileMeta> = {};
  const pending = new Set(pubkeys);

  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearInterval(early);
      try {
        pool.close();
      } catch {
        /* ignore */
      }
      resolve();
    };

    const timeout = setTimeout(finish, 8000);

    try {
      pool.subscribe(
        [{ kinds: [0], authors: pubkeys }],
        RELAYS,
        (event: any) => {
          if (!event || event.kind !== 0) return;
          const pk = String(event.pubkey || "").toLowerCase();
          if (!pending.has(pk)) return;
          try {
            const data = applyKind0NameFields(
              JSON.parse(event.content || "{}") as ProfileMeta
            );
            const existing = out[pk];
            if (
              !existing ||
              (event.created_at || 0) >= (existing.created_at || 0)
            ) {
              out[pk] = { ...data, created_at: event.created_at };
            }
          } catch {
            /* ignore bad content */
          }
        },
        undefined,
        () => {
          // EOSE from one relay — keep waiting for others until timeout
        }
      );
    } catch {
      finish();
    }

    // Resolve early if we got everything
    const early = setInterval(() => {
      if (Object.keys(out).length >= pubkeys.length) {
        finish();
      }
    }, 200);
  });

  return out;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST" && req.method !== "GET") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  let raw: string[] = [];
  if (req.method === "GET") {
    const q = req.query.pubkeys;
    if (typeof q === "string") raw = q.split(",");
    else if (Array.isArray(q)) raw = q.flatMap((x) => String(x).split(","));
  } else {
    const body = req.body;
    if (Array.isArray(body?.pubkeys)) raw = body.pubkeys;
    else if (typeof body?.pubkeys === "string") raw = body.pubkeys.split(",");
  }

  const pubkeys = [
    ...new Set(raw.map(normalizePubkey).filter((p): p is string => !!p)),
  ].slice(0, MAX_PUBKEYS);

  if (pubkeys.length === 0) {
    return res.status(400).json({ error: "pubkeys required", profiles: {} });
  }

  const profiles: Record<string, ProfileMeta> = {};
  const missing: string[] = [];

  for (const pk of pubkeys) {
    const hit = memoryCache.get(pk);
    if (hit !== undefined) {
      if (hit) profiles[pk] = hit;
    } else {
      missing.push(pk);
    }
  }

  if (missing.length > 0) {
    try {
      const fetched = await fetchProfilesBatch(missing);
      for (const pk of missing) {
        const meta = fetched[pk];
        if (meta) {
          memoryCache.set(pk, meta);
          profiles[pk] = meta;
        }
      }
    } catch (e) {
      console.warn("[api/nostr/profiles] batch fetch failed:", e);
    }
    const stillMissing = missing.filter((pk) => !profiles[pk]);
    if (stillMissing.length > 0) {
      try {
        const fromIndex = await fetchPrimalUserProfiles(stillMissing);
        for (const pk of stillMissing) {
          const meta = fromIndex[pk];
          if (!meta) continue;
          memoryCache.set(pk, meta);
          profiles[pk] = meta;
        }
      } catch (e) {
        console.warn("[api/nostr/profiles] primal fallback failed:", e);
      }
    }
  }

  const returned = Object.keys(profiles).length;
  // Never CDN-cache a miss — empty kind-0 used to stick as npub for minutes.
  res.setHeader(
    "Cache-Control",
    returned >= pubkeys.length
      ? "public, s-maxage=60, stale-while-revalidate=300"
      : "no-store"
  );
  return res.status(200).json({
    profiles,
    requested: pubkeys.length,
    returned,
  });
}
