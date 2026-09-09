import { filterRepoPathLinesByPublisherBlocklist } from "@/lib/moderation/publisher-blocklist";
import { fetchGittrPagesSitemapEntries } from "@/lib/seo/gittr-pages-sitemap";
import { loadNostrPushedRepoPaths } from "@/lib/seo/nostr-pushed-repos";
import {
  loadNostrSeoReposSnapshot,
  snapshotIsStale,
  snapshotPathMap,
} from "@/lib/seo/nostr-seo-repos-snapshot";
import { fetchSitemapRepoPathsFromNostr } from "@/lib/seo/nostr-sitemap-repos";
import { getPublicSiteUrl } from "@/lib/utils/public-site-url";

import { type MetadataRoute } from "next";

const MAX_SITEMAP_URLS = 45000;

/** Revalidate sitemap so new repos from relays appear without redeploying. */
export const revalidate = 3600;

function mergePathMaps(
  ...maps: Array<Map<string, number>>
): Map<string, number> {
  const out = new Map<string, number>();
  for (const m of maps) {
    for (const [line, ts] of m) {
      const prev = out.get(line);
      if (prev === undefined || ts > prev) out.set(line, ts);
    }
  }
  return out;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = getPublicSiteUrl();

  const staticPages: MetadataRoute.Sitemap = [
    {
      url: baseUrl,
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 1,
    },
    {
      url: `${baseUrl}/explore`,
      lastModified: new Date(),
      changeFrequency: "hourly",
      priority: 0.9,
    },
    {
      url: `${baseUrl}/help`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.7,
    },
    {
      url: `${baseUrl}/legal`,
      lastModified: new Date(),
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: `${baseUrl}/pages`,
      lastModified: new Date(),
      changeFrequency: "hourly",
      priority: 0.55,
    },
    {
      url: `${baseUrl}/new`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.6,
    },
  ];

  // Prefer daily disk snapshot (built by standalone systemd job). Live relay
  // fan-out only when the snap is missing/stale — keeps crawler hits off the
  // heavy SimplePool path inside the public Next process.
  // During `next build`, skip live Nostr unless SITEMAP_LIVE_NOSTR=1 — empty
  // snaps otherwise hang static generation past Next's 60s page budget.
  const seoSnap = await loadNostrSeoReposSnapshot({ allowStale: true });
  const fromSnapshot = snapshotPathMap(seoSnap);
  const forceLive =
    process.env.SITEMAP_LIVE_NOSTR === "1" ||
    process.env.SITEMAP_LIVE_NOSTR === "true";
  const isProductionBuild =
    process.env.NEXT_PHASE === "phase-production-build" ||
    process.env.npm_lifecycle_event === "build";
  const snapMissingOrStale =
    fromSnapshot.size === 0 || (seoSnap ? snapshotIsStale(seoSnap.at) : true);
  const fromNostr =
    forceLive || (snapMissingOrStale && !isProductionBuild)
      ? await fetchSitemapRepoPathsFromNostr()
      : new Map<string, number>();
  const fromFile = filterRepoPathLinesByPublisherBlocklist(
    loadNostrPushedRepoPaths()
  );
  const now = Date.now();
  const fromFileMap = new Map<string, number>();
  for (const line of fromFile) {
    fromFileMap.set(line, now);
  }

  const pathToModified = mergePathMaps(fromSnapshot, fromNostr, fromFileMap);

  const repoLines = [...pathToModified.keys()].slice(0, MAX_SITEMAP_URLS);
  const repoPages: MetadataRoute.Sitemap = repoLines.map((line) => {
    const slash = line.indexOf("/");
    const entity = line.slice(0, slash);
    const repo = line.slice(slash + 1);
    const url = `${baseUrl}/${encodeURIComponent(entity)}/${encodeURIComponent(
      repo
    )}`;
    const ts = pathToModified.get(line);
    return {
      url,
      lastModified: ts ? new Date(ts) : new Date(),
      changeFrequency: "weekly" as const,
      priority: 0.65,
    };
  });

  const pagesBase =
    process.env.NEXT_PUBLIC_GITTR_PAGES_URL || "https://pages.gittr.space";
  const gittrPagesEntries = await fetchGittrPagesSitemapEntries(pagesBase);
  const used = new Set<string>([
    ...staticPages.map((e) => e.url),
    ...repoPages.map((e) => e.url),
  ]);
  const room = Math.max(0, MAX_SITEMAP_URLS - used.size);
  const gittrPagesSitemap: MetadataRoute.Sitemap = [];
  for (const row of gittrPagesEntries) {
    if (gittrPagesSitemap.length >= room) break;
    if (used.has(row.url)) continue;
    used.add(row.url);
    gittrPagesSitemap.push({
      url: row.url,
      lastModified: row.lastModified,
      changeFrequency: "weekly" as const,
      priority: 0.5,
    });
  }

  return [...staticPages, ...repoPages, ...gittrPagesSitemap];
}
