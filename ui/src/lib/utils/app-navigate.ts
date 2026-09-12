/**
 * Soft client navigation by default. Hard full-document loads were used as a
 * blunt fix when Code-tab hydrate starved clicks — that made *every* chrome
 * click feel like a 10s tab spinner after RemoteSigner remount warm.
 *
 * Amber signing stays on Push/Star/Watch via ensureRpcHealthy at click time.
 * Browse must not hard-reload or await bunker warm.
 *
 * Soft RSC for repo tabs also must stay fast: generateMetadata skips Nostr on
 * Flight requests (isRscClientNavigation).
 *
 * Chrome clicks (`router.push`) are **urgent** — not wrapped in
 * `startTransition`. Explore/Home/Issues live catalogs, Code hydrate, Apps
 * catalog flushes, and profile 30617 starve concurrent transitions, so the
 * address bar, header, and `/apps` owner-name links look dead until React is
 * idle. Leaving `/apps` or `/pages` also pauses the catalog and uses the
 * 1.2s hard fallback (same as Home from Code). Urgent push lets the click
 * land immediately; hard `location.assign` remains last-resort.
 */

function normalizePath(href: string): string {
  try {
    if (href.startsWith("http://") || href.startsWith("https://")) {
      return new URL(href).pathname;
    }
  } catch {
    /* ignore */
  }
  return href.split("?")[0] || href;
}

function canonicalPath(href: string): string {
  return normalizePath(href).replace(/\/+$/, "") || "/";
}

/** First path segments that are never a Nostr entity/repo Code tab. */
const RESERVED_TOP_SEGMENTS = new Set([
  "settings",
  "explore",
  "repositories",
  "stars",
  "zaps",
  "pulls",
  "issues",
  "apps",
  "pages",
  "lab",
  "new",
  "login",
  "signup",
  "help",
  "legal",
  "import",
  "profile",
  "bounty-hunt",
  "organizations",
  "projects",
  "sponsors",
  "upgrade",
  "api",
  "notifications",
]);

export function isExplorePath(pathname: string): boolean {
  const path = canonicalPath(pathname || "");
  return path === "/explore" || path.startsWith("/explore/");
}

export function isExploreHref(href: string): boolean {
  return href === "/explore" || href.startsWith("/explore?");
}

/**
 * Hub lists that paint hundreds of cards and starve `startTransition`
 * (same class as Code-tab setState storms).
 */
export function isHeavyDirectoryPath(pathname: string): boolean {
  const path = canonicalPath(pathname || "");
  return path === "/apps" || path === "/pages";
}

/**
 * Live Nostr catalogs that keep flushing `setState` after a click
 * (Explore/Home ranking, global Issues/PRs, Repositories grid).
 */
export function isLiveCatalogPath(pathname: string): boolean {
  const path = canonicalPath(pathname || "");
  return (
    path === "/" ||
    isExplorePath(path) ||
    path === "/issues" ||
    path === "/pulls" ||
    path === "/repositories"
  );
}

/**
 * Profile URL `/{npub}` or `/{hex}` — live 30617 catalog flushes starve
 * startTransition the same way Code/Apps do, so logo/home looked dead ~8–10s.
 */
export function isProfileEntityPath(pathname: string): boolean {
  const path = canonicalPath(pathname || "");
  const parts = path.split("/").filter(Boolean);
  if (parts.length !== 1) return false;
  const first = (parts[0] || "").toLowerCase();
  if (RESERVED_TOP_SEGMENTS.has(first)) return false;
  return true;
}

export function isUrgentLeavePath(pathname: string): boolean {
  return (
    isRepoCodePath(pathname) ||
    isHeavyDirectoryPath(pathname) ||
    isProfileEntityPath(pathname) ||
    isLiveCatalogPath(pathname)
  );
}

/**
 * `/apps` (and `/pages`) listen for this so chrome Home/logo/nav can stop
 * catalog `setState` before `router.push` — owner-name clicks used to look
 * dead while a live 4000/12000 NIP-82 scrape kept flushing.
 */
export const PAUSE_HEAVY_CATALOG_EVENT = "gittr:pause-heavy-catalog";

export function dispatchPauseHeavyCatalog(pathname?: string | null): void {
  if (typeof window === "undefined") return;
  const from = pathname || window.location.pathname;
  if (!isHeavyDirectoryPath(from)) return;
  try {
    window.dispatchEvent(new Event(PAUSE_HEAVY_CATALOG_EVENT));
  } catch {
    /* ignore */
  }
}

/** True when `href` is a different path than the current address bar. */
export function hrefLeavesCurrentPath(
  href: string,
  currentPathname: string
): boolean {
  const current = canonicalPath(currentPathname);
  try {
    if (href.startsWith("http://") || href.startsWith("https://")) {
      return canonicalPath(new URL(href).pathname) !== current;
    }
  } catch {
    return true;
  }
  return canonicalPath(href) !== current;
}

/**
 * Pointer-down on an in-app `<a>` that leaves `/apps` or `/pages`.
 * New-tab / download / same-hub clicks keep the catalog running.
 */
export function shouldPauseHeavyCatalogOnAnchorLeave(opts: {
  href: string | null;
  currentPathname: string;
  target?: string | null;
  download?: boolean;
}): boolean {
  if (!isHeavyDirectoryPath(opts.currentPathname)) return false;
  if (!opts.href || opts.href.startsWith("#")) return false;
  if (opts.download) return false;
  if ((opts.target || "").toLowerCase() === "_blank") return false;
  return hrefLeavesCurrentPath(opts.href, opts.currentPathname);
}

/**
 * Repo Code tab: `/{entity}/{repo}` with no further segment.
 * Excludes reserved app routes like `/settings/profile`.
 */
export function isRepoCodePath(pathname: string): boolean {
  const path = normalizePath(pathname || "");
  const parts = path.split("/").filter(Boolean);
  if (parts.length !== 2) return false;
  const first = (parts[0] || "").toLowerCase();
  if (RESERVED_TOP_SEGMENTS.has(first)) return false;
  return true;
}

function samePath(a: string, b: string): boolean {
  return canonicalPath(a) === canonicalPath(b);
}

/** Last-resort hard assign only if soft push truly stalls (RSC hung). */
export const SOFT_NAV_HARD_FALLBACK_MS = 8000;

/**
 * Logo/home from a Code tab must recover fast: Code hydrate can starve
 * `router.push("/")` indefinitely, and waiting 8s feels like a dead button.
 */
export const SOFT_NAV_HARD_FALLBACK_FROM_CODE_HOME_MS = 1200;

export function softNavHardFallbackMs(
  href: string,
  currentPathname: string
): number {
  // Owner-name on /apps is `/{npub}`, not Home. An 8s fallback made that
  // click look ignored while the catalog was still flushing.
  if (
    isHeavyDirectoryPath(currentPathname) &&
    canonicalPath(href) !== canonicalPath(currentPathname)
  ) {
    return SOFT_NAV_HARD_FALLBACK_FROM_CODE_HOME_MS;
  }
  if (
    canonicalPath(href) === "/" &&
    isUrgentLeavePath(currentPathname) &&
    canonicalPath(currentPathname) !== "/"
  ) {
    return SOFT_NAV_HARD_FALLBACK_FROM_CODE_HOME_MS;
  }
  return SOFT_NAV_HARD_FALLBACK_MS;
}

/**
 * Last-resort hard assign after a stalled soft push.
 *
 * `startedOnPathname` is the address bar at click time. If the user later
 * sits on a *different* non-target path (home succeeded, then they opened a
 * repo), do not yank them — that was the README/replaceState bounce-home.
 * If they are still on the same Code tab after clicking the logo, the soft
 * push never committed and home *must* hard-assign.
 */
export function shouldApplySoftNavHardFallback(
  href: string,
  currentPathname: string,
  startedOnPathname?: string | null
): boolean {
  const targetPath = canonicalPath(href);
  const currentPath = canonicalPath(currentPathname);
  if (currentPath === targetPath) return false;
  if (startedOnPathname != null && startedOnPathname !== "") {
    const startedOn = canonicalPath(startedOnPathname);
    if (currentPath !== startedOn && currentPath !== targetPath) return false;
  }
  return true;
}

/**
 * Hard nav is reserved for rare stuck soft transitions — not for every leave
 * from Code/Explore (that remounted the whole app + bunker warm).
 */
export function shouldHardNavigate(
  _href: string,
  _pathname?: string | null
): boolean {
  return false;
}

type NavEvent = {
  preventDefault: () => void;
};

/** Invalidate in-flight soft→hard fallbacks when a newer navigation starts. */
let softNavGeneration = 0;

export function appNavigate(
  href: string,
  router?: { push: (href: string) => void } | null,
  pathname?: string | null,
  event?: NavEvent | null
): void {
  if (typeof window === "undefined") return;
  if (shouldHardNavigate(href, pathname)) {
    window.location.assign(href);
    return;
  }
  dispatchPauseHeavyCatalog(pathname);
  event?.preventDefault();
  if (router) {
    const startedOn = pathname || window.location.pathname;
    const gen = ++softNavGeneration;
    const targetPath = canonicalPath(href);
    const push = () => {
      router.push(href);
    };
    // Always urgent: live catalogs and Code hydrate starve startTransition,
    // so chrome clicks looked dead until React was idle (or the 8s fallback).
    push();
    let timeoutId = 0;
    let intervalId = 0;
    const clearWatchers = () => {
      window.clearTimeout(timeoutId);
      window.clearInterval(intervalId);
    };
    intervalId = window.setInterval(() => {
      if (gen !== softNavGeneration) {
        clearWatchers();
        return;
      }
      if (canonicalPath(window.location.pathname) === targetPath) {
        clearWatchers();
      }
    }, 100);
    timeoutId = window.setTimeout(() => {
      if (gen !== softNavGeneration) {
        clearWatchers();
        return;
      }
      clearWatchers();
      if (
        !shouldApplySoftNavHardFallback(
          href,
          window.location.pathname,
          startedOn
        )
      ) {
        return;
      }
      // Soft RSC hung — last resort only.
      console.warn(
        "[appNavigate] Soft nav stalled; hard-assigning after",
        softNavHardFallbackMs(href, startedOn),
        "ms",
        { href, from: startedOn }
      );
      window.location.assign(href);
    }, softNavHardFallbackMs(href, startedOn));
    return;
  }
  window.location.assign(href);
}

// Re-export for tests / callers that still check Code path semantics.
export { samePath };
