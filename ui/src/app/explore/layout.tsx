import type { ReactNode } from "react";

import { buildPageSiteMetadata } from "@/lib/seo/site-metadata";

export const metadata = buildPageSiteMetadata({
  path: "/explore",
  title: "Repos",
  description:
    "Browse public git repositories published on Nostr (same data as the Repos link in the header).",
});

export default function ExploreLayout({ children }: { children: ReactNode }) {
  return children;
}
