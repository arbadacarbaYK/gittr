import { type MetadataRoute } from "next";

export type SitemapHubSpec = {
  path: string;
  changeFrequency: NonNullable<
    MetadataRoute.Sitemap[number]["changeFrequency"]
  >;
  priority: number;
};

/**
 * Crawlable product hubs. Paths other than `/` are joined onto the public site
 * origin in `sitemap.ts`. Keep `/help` and `/nostr-git` here so they are not
 * treated as duplicates of the homepage.
 */
export const SITEMAP_HUBS: readonly SitemapHubSpec[] = [
  { path: "/", changeFrequency: "daily", priority: 1 },
  { path: "/explore", changeFrequency: "hourly", priority: 0.9 },
  { path: "/nostr-git", changeFrequency: "monthly", priority: 0.85 },
  { path: "/apps", changeFrequency: "hourly", priority: 0.8 },
  { path: "/help", changeFrequency: "monthly", priority: 0.75 },
  { path: "/new", changeFrequency: "monthly", priority: 0.6 },
  { path: "/pages", changeFrequency: "hourly", priority: 0.55 },
  { path: "/bounty-hunt", changeFrequency: "daily", priority: 0.55 },
  { path: "/lab", changeFrequency: "weekly", priority: 0.4 },
  { path: "/legal", changeFrequency: "yearly", priority: 0.3 },
];

export function sitemapHubEntries(baseUrl: string): MetadataRoute.Sitemap {
  const origin = baseUrl.replace(/\/$/, "");
  const now = new Date();
  return SITEMAP_HUBS.map((hub) => ({
    url: hub.path === "/" ? origin : `${origin}${hub.path}`,
    lastModified: now,
    changeFrequency: hub.changeFrequency,
    priority: hub.priority,
  }));
}
