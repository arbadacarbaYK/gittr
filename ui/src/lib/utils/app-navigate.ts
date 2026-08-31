/**
 * Soft client navigation by default. Hard full-document loads were used as a
 * blunt fix when Code-tab hydrate starved clicks — that made *every* chrome
 * click feel like a 10s tab spinner after RemoteSigner remount warm.
 *
 * Amber signing stays on Push/Star/Watch via ensureRpcHealthy at click time.
 * Browse must not hard-reload or await bunker warm.
 *
 * Soft RSC for repo tabs also must stay fast: generateMetadata skips Nostr on
 * Flight requests (isRscClientNavigation). startTransition keeps the chrome
 * responsive while the new segment streams in — except when leaving a Code
 * tab, where Code setState storms starve the transition (logo/home looked
 * dead). Those leaves push urgently; home from Code also gets a short hard
 * fallback if the URL never changes.
 */
import { startTransition } from "react";

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
  return pathname === "/explore" || pathname.startsWith("/explore/");
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
  if (
    canonicalPath(href) === "/" &&
    (isRepoCodePath(currentPathname) || isHeavyDirectoryPath(currentPathname))
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
  event?.preventDefault();
  if (router) {
    const startedOn = pathname || window.location.pathname;
    const gen = ++softNavGeneration;
    const targetPath = canonicalPath(href);
    const push = () => {
      router.push(href);
    };
    // Code-tab setState (tree/README) starves startTransition; leave urgently
    // so the logo and tabs actually commit instead of waiting forever.
    if (isRepoCodePath(startedOn) || isHeavyDirectoryPath(startedOn)) {
      push();
    } else {
      startTransition(push);
    }
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
