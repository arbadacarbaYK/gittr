/**
 * Shallow address-bar updates that must not ask Next.js to ACTION_RESTORE.
 *
 * Next 15 patches history.replaceState / pushState. Passing `null` (no `__NA`)
 * copies whatever tree is currently in history.state and dispatches
 * ACTION_RESTORE. During a soft navigation from `/` that tree is still the
 * homepage — so adding `?branch=` after README hydrate bounced users home.
 *
 * Passing the existing `__NA` state takes Next's internal early-return and
 * only changes the URL.
 */

function canonicalPath(href: string): string {
  return (href.split("?")[0] || href).replace(/\/+$/, "") || "/";
}

function historyStateWithNa(state: unknown): {
  __NA: true;
  [key: string]: unknown;
} {
  if (state && typeof state === "object") {
    return { ...(state as Record<string, unknown>), __NA: true };
  }
  return { __NA: true };
}

function resolveAppUrl(url: string): URL | null {
  if (typeof window === "undefined") return null;
  try {
    return new URL(url, window.location.origin);
  } catch {
    return null;
  }
}

/**
 * Replace the current history URL without Next ACTION_RESTORE.
 * No-ops (returns false) when the browser is still on a different path —
 * that is the homepage→Code hydrate window that used to bounce to `/`.
 */
export function replaceAppUrl(url: string): boolean {
  const next = resolveAppUrl(url);
  if (!next || typeof window === "undefined") return false;
  if (
    canonicalPath(window.location.pathname) !== canonicalPath(next.pathname)
  ) {
    return false;
  }
  window.history.replaceState(
    historyStateWithNa(window.history.state),
    "",
    `${next.pathname}${next.search}${next.hash}`
  );
  return true;
}

/**
 * Push a same-path query/hash change without Next ACTION_RESTORE.
 * Different pathnames fall through (return false) so the caller can hard-nav.
 */
export function pushAppUrl(url: string): boolean {
  const next = resolveAppUrl(url);
  if (!next || typeof window === "undefined") return false;
  if (
    canonicalPath(window.location.pathname) !== canonicalPath(next.pathname)
  ) {
    return false;
  }
  window.history.pushState(
    historyStateWithNa(window.history.state),
    "",
    `${next.pathname}${next.search}${next.hash}`
  );
  return true;
}
