import { buildPageSiteMetadata } from "@/lib/seo/site-metadata";

import { AppsDirectoryClient } from "./AppsDirectoryClient";

export const metadata = buildPageSiteMetadata({
  path: "/apps",
  title: "Apps",
  description:
    "NIP-82 software on Nostr — discover and install APKs from the same catalog family as Zapstore.",
  imagePath: "/apps/opengraph-image",
  imageAlt: "gittr Apps — NIP-82 software on Nostr",
});

export default function AppsPage() {
  return <AppsDirectoryClient />;
}
