import { loadGatewayStatusSites } from "@/lib/gittr-pages/load-gateway-status-sites";
import {
  parseStatusSitesLimitOffset,
  sliceStatusSites,
} from "@/lib/gittr-pages/paginate-gateway-sites";

import { NextResponse } from "next/server";

/** Processed directory is also memory-cached ~2 minutes in loadGatewayStatusSites. */
export const revalidate = 120;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const { limit, offset } = parseStatusSitesLimitOffset(searchParams);
  const loaded = await loadGatewayStatusSites();

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

  const { page, total, hasMore } = sliceStatusSites(
    loaded.sites,
    offset,
    limit
  );

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
        "Cache-Control": "public, s-maxage=120, stale-while-revalidate=60",
      },
    }
  );
}
