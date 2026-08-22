/**
 * Client navigation that stays soft most places, but hard-assigns when Explore
 * or the Code tab is involved. Those paths saturate the main thread (relay
 * streams / README markdown + tree hydrate) so router.push after preventDefault
 * can look like a dead click until load finishes.
 *
 * Soft nav also gets a short hard fallback (~400ms) as a backup.
 *
 * Important: on the hard path, do NOT preventDefault before calling this.
 * Letting the real <a href> stand is the fallback when JS is starved; we still
 * assign immediately when the handler runs.
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

export function isExplorePath(pathname: string): boolean {
  return pathname === "/explore" || pathname.startsWith("/explore/");
}

export function isExploreHref(href: string): boolean {
  return href === "/explore" || href.startsWith("/explore?");
}

/**
 * Repo Code tab: `/{entity}/{repo}` with no further segment (optional trailing slash).
 * That page does heavy sync work after the file list paints (README markdown).
 */
export function isRepoCodePath(pathname: string): boolean {
  const path = normalizePath(pathname || "");
  const parts = path.split("/").filter(Boolean);
  return parts.length === 2;
}

/** Prefer hard nav when leaving/entering Explore or leaving the Code tab. */
export function shouldHardNavigate(
  href: string,
  pathname?: string | null
): boolean {
  const path =
    pathname ?? (typeof window !== "undefined" ? window.location.pathname : "");
  if (isExplorePath(path) || isExploreHref(href)) return true;
  // Leaving Code for Issues/PRs/Settings/home/etc. — do not wait for README.
  if (isRepoCodePath(path) && !isRepoCodePath(normalizePath(href))) return true;
  return false;
}

type NavEvent = {
  preventDefault: () => void;
};

const SOFT_NAV_HARD_FALLBACK_MS = 400;

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
    const targetPath = normalizePath(href);
    router.push(href);
    window.setTimeout(() => {
      if (window.location.pathname !== targetPath) {
        window.location.assign(href);
      }
    }, SOFT_NAV_HARD_FALLBACK_MS);
    return;
  }
  window.location.assign(href);
}
