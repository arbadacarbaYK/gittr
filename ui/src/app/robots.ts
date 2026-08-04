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
        disallow: [
          "/api/",
          "/settings/",
          "/import",
          "/login",
          "/signup",
        ],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
