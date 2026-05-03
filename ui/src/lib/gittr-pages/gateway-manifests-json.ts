import { dedupeGatewaySitesForDirectory } from "./dedupe-gateway-sites";
import type { GatewayStatusSiteRow } from "./parse-gateway-status-html";

export type GatewayManifestsJsonPayload = {
  generatedAt?: string;
  siteCount?: number;
  sites?: unknown[];
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Validates and maps `GET /status/manifests.json` from the gittr nsite-gateway fork.
 */
export function parseGatewayManifestsJson(
  data: unknown,
  pagesBase: string
): {
  sites: GatewayStatusSiteRow[];
  meta: { siteCount: number | null; generatedAt: string | null };
} {
  const base = pagesBase.replace(/\/$/, "");
  if (!isRecord(data)) {
    return { sites: [], meta: { siteCount: null, generatedAt: null } };
  }

  const generatedAt =
    typeof data.generatedAt === "string" ? data.generatedAt : null;
  const siteCount =
    typeof data.siteCount === "number" && Number.isFinite(data.siteCount)
      ? data.siteCount
      : null;
  const rawSites = Array.isArray(data.sites) ? data.sites : [];

  const sites: GatewayStatusSiteRow[] = [];
  for (const row of rawSites) {
    if (!isRecord(row)) {
      continue;
    }
    const title = typeof row.title === "string" ? row.title : "";
    const siteUrl = typeof row.siteUrl === "string" ? row.siteUrl : "";
    const pathsStatusUrl =
      typeof row.pathsStatusUrl === "string" ? row.pathsStatusUrl : "";
    if (!siteUrl || !pathsStatusUrl) {
      continue;
    }
    const authorDisplay =
      typeof row.authorDisplay === "string" ? row.authorDisplay : "";
    const authorPubkeyHex =
      typeof row.authorPubkeyHex === "string" ? row.authorPubkeyHex : undefined;
    const pathCount =
      typeof row.pathCount === "number" && Number.isFinite(row.pathCount)
        ? row.pathCount
        : 0;
    const snapshots =
      typeof row.snapshots === "number" && Number.isFinite(row.snapshots)
        ? row.snapshots
        : 0;
    const hits =
      typeof row.hits === "number" && Number.isFinite(row.hits) ? row.hits : 0;
    const updatedLabel =
      typeof row.updatedLabel === "string" ? row.updatedLabel : "";
    const updatedIso =
      typeof row.updatedIso === "string" ? row.updatedIso : undefined;
    const description =
      typeof row.description === "string" ? row.description : undefined;

    sites.push({
      title: title || "Untitled site",
      siteUrl: siteUrl.startsWith("http://")
        ? `https://${siteUrl.slice("http://".length)}`
        : siteUrl,
      authorDisplay,
      authorPubkeyHex,
      pathCount,
      pathsStatusUrl: pathsStatusUrl.startsWith("/")
        ? `${base}${pathsStatusUrl}`
        : pathsStatusUrl,
      snapshots,
      hits,
      updatedLabel,
      updatedIso,
      description,
    });
  }

  const sitesDeduped = dedupeGatewaySitesForDirectory(sites);
  return {
    sites: sitesDeduped,
    meta: {
      siteCount: sitesDeduped.length,
      generatedAt,
    },
  };
}
