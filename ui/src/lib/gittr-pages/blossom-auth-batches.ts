/**
 * Blossom auth (kind 24242) travels base64-encoded in the `Authorization`
 * header of every PUT/DELETE. Each `x` tag adds ~100 header bytes, and nginx
 * rejects a header over 8 KB ("400 Request Header Or Cookie Too Large"), which
 * one event for a whole site hits at ~75 files. Sign one event per batch.
 */
export const BLOSSOM_AUTH_MAX_HASHES = 50;

/** Distinct lowercase hashes, split into batches for one auth event each. */
export function blossomAuthHashBatches(
  sha256Hex: string[],
  maxPerBatch: number = BLOSSOM_AUTH_MAX_HASHES
): string[][] {
  const size = Math.max(1, Math.floor(maxPerBatch));
  const uniq = Array.from(
    new Set(sha256Hex.map((h) => String(h).toLowerCase()))
  );
  const batches: string[][] = [];
  for (let i = 0; i < uniq.length; i += size) {
    batches.push(uniq.slice(i, i + size));
  }
  return batches;
}
