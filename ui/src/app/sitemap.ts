import { readFileSync, existsSync } from "fs";
import { join } from "path";

import { type MetadataRoute } from "next";

const MAX_SITEMAP_URLS = 45000;

/** Lines like npub1.../repo-name from bridge index; boosts crawl of public repos. */
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
            l.length > 0 &&
            !l.startsWith("#") &&
            /^npub1[0-9a-z]+\/.+/i.test(l)
        );
      return [...new Set(lines)];
    } catch {
      /* continue */
    }
  }
  return [];
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://gittr.space";

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
  ];

  const repoPaths = loadNostrPushedRepoPaths().slice(0, MAX_SITEMAP_URLS);
  const now = new Date();
  const repoPages: MetadataRoute.Sitemap = repoPaths.map((line) => {
    const slash = line.indexOf("/");
    const entity = line.slice(0, slash);
    const repo = line.slice(slash + 1);
    const url = `${baseUrl}/${encodeURIComponent(entity)}/${encodeURIComponent(repo)}`;
    return {
      url,
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: 0.65,
    };
  });

  return [...staticPages, ...repoPages];
}
