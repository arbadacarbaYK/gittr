import { parseContactListPubkeys } from "@/lib/nostr/contact-list";
import { fetchPrimalContactList } from "@/lib/nostr/primal-contact-list";
import { BoundedTtlCache } from "@/lib/utils/bounded-ttl-cache";

import type { NextApiRequest, NextApiResponse } from "next";

/**
 * Public kind-3 contact list for a profile (Following count).
 * Websocket relays often have nothing; Primal's HTTP cache still does.
 */

type ContactListPayload = {
  event: {
    pubkey: string;
    created_at?: number;
    kind: 3;
    tags: string[][];
    content?: string;
  } | null;
  following: number;
};

const memoryCache = new BoundedTtlCache<ContactListPayload>(60 * 1000, 2000);

function normalizePubkey(p: string): string | null {
  const s = String(p || "")
    .trim()
    .toLowerCase();
  return /^[0-9a-f]{64}$/.test(s) ? s : null;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const raw =
    req.method === "GET"
      ? req.query.pubkey
      : (req.body as { pubkey?: unknown })?.pubkey;
  const pubkey = normalizePubkey(typeof raw === "string" ? raw : "");
  if (!pubkey) {
    return res.status(400).json({ error: "pubkey required", following: 0 });
  }

  const hit = memoryCache.get(pubkey);
  if (hit) {
    res.setHeader(
      "Cache-Control",
      "public, s-maxage=60, stale-while-revalidate=300"
    );
    return res.status(200).json(hit);
  }

  try {
    const event = await fetchPrimalContactList(pubkey);
    const payload: ContactListPayload = event
      ? {
          event: {
            pubkey: event.pubkey,
            created_at: event.created_at,
            kind: 3,
            tags: event.tags,
            content: event.content,
          },
          following: parseContactListPubkeys(event).length,
        }
      : { event: null, following: 0 };
    memoryCache.set(pubkey, payload);
    res.setHeader(
      "Cache-Control",
      payload.event
        ? "public, s-maxage=60, stale-while-revalidate=300"
        : "no-store"
    );
    return res.status(200).json(payload);
  } catch (e) {
    console.warn("[api/nostr/contact-list] primal fetch failed:", e);
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ event: null, following: 0 });
  }
}
