import { type ReactNode } from "react";

import {
  BOUNTY_HUNT_DESCRIPTION,
  buildPageSiteMetadata,
} from "@/lib/seo/site-metadata";

export const metadata = buildPageSiteMetadata({
  path: "/bounty-hunt",
  title: "Bounty Hunt — Lightning on Nostr git",
  description: BOUNTY_HUNT_DESCRIPTION,
  imagePath: "/bounty-hunt/opengraph-image",
  imageAlt: "gittr Bounty Hunt — Lightning bounties on Nostr git",
});

export default function BountyHuntLayout({
  children,
}: {
  children: ReactNode;
}) {
  return children;
}
