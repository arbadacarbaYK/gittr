import { type MetadataRoute } from "next";

import { loadSoftwareCatalogSnapshot } from "../nostr/software-catalog-snapshot";

import {
  SOFTWARE_APP_SITEMAP_BUDGET,
  type SitemapSoftwareApp,
  softwareAppPath,
  uniqueSoftwareAppsForSitemap,
} from "./software-app-path";

export {
  SOFTWARE_APP_SITEMAP_BUDGET,
  uniqueSoftwareAppsForSitemap,
} from "./software-app-path";
export type { SitemapSoftwareApp } from "./software-app-path";

export async function fetchSoftwareAppSitemapEntries(
  baseUrl: string,
  limit = SOFTWARE_APP_SITEMAP_BUDGET
): Promise<MetadataRoute.Sitemap> {
  const snap = await loadSoftwareCatalogSnapshot();
  if (!snap?.apps?.length) return [];
  const origin = baseUrl.replace(/\/$/, "");
  const unique = uniqueSoftwareAppsForSitemap(
    snap.apps.map((app) => ({
      appId: app.appId,
      name: app.name,
      summary: app.summary,
      createdAt: app.createdAt,
    })),
    limit
  );
  return unique.map((app) => ({
    url: `${origin}${softwareAppPath(app.appId)}`,
    lastModified: app.createdAt ? new Date(app.createdAt * 1000) : new Date(),
    changeFrequency: "weekly" as const,
    priority: 0.45,
  }));
}

export async function findSoftwareAppInCatalog(
  appId: string
): Promise<SitemapSoftwareApp | null> {
  const want = appId.trim().toLowerCase();
  if (!want) return null;
  const snap = await loadSoftwareCatalogSnapshot();
  if (!snap?.apps?.length) return null;
  let best: SitemapSoftwareApp | null = null;
  for (const app of snap.apps) {
    if ((app.appId || "").trim().toLowerCase() !== want) continue;
    const row: SitemapSoftwareApp = {
      appId: app.appId.trim(),
      name: (app.name || "").trim() || app.appId,
      summary: app.summary?.trim() || undefined,
      createdAt: app.createdAt || 0,
    };
    if (!best || row.createdAt > best.createdAt) best = row;
  }
  return best;
}
