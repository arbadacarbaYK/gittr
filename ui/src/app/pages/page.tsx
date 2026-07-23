import { buildPageSiteMetadata } from "@/lib/seo/site-metadata";

import { GittrPagesClient } from "./GittrPagesClient";

export const metadata = buildPageSiteMetadata({
  path: "/pages",
  title: "Published pages",
  description:
    "Sites published on Nostr and cached by the Nostr Pages gateway — open each site in a new tab.",
  imagePath: "/pages/opengraph-image",
  imageAlt: "gittr Pages — sites on Nostr",
});

const pagesBase = (
  process.env.NEXT_PUBLIC_GITTR_PAGES_URL || "https://pages.gittr.space"
).replace(/\/$/, "");

export default function GittrPagesHubPage() {
  return <GittrPagesClient pagesBase={pagesBase} />;
}
