import { type ReactNode } from "react";

import {
  ISSUES_DESCRIPTION,
  buildPageSiteMetadata,
} from "@/lib/seo/site-metadata";

export const metadata = buildPageSiteMetadata({
  path: "/issues",
  title: "Issues — Nostr git",
  description: ISSUES_DESCRIPTION,
});

export default function IssuesLayout({ children }: { children: ReactNode }) {
  return children;
}
