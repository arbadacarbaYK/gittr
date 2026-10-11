/**
 * Short trust marks for the launcher tiles.
 * Distance is from the npub saved on the phone. Outside / self / failure
 * are omitted so a row never shows a fake badge.
 */
import {
  DEFAULT_WOT_MAX_HOPS,
  DEFAULT_WOT_ORACLE_URL,
  type WoTOracleDistanceResponse,
  hopsFromOracleBody,
  normalizeHexPubkey,
} from "../nostr/wot";

export type WidgetHopLookup = {
  ok: boolean;
  hops: number | null;
};

const CACHE_MS = 10 * 60 * 1000;
const hopCache = new Map<string, { hops: number | null; exp: number }>();

export function resetWidgetHopCacheForTests(): void {
  hopCache.clear();
}

/** Keep 1..n. Drop self (0), outside (null), and failed lookups. */
export function widgetHopMap(
  entries: Array<{ target: string; lookup: WidgetHopLookup }>
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const entry of entries) {
    const target = normalizeHexPubkey(entry.target);
    if (!target || !entry.lookup.ok) continue;
    const hops = entry.lookup.hops;
    if (hops == null || !Number.isInteger(hops) || hops < 1) continue;
    out[target] = hops;
  }
  return out;
}

async function mapPool<T>(
  items: T[],
  concurrency: number,
  budgetMs: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  if (items.length === 0) return;
  const deadline = Date.now() + budgetMs;
  let index = 0;
  const workers = Math.max(1, Math.min(concurrency, items.length));
  async function worker() {
    while (index < items.length && Date.now() < deadline) {
      const current = index++;
      const item = items[current];
      if (item === undefined || Date.now() >= deadline) return;
      await fn(item);
    }
  }
  await Promise.all(Array.from({ length: workers }, () => worker()));
}

export async function fetchWidgetHops(
  viewer: string,
  targets: string[],
  lookup?: (from: string, to: string) => Promise<WidgetHopLookup>
): Promise<Record<string, number>> {
  const from = normalizeHexPubkey(viewer);
  if (!from) return {};
  const unique = [
    ...new Set(
      targets
        .map((pk) => normalizeHexPubkey(pk))
        .filter((pk): pk is string => !!pk && pk !== from)
    ),
  ].slice(0, 16);
  if (unique.length === 0) return {};

  const now = Date.now();
  const pending: string[] = [];
  const entries: Array<{ target: string; lookup: WidgetHopLookup }> = [];
  for (const target of unique) {
    const hit = hopCache.get(`${from}:${target}`);
    if (hit && hit.exp > now) {
      entries.push({
        target,
        lookup: { ok: true, hops: hit.hops },
      });
    } else {
      pending.push(target);
    }
  }

  const resolve = lookup || fetchOracleHop;
  await mapPool(pending, 3, 7000, async (target) => {
    let result: WidgetHopLookup = { ok: false, hops: null };
    try {
      result = await resolve(from, target);
    } catch {
      result = { ok: false, hops: null };
    }
    if (result.ok) {
      hopCache.set(`${from}:${target}`, {
        hops: result.hops,
        exp: Date.now() + CACHE_MS,
      });
    }
    entries.push({ target, lookup: result });
  });

  return widgetHopMap(entries);
}

async function fetchOracleHop(
  from: string,
  to: string
): Promise<WidgetHopLookup> {
  const base = process.env.WOT_ORACLE_URL?.trim() || DEFAULT_WOT_ORACLE_URL;
  const url = new URL("/distance", base.endsWith("/") ? base : `${base}/`);
  url.searchParams.set("from", from);
  url.searchParams.set("to", to);
  url.searchParams.set("max_hops", String(DEFAULT_WOT_MAX_HOPS));
  const response = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(2500),
  });
  if (!response.ok) return { ok: false, hops: null };
  const body = (await response.json()) as WoTOracleDistanceResponse;
  return { ok: true, hops: hopsFromOracleBody(body) };
}
