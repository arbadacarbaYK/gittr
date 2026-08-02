import {
  PAGES_DESCRIPTION,
  buildPageSiteMetadata,
} from "@/lib/seo/site-metadata";

import { GittrPagesClient } from "./GittrPagesClient";

export const metadata = buildPageSiteMetadata({
  path: "/pages",
  title: "Published pages",
  description: PAGES_DESCRIPTION,
  imagePath: "/pages/opengraph-image",
  imageAlt: "gittr Pages — sites on Nostr",
});

const pagesBase = (
  process.env.NEXT_PUBLIC_GITTR_PAGES_URL || "https://pages.gittr.space"
).replace(/\/$/, "");

export default function GittrPagesHubPage() {
  return <GittrPagesClient pagesBase={pagesBase} />;
}
