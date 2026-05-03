import type { Metadata } from "next";

import { GittrPagesClient } from "./GittrPagesClient";

export const metadata: Metadata = {
  title: "Published pages",
  description:
    "Sites published on Nostr and cached by the gittr Pages gateway — open each site in a new tab.",
};

const pagesBase = (
  process.env.NEXT_PUBLIC_GITTR_PAGES_URL || "https://pages.gittr.space"
).replace(/\/$/, "");

export default function GittrPagesHubPage() {
  return <GittrPagesClient pagesBase={pagesBase} />;
}
