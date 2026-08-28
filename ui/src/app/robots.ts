import { getPublicSiteUrl } from "@/lib/utils/public-site-url";

import { type MetadataRoute } from "next";

/** Always regenerate — social card validators cache robots aggressively. */
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function robots(): MetadataRoute.Robots {
  const baseUrl = getPublicSiteUrl();

  return {
    rules: [
      {
        userAgent: "*",
        // Explicit /new so card validators that cached the old Disallow: /new clear faster.
        allow: ["/", "/new", "/new/"],
        disallow: ["/api/", "/settings/", "/import", "/login", "/signup"],
      },
      // Meta AI training/index crawlers walked invented nips/nips/nips URL loops
      // (28 Aug 2026) and wedged Next. Do NOT list facebookexternalhit / FacebookBot
      // — those are share previews. Claude/GPT/TikTok stay under the * rule.
      {
        userAgent: [
          "meta-externalagent",
          "Meta-ExternalAgent",
          "Meta-ExternalFetcher",
        ],
        disallow: ["/"],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
