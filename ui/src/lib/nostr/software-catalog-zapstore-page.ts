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
