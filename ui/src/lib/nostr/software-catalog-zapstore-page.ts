import { KIND_SOFTWARE_APPLICATION } from "./nip82-software";

/**
 * Zapstore’s relay scores kinds-only filters and CLOSED them as
 * "filters are too vague" when limit is 100+. limit 50 EOSes.
 * A single 4000-event REQ never reaches their catalog.
 */
export const ZAPSTORE_KIND_ONLY_PAGE_LIMIT = 50;
/** Newest pages to mix into the first /apps paint. */
export const ZAPSTORE_FIRST_WAVE_PAGES = 6;
/** Older pages walked with `until` in the background backfill. */
export const ZAPSTORE_BACKFILL_MAX_PAGES = 80;

export function nextUntilFromCreatedAts(
  createdAts: Array<number | undefined | null>
): number | null {
  let oldest = Infinity;
  for (const n of createdAts) {
    if (typeof n === "number" && Number.isFinite(n) && n < oldest) {
      oldest = n;
    }
  }
  if (!Number.isFinite(oldest)) return null;
  return oldest - 1;
}

/** Keep the oldest (smallest) `until` so a first-wave scrape cannot rewind a deep backfill. */
export function olderZapstoreUntil(
  a?: number | null,
  b?: number | null
): number | null {
  const nums = [a, b].filter(
    (n): n is number => typeof n === "number" && Number.isFinite(n)
  );
  if (nums.length === 0) return null;
  return Math.min(...nums);
}

/**
 * True when `until` sits in the middle of the union (a shallow first-wave
 * overwrite) so background paging must resume from the oldest stored app.
 */
export function zapstoreCursorNeedsResume(opts: {
  done?: boolean;
  until?: number | null;
  appCreatedAts: number[];
}): boolean {
  if (!opts.done) return true;
  const until = opts.until;
  if (until == null || opts.appCreatedAts.length === 0) return false;
  const older = opts.appCreatedAts.filter((at) => at < until).length;
  return older >= 20;
}

export function zapstoreUntilFromOldestApp(
  createdAts: Array<number | undefined | null>
): number | null {
  return nextUntilFromCreatedAts(createdAts);
}

export function zapstoreAppPageFilter(
  until?: number | null
): Record<string, unknown> {
  const filter: Record<string, unknown> = {
    kinds: [KIND_SOFTWARE_APPLICATION],
    limit: ZAPSTORE_KIND_ONLY_PAGE_LIMIT,
  };
  if (until != null && Number.isFinite(until)) {
    filter.until = until;
  }
  return filter;
}
