import { loadGatewayStatusSites } from "@/lib/gittr-pages/load-gateway-status-sites";
import { pageBelongsToOwner } from "@/lib/gittr-pages/pages-owner-match";
import {
  parseStatusSitesAuthor,
  parseStatusSitesLimitOffset,
  sliceStatusSites,
  sortGatewaySitesByUpdated,
} from "@/lib/gittr-pages/paginate-gateway-sites";

import { NextResponse } from "next/server";

/** In-memory TTL lives in loadGatewayStatusSites — do not use Next Data Cache. */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const { limit, offset } = parseStatusSitesLimitOffset(searchParams);
  const authorHex = parseStatusSitesAuthor(searchParams);
  const fresh = searchParams.get("fresh") === "1";
  const loaded = await loadGatewayStatusSites({ fresh });

  if ("error" in loaded) {
    return NextResponse.json(
      {
        error: loaded.error,
        statusUrl: loaded.statusUrl,
        manifestsUrl: loaded.manifestsUrl,
      },
      { status: loaded.status }
    );
  }

  const owned = authorHex
    ? loaded.sites.filter((s) => pageBelongsToOwner(s, authorHex))
    : loaded.sites;

  // Newest Push Manifest / snapshot first. `sort=updated` is accepted for
  // Home and older clients; collapsing same-author rows used to clump an
  // owner’s older sites at the top of `/pages`.
  const sorted = sortGatewaySitesByUpdated(owned);

  const { page, total, hasMore } = sliceStatusSites(sorted, offset, limit);

  return NextResponse.json(
    {
      pagesBase: loaded.pagesBase,
      statusUrl: loaded.statusUrl,
      manifestsUrl: loaded.manifestsUrl,
      source: loaded.source,
      sites: page,
      total,
      offset,
      limit: limit ?? total,
      hasMore,
      meta: {
        ...loaded.meta,
        siteCount: total,
      },
    },
    {
      headers: {
        "Cache-Control": authorHex
          ? "private, no-store"
          : "public, max-age=0, s-maxage=60, stale-while-revalidate=30",
      },
    }
  );
}
