import { loadStoredRepos } from "@/lib/repos/storage";

import { MetadataRoute } from "next";
import { nip19 } from "nostr-tools";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://gittr.space";

  // Static pages
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

  // Dynamic pages - repositories
  // Note: In a production environment, you might want to fetch from Nostr relays
  // For now, we'll use localStorage repos (limited to what's cached)
  let repoPages: MetadataRoute.Sitemap = [];

  // Server-side: We can't access localStorage
  // In production, you'd want to fetch from a database or Nostr relays
  // For now, return static pages only - dynamic repo pages will be indexed as they're discovered
  // TODO: Implement server-side repo discovery from Nostr relays or database
  return staticPages;
}
