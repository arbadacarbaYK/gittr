/**
 * Normalize repo name for git-nostr-bridge paths (clone + files APIs).
 * Query/body may still carry URL encoding (e.g. Venue%20Scheduler).
 */
export function sanitizeBridgeRepoName(raw: string): string {
  let s = raw.trim();
  if (!s) return s;
  try {
    s = decodeURIComponent(s);
  } catch {
    /* keep as-is */
  }
  return s.trim();
}
