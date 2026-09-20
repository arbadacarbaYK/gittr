import { type ReactNode } from "react";

import {
  HELP_DESCRIPTION,
  buildPageSiteMetadata,
} from "@/lib/seo/site-metadata";

export const metadata = buildPageSiteMetadata({
  path: "/help",
  title: "Help — Nostr git hosting",
  description: HELP_DESCRIPTION,
  imagePath: "/help/opengraph-image",
  imageAlt: "gittr Help — Nostr git hosting",
});

export default function HelpLayout({ children }: { children: ReactNode }) {
  return children;
}
