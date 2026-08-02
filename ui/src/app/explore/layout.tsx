import type { ReactNode } from "react";

import {
  EXPLORE_DESCRIPTION,
  buildPageSiteMetadata,
} from "@/lib/seo/site-metadata";

export const metadata = buildPageSiteMetadata({
  path: "/explore",
  title: "Repos",
  description: EXPLORE_DESCRIPTION,
  imagePath: "/explore/opengraph-image",
  imageAlt: "gittr Explore — public Nostr git repositories",
});

export default function ExploreLayout({ children }: { children: ReactNode }) {
  return children;
}
