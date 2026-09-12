import { parseGatewayManifestsJson } from "@/lib/gittr-pages/gateway-manifests-json";
import { filterBrowsableGatewaySites } from "@/lib/gittr-pages/gateway-site-browseability";
import type { GatewayStatusSiteRow } from "@/lib/gittr-pages/parse-gateway-status-html";
import {
  parseGatewayStatusHtml,
  parseGatewayStatusMeta,
} from "@/lib/gittr-pages/parse-gateway-status-html";
import { filterGatewaySitesByPublisherBlocklist } from "@/lib/moderation/publisher-blocklist";

export type GatewayStatusSitesOk = {
  pagesBase: string;
  statusUrl: string;
  manifestsUrl: string;
  source: "json" | "html";
  sites: GatewayStatusSiteRow[];
  meta: { siteCount: number | null; generatedAt: string | null };
};

export type GatewayStatusSitesErr = {
  error: string;
  statusUrl: string;
  manifestsUrl: string;
  status: number;
};

const TTL_MS = 120_000;
let cache: { expires: number; payload: GatewayStatusSitesOk } | null = null;

function pagesBase(): string {
  return (
    process.env.NEXT_PUBLIC_GITTR_PAGES_URL || "https://pages.gittr.space"
  ).replace(/\/$/, "");
}

/** Test hook */
export function resetGatewayStatusSitesCacheForTests(): void {
  cache = null;
}

/**
 * Parsed, blocklisted, browsable directory. Cached ~2 minutes so `/pages`
 * first paint and later Load-more / profile checks do not re-download
 * ~2000 gateway rows on every request.
 */
export async function loadGatewayStatusSites(opts?: {
  fresh?: boolean;
}): Promise<GatewayStatusSitesOk | GatewayStatusSitesErr> {
  const now = Date.now();
  const fresh = opts?.fresh === true;
  if (!fresh && cache && cache.expires > now) {
    return cache.payload;
  }

  const base = pagesBase();
  const statusUrl = `${base}/status`;
  const manifestsUrl = `${base}/status/manifests.json`;
  const jsonHeaders = { Accept: "application/json" } as const;
  const htmlHeaders = { Accept: "text/html" } as const;
  const jsonFetch = fresh
    ? { headers: jsonHeaders, cache: "no-store" as const }
    : { headers: jsonHeaders, next: { revalidate: 120 } };
  const htmlFetch = fresh
    ? { headers: htmlHeaders, cache: "no-store" as const }
    : { headers: htmlHeaders, next: { revalidate: 120 } };

  try {
    const jsonRes = await fetch(manifestsUrl, jsonFetch);

    let payload: GatewayStatusSitesOk;

    if (jsonRes.ok) {
      const raw = await jsonRes.json();
      const { sites, meta } = parseGatewayManifestsJson(raw, base);
      const sitesFiltered = filterBrowsableGatewaySites(
        filterGatewaySitesByPublisherBlocklist(sites)
      );
      payload = {
        pagesBase: base,
        statusUrl,
        manifestsUrl,
        source: "json",
        sites: sitesFiltered,
        meta: {
          ...meta,
          siteCount: sitesFiltered.length,
        },
      };
    } else {
      const res = await fetch(statusUrl, htmlFetch);

      if (!res.ok) {
        return {
          error: `Gateway returned ${res.status} (JSON and HTML status both failed)`,
          statusUrl,
          manifestsUrl,
          status: 502,
        };
      }

      const html = await res.text();
      const sites = filterBrowsableGatewaySites(
        filterGatewaySitesByPublisherBlocklist(
          parseGatewayStatusHtml(html, base)
        )
      );
      const meta = parseGatewayStatusMeta(html);
      payload = {
        pagesBase: base,
        statusUrl,
        manifestsUrl,
        source: "html",
        sites,
        meta: { ...meta, siteCount: sites.length },
      };
    }

    cache = { expires: now + TTL_MS, payload };
    return payload;
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return { error: message, statusUrl, manifestsUrl, status: 500 };
  }
}
