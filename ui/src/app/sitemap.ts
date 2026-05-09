import { filterRepoPathLinesByPublisherBlocklist } from "@/lib/moderation/publisher-blocklist";
import { fetchGittrPagesSitemapEntries } from "@/lib/seo/gittr-pages-sitemap";
import { fetchSitemapRepoPathsFromNostr } from "@/lib/seo/nostr-sitemap-repos";
import { getPublicSiteUrl } from "@/lib/utils/public-site-url";

import { existsSync, readFileSync } from "fs";
import { type MetadataRoute } from "next";
import { join } from "path";

const MAX_SITEMAP_URLS = 45000;

/** Revalidate sitemap so new repos from relays appear without redeploying. */
export const revalidate = 3600;

/** Lines like npub1.../repo-name from optional local file (bridge / extras). */
function loadNostrPushedRepoPaths(): string[] {
  const candidates = [
    join(process.cwd(), "..", "nostr-pushed-repos.txt"),
    join(process.cwd(), "nostr-pushed-repos.txt"),
  ];
  for (const filePath of candidates) {
    try {
      if (!existsSync(filePath)) continue;
      const raw = readFileSync(filePath, "utf8");
      const lines = raw
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(
          (l) =>
            l.length > 0 && !l.startsWith("#") && /^npub1[0-9a-z]+\/.+/i.test(l)
        );
      return [...new Set(lines)];
    } catch {
      /* continue */
    }
  }
  return [];
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
      url: `${baseUrl}/pages`,
      lastModified: new Date(),
      changeFrequency: "hourly",
      priority: 0.55,
    },
  ];

  const fromNostr = await fetchSitemapRepoPathsFromNostr();
  const fromFile = filterRepoPathLinesByPublisherBlocklist(
    loadNostrPushedRepoPaths()
  );

  const pathToModified = new Map<string, number>(fromNostr);
  const now = Date.now();
  for (const line of fromFile) {
    if (!pathToModified.has(line)) pathToModified.set(line, now);
  }

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
