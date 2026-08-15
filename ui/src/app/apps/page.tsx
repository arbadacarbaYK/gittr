import { Suspense } from "react";

import {
  APPS_DESCRIPTION,
  buildPageSiteMetadata,
} from "@/lib/seo/site-metadata";

import { AppsDirectoryClient } from "./AppsDirectoryClient";

export const metadata = buildPageSiteMetadata({
  path: "/apps",
  title: "Apps",
  description: APPS_DESCRIPTION,
  imagePath: "/apps/opengraph-image",
  imageAlt: "gittr Apps — NIP-82 software on Nostr",
});

export default function AppsPage() {
  return (
    <Suspense fallback={null}>
      <AppsDirectoryClient />
    </Suspense>
  );
}
