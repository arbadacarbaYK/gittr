import { applyKind0NameFields } from "./kind0-profile-fields";

export type PrimalKind0Meta = {
  name?: string;
  display_name?: string;
  picture?: string;
  about?: string;
  nip05?: string;
  lud16?: string;
  banner?: string;
  website?: string;
  created_at?: number;
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

function walkForKind0(
  value: unknown,
  pubkey: string,
  found: PrimalKind0Meta[]
): void {
  if (Array.isArray(value)) {
    for (const item of value) walkForKind0(item, pubkey, found);
    return;
  }
  const obj = asObject(value);
  if (!obj) return;
  const kind = obj.kind;
  const pk = String(obj.pubkey || "").toLowerCase();
  if (kind === 0 && pk === pubkey) {
    try {
      const content =
        typeof obj.content === "string"
          ? JSON.parse(obj.content || "{}")
          : obj.content;
      const data = applyKind0NameFields(
        asObject(content) || {}
      ) as PrimalKind0Meta;
      data.created_at =
        typeof obj.created_at === "number" ? obj.created_at : undefined;
      found.push(data);
    } catch {
      /* ignore */
    }
    return;
  }
  for (const v of Object.values(obj)) {
    if (v && typeof v === "object") walkForKind0(v, pubkey, found);
  }
}

/** Parse Primal cache HTTP body (JSON array or concatenated events) into kind 0. */
export function extractKind0FromPrimalBody(
  text: string,
  pubkey: string
): PrimalKind0Meta | null {
  const pk = pubkey.toLowerCase();
  const found: PrimalKind0Meta[] = [];
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    walkForKind0(JSON.parse(trimmed), pk, found);
  } catch {
    for (const chunk of trimmed.split(/\n+/)) {
      const line = chunk.trim();
      if (!line) continue;
      try {
        walkForKind0(JSON.parse(line), pk, found);
      } catch {
        /* ignore */
      }
    }
  }
  if (found.length === 0) return null;
  found.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
  return found[0] || null;
}

async function fetchOnePrimalProfile(
  pubkey: string,
  signal: AbortSignal
): Promise<PrimalKind0Meta | null> {
  const body = JSON.stringify(["user_profile", { pubkey }]);
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
      const meta = extractKind0FromPrimalBody(text, pubkey);
      if (meta) return meta;
    } catch {
      /* try next cache host */
    }
  }
  return null;
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]!);
    }
  }
  const n = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return out;
}

/**
 * HTTP fallback when websocket kind-0 scrape misses (same index njump/Primal use).
 * Caps work so Explore batches cannot fan out unbounded.
 */
export async function fetchPrimalUserProfiles(
  pubkeys: string[]
): Promise<Record<string, PrimalKind0Meta>> {
  const unique = [
    ...new Set(
      pubkeys
        .map((p) => p.toLowerCase())
        .filter((p) => /^[0-9a-f]{64}$/.test(p))
    ),
  ].slice(0, 24);
  if (unique.length === 0) return {};

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 8000);
  try {
    const rows = await mapPool(unique, 4, (pk) =>
      fetchOnePrimalProfile(pk, ac.signal)
    );
    const out: Record<string, PrimalKind0Meta> = {};
    unique.forEach((pk, idx) => {
      const meta = rows[idx];
      if (meta) out[pk] = meta;
    });
    return out;
  } finally {
    clearTimeout(timer);
  }
}
