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
 * responsive while the new segment streams in.
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

/** Last-resort hard assign only if soft push truly stalls (RSC hung). */
const SOFT_NAV_HARD_FALLBACK_MS = 8000;

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
    const targetPath = canonicalPath(href);
    const gen = ++softNavGeneration;
    startTransition(() => {
      router.push(href);
    });
    window.setTimeout(() => {
      if (gen !== softNavGeneration) return;
      if (canonicalPath(window.location.pathname) === targetPath) return;
      // Soft RSC hung for 8s — last resort only.
      console.warn(
        "[appNavigate] Soft nav stalled; hard-assigning after",
        SOFT_NAV_HARD_FALLBACK_MS,
        "ms",
        { href, from: pathname }
      );
      window.location.assign(href);
    }, SOFT_NAV_HARD_FALLBACK_MS);
    return;
  }
  window.location.assign(href);
}

// Re-export for tests / callers that still check Code path semantics.
export { samePath };
