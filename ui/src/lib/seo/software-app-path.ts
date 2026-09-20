/** Hub for the NIP-82 / Zapstore-style catalog. */
export const APPS_HUB_PATH = "/apps";

/** Signed-in owner tools — never treat as a package id. */
export const APPS_MINE_SEGMENT = "mine";

export function softwareAppPath(appId: string): string {
  return `${APPS_HUB_PATH}/${encodeURIComponent(appId.trim())}`;
}

export function softwareAppHref(siteOrigin: string, appId: string): string {
  const origin = siteOrigin.replace(/\/$/, "");
  return `${origin}${softwareAppPath(appId)}`;
}

/**
 * Package id from `/apps/{id}` (not `/apps` or `/apps/mine`).
 * Also accepts the older `/apps?q=` search form.
 */
export function parseSoftwareAppPathId(
  pathname: string,
  search = ""
): string | null {
  const path = (pathname || "").split("?")[0]?.replace(/\/+$/, "") || "";
  if (path === APPS_HUB_PATH) {
    const q = new URLSearchParams(
      search.startsWith("?") ? search.slice(1) : search
    )
      .get("q")
      ?.trim();
    return q || null;
  }
  const prefix = `${APPS_HUB_PATH}/`;
  if (!path.startsWith(prefix)) return null;
  const raw = path.slice(prefix.length);
  if (!raw || raw.includes("/") || raw.toLowerCase() === APPS_MINE_SEGMENT) {
    return null;
  }
  try {
    return decodeURIComponent(raw).trim() || null;
  } catch {
    return raw.trim() || null;
  }
}

export function isAppsCatalogPath(pathname: string): boolean {
  const path = (pathname || "").split("?")[0]?.replace(/\/+$/, "") || "";
  return path === APPS_HUB_PATH || path.startsWith(`${APPS_HUB_PATH}/`);
}

export const SOFTWARE_APP_SITEMAP_BUDGET = 2500;

export type SitemapSoftwareApp = {
  appId: string;
  name: string;
  summary?: string;
  createdAt: number;
};

export function uniqueSoftwareAppsForSitemap(
  apps: SitemapSoftwareApp[],
  limit = SOFTWARE_APP_SITEMAP_BUDGET
): SitemapSoftwareApp[] {
  const byId = new Map<string, SitemapSoftwareApp>();
  for (const app of apps) {
    const appId = (app.appId || "").trim();
    if (!appId) continue;
    if (appId.toLowerCase() === "mine") continue;
    if (/[\\/]/.test(appId) || appId.includes("..")) continue;
    const key = appId.toLowerCase();
    const prev = byId.get(key);
    if (!prev || app.createdAt > prev.createdAt) {
      byId.set(key, {
        appId,
        name: (app.name || "").trim() || appId,
        summary: app.summary?.trim() || undefined,
        createdAt: app.createdAt || 0,
      });
    }
  }
  return [...byId.values()]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, Math.max(0, limit));
}
