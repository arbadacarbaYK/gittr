import { type ReactNode } from "react";

import {
  PULLS_DESCRIPTION,
  buildPageSiteMetadata,
} from "@/lib/seo/site-metadata";

export const metadata = buildPageSiteMetadata({
  path: "/pulls",
  title: "Pull requests — Nostr git",
  description: PULLS_DESCRIPTION,
});

export default function PullsLayout({ children }: { children: ReactNode }) {
  return children;
}
