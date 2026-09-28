/**
 * Explore filters from the address bar.
 *
 * The page must not call useSearchParams(): that suspended the whole catalog
 * behind a black "Loading..." until the bundle finished. The header search
 * publishes this event on the same page (router.replace does not remount
 * Explore and does not fire popstate). A full load — Home → Explore, or a
 * refresh of /explore?q= — reads window.location in a layout effect.
 */

export const EXPLORE_SEARCH_CHANGED = "gittr:explore-search";

export type ExploreSearchState = {
  q: string;
  user: string | null;
};

export function parseExploreSearch(search: string): ExploreSearchState {
  const raw = search.startsWith("?") ? search.slice(1) : search;
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(raw);
  } catch {
    return { q: "", user: null };
  }
  const q = (params.get("q") || "").trim();
  const user = (params.get("user") || "").trim();
  return { q, user: user || null };
}

export function publishExploreSearch(next: ExploreSearchState): void {
  if (typeof window === "undefined") return;
  const detail = parseExploreSearch(
    `?${new URLSearchParams({
      ...(next.q?.trim() ? { q: next.q.trim() } : {}),
      ...(next.user?.trim() ? { user: next.user.trim() } : {}),
    }).toString()}`
  );
  window.dispatchEvent(
    new CustomEvent<ExploreSearchState>(EXPLORE_SEARCH_CHANGED, { detail })
  );
}

/**
 * Same-page Explore search must change the address now.
 * `router.replace` waits until Explore's relay updates go idle, so Enter
 * could change the list and leave the old query in the URL (a refresh then
 * brought the search back), or the other way around.
 * Passing Next's existing history state keeps this a silent URL write.
 * A short watch puts the latest address back if an older replace lands late.
 */
let exploreAddressWatch: ReturnType<typeof setInterval> | null = null;
let exploreAddressWanted = "";

export function currentExploreAddress(): string {
  if (typeof window === "undefined") return "";
  return `${window.location.pathname}${window.location.search}`;
}

export function holdExploreAddress(href: string): void {
  if (typeof window === "undefined") return;
  exploreAddressWanted = href;
  const apply = () => {
    if (window.location.pathname !== "/explore") {
      if (exploreAddressWatch) {
        clearInterval(exploreAddressWatch);
        exploreAddressWatch = null;
      }
      return;
    }
    if (currentExploreAddress() === exploreAddressWanted) return;
    window.history.replaceState(window.history.state, "", exploreAddressWanted);
  };
  apply();
  if (exploreAddressWatch) clearInterval(exploreAddressWatch);
  const started = Date.now();
  exploreAddressWatch = setInterval(() => {
    if (Date.now() - started > 20000) {
      if (exploreAddressWatch) clearInterval(exploreAddressWatch);
      exploreAddressWatch = null;
      return;
    }
    apply();
  }, 400);
}

/** Test-only: drop the address watch so cases do not keep timers. */
export function resetExploreAddressWatchForTests(): void {
  if (exploreAddressWatch) clearInterval(exploreAddressWatch);
  exploreAddressWatch = null;
  exploreAddressWanted = "";
}

/**
 * A search with zero matches should keep saying "looking" until the seed
 * snapshot and the relay sweep have both had a turn. Otherwise Home → Explore
 * shows "nothing found" against an empty or leftover list, then the real
 * names arrive a moment later.
 */
export function exploreSearchAwaitingCatalog(opts: {
  searchActive: boolean;
  matchCount: number;
  loadingRepos: boolean;
  syncing: boolean;
  seedPassDone: boolean;
}): boolean {
  if (!opts.searchActive || opts.matchCount > 0) return false;
  return opts.loadingRepos || opts.syncing || !opts.seedPassDone;
}
