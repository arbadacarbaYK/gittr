import { loadGatewayStatusSites } from "@/lib/gittr-pages/load-gateway-status-sites";
import {
  sliceStatusSites,
  sortGatewaySitesByUpdated,
} from "@/lib/gittr-pages/paginate-gateway-sites";
import {
  PAGES_DESCRIPTION,
  buildPageSiteMetadata,
} from "@/lib/seo/site-metadata";
import { REPO_LIST_PAGE_SIZE } from "@/lib/ui/list-pagination";

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

export default async function GittrPagesHubPage() {
  const initialPayload = await loadFirstPagesScreen(pagesBase);
  return (
    <GittrPagesClient pagesBase={pagesBase} initialPayload={initialPayload} />
  );
}

/** First screen of sites in the HTML. A cold gateway must not hold the page blank. */
async function loadFirstPagesScreen(pagesBase: string) {
  const loaded = await Promise.race([
    loadGatewayStatusSites(),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 400)),
  ]);
  if (!loaded || "error" in loaded) return null;
  const sorted = sortGatewaySitesByUpdated(loaded.sites);
  const { page, total, hasMore } = sliceStatusSites(
    sorted,
    0,
    REPO_LIST_PAGE_SIZE
  );
  return {
    pagesBase: loaded.pagesBase || pagesBase,
    statusUrl: loaded.statusUrl,
    manifestsUrl: loaded.manifestsUrl,
    source: loaded.source,
    sites: page,
    total,
    hasMore,
    meta: { ...loaded.meta, siteCount: total },
  };
}
