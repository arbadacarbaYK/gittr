import type { ReactNode } from "react";

import {
  NEW_DESCRIPTION,
  buildPageSiteMetadata,
} from "@/lib/seo/site-metadata";

export const metadata = buildPageSiteMetadata({
  path: "/new",
  title: "Create or import",
  description: NEW_DESCRIPTION,
  imagePath: "/new/opengraph-image",
  imageAlt:
    "gittr — create a Nostr git repo or import from GitHub, GitLab, Codeberg",
});

export default function NewLayout({ children }: { children: ReactNode }) {
  return children;
}
