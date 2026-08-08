/**
 * Browser-safe check: can this NIP-34 repo identifier (d tag) ever resolve to
 * a gittr repo page? Foreign clients sometimes announce their internal storage
 * paths (e.g. "<pubkey-hex>/name") or other junk as the identifier — those can
 * never work on our routes, bridge, or GRASP mirrors, so listings should skip
 * them and the repo page should show a notice instead of probing git servers.
 *
 * Deliberately looser than the bridge's sanitizeBridgeRepoName (dots stay
 * allowed — upstream repos like "next.js" are viewable via their mirrors).
 */
export function isRenderableRepoName(raw: string | null | undefined): boolean {
  let s = String(raw ?? "").trim();
  if (!s) return false;
  try {
    s = decodeURIComponent(s);
  } catch {
    /* keep as-is */
  }
  s = s.trim();
  if (!s || s.length > 200) return false;
  // Slash, backslash, control chars break routing and on-disk repo paths.
  if (/[\0\x01-\x1f\\/]/.test(s)) return false;
  if (s.includes("..")) return false;
  return true;
}
