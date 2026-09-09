/**
 * Nostr `created_at` is seconds. Cached Explore rows sometimes stored
 * Date.now() milliseconds, which then beat every real event in comparisons.
 */
export function nostrTimestampToSeconds(
  value: number | null | undefined
): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return 0;
  }
  const sec = value > 1e12 ? Math.floor(value / 1000) : Math.floor(value);
  const nowSec = Math.floor(Date.now() / 1000);
  if (sec > nowSec + 120) return 0;
  return sec;
}

export function nostrTimestampToMs(value: number | null | undefined): number {
  const sec = nostrTimestampToSeconds(value);
  return sec > 0 ? sec * 1000 : 0;
}
