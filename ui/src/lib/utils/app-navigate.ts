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

function samePath(a: string, b: string): boolean {
  const na = normalizePath(a).replace(/\/+$/, "") || "/";
  const nb = normalizePath(b).replace(/\/+$/, "") || "/";
  return na === nb;
}

/**
 * Prefer hard nav when leaving/entering Explore, or for ANY leave from the
 * Code tab (header, home, tabs, settings, user menu — not only Issues).
 */
export function shouldHardNavigate(
  href: string,
  pathname?: string | null
): boolean {
  const path =
    pathname ?? (typeof window !== "undefined" ? window.location.pathname : "");
  if (isExplorePath(path) || isExploreHref(href)) return true;
  if (isRepoCodePath(path) && !samePath(path, href)) return true;
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
    // Do not preventDefault — if this handler is delayed, the real <a href>
    // can still navigate. assign() covers menu onSelect (no native href).
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
