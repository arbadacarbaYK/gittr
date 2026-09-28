/**
 * When to hide the Explore "syncing" banner.
 * Seed / localStorage rows must not look like a finished Nostr catalog.
 */
export const EXPLORE_LIVE_SAMPLE_TO_HIDE_SYNC = 40;

export function liveExploreNostrCount(
  repos: Array<{ syncedFromNostr?: boolean; lastNostrEventId?: string }>
): number {
  return repos.filter((r) => r.syncedFromNostr || r.lastNostrEventId).length;
}

/** True only when live relay events (not SEO seed / LS leftovers) filled in. */
export function shouldHideExploreSyncForCatalog(
  repos: Array<{ syncedFromNostr?: boolean; lastNostrEventId?: string }>
): boolean {
  return liveExploreNostrCount(repos) >= EXPLORE_LIVE_SAMPLE_TO_HIDE_SYNC;
}

/**
 * Keep the relay sweep visible when this visit opened with ?q= or ?user=.
 * A full catalog of unrelated names used to hide sync immediately, so a
 * search from Home said "nothing found" before seed or relays could match.
 */
export function shouldKeepExploreSyncIndicator(opts: {
  alreadyHasCatalog: boolean;
  hasSearch: boolean;
}): boolean {
  if (opts.hasSearch) return true;
  return !opts.alreadyHasCatalog;
}
