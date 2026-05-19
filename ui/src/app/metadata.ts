import { buildRootSiteMetadata } from "@/lib/seo/site-metadata";

// Kept for imports that expect app/metadata; root layout uses the same builder.
export const metadata = {
  ...buildRootSiteMetadata(),
  manifest: "/site.webmanifest",
};
