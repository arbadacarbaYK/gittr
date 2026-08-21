/**
 * Client navigation that stays soft most places, but hard-assigns when Explore
 * is involved. Explore saturates the main thread with relay streams so
 * router.push after preventDefault can look like a dead click (home, personal
 * menu, top nav). SearchBar already uses location.assign for the same reason.
 *
 * Soft nav also gets a short hard fallback (~400ms): Code-tab README/tree work
 * can starve router.push the same way Explore does.
 *
 * Important: on the hard path, do NOT preventDefault before calling this.
 * Letting the real <a href> stand is the fallback when JS is starved; we still
 * assign immediately when the handler runs.
 */

export function isExplorePath(pathname: string): boolean {
  return pathname === "/explore" || pathname.startsWith("/explore/");
}

export function isExploreHref(href: string): boolean {
  return href === "/explore" || href.startsWith("/explore?");
}

/** Prefer hard nav when leaving or entering Explore so chrome clicks stay responsive. */
export function shouldHardNavigate(
  href: string,
  pathname?: string | null
): boolean {
  const path =
    pathname ?? (typeof window !== "undefined" ? window.location.pathname : "");
  return isExplorePath(path) || isExploreHref(href);
}

type NavEvent = {
  preventDefault: () => void;
};

const SOFT_NAV_HARD_FALLBACK_MS = 400;

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
