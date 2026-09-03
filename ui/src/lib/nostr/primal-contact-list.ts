/**
 * Primal cache HTTP contact lists (NIP-02 kind 3).
 *
 * Many pubkeys never publish kind 3 to the websocket relays gittr scrapes
 * (including their own NIP-65 list). Primal still indexes the list and
 * returns it from POST ["contact_list", { pubkey }].
 */

export type PrimalContactListEvent = {
  id?: string;
  pubkey: string;
  created_at?: number;
  kind: 3;
  tags: string[][];
  content?: string;
};

const PRIMAL_CACHE_URLS = [
  "https://cache1.primal.net/api",
  "https://cache2.primal.net/api",
];

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asTags(value: unknown): string[][] {
  if (!Array.isArray(value)) return [];
  const out: string[][] = [];
  for (const tag of value) {
    if (!Array.isArray(tag) || typeof tag[0] !== "string") continue;
    out.push(tag.map((part) => String(part)));
  }
  return out;
}

function walkForKind3(
  value: unknown,
  pubkey: string,
  found: PrimalContactListEvent[]
): void {
  if (Array.isArray(value)) {
    for (const item of value) walkForKind3(item, pubkey, found);
    return;
  }
  const obj = asObject(value);
  if (!obj) return;
  const kind = obj.kind;
  const pk = String(obj.pubkey || "").toLowerCase();
  if (kind === 3 && pk === pubkey) {
    found.push({
      id: typeof obj.id === "string" ? obj.id : undefined,
      pubkey: pk,
      created_at:
        typeof obj.created_at === "number" ? obj.created_at : undefined,
      kind: 3,
      tags: asTags(obj.tags),
      content: typeof obj.content === "string" ? obj.content : "",
    });
    return;
  }
  for (const v of Object.values(obj)) {
    if (v && typeof v === "object") walkForKind3(v, pubkey, found);
  }
}

/** Parse Primal cache HTTP body into the newest kind-3 for `pubkey`. */
export function extractKind3FromPrimalBody(
  text: string,
  pubkey: string
): PrimalContactListEvent | null {
  const pk = pubkey.toLowerCase();
  const found: PrimalContactListEvent[] = [];
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    walkForKind3(JSON.parse(trimmed), pk, found);
  } catch {
    for (const chunk of trimmed.split(/\n+/)) {
      const line = chunk.trim();
      if (!line) continue;
      try {
        walkForKind3(JSON.parse(line), pk, found);
      } catch {
        /* ignore */
      }
    }
  }
  if (found.length === 0) return null;
  found.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
  return found[0] || null;
}

/**
 * HTTP fallback when websocket kind-3 scrape is empty.
 * Same index njump/Primal use for follow graphs that never hit NIP-01 relays.
 */
export async function fetchPrimalContactList(
  pubkey: string,
  signal?: AbortSignal
): Promise<PrimalContactListEvent | null> {
  const pk = pubkey.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(pk)) return null;
  const body = JSON.stringify(["contact_list", { pubkey: pk }]);
  for (const url of PRIMAL_CACHE_URLS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal,
      });
      if (!res.ok) continue;
      const text = await res.text();
      const event = extractKind3FromPrimalBody(text, pk);
      if (event) return event;
    } catch {
      /* try next cache host */
    }
  }
  return null;
}
