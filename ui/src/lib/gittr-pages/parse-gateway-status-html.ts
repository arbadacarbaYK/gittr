export type GatewayStatusSiteRow = {
  title: string;
  siteUrl: string;
  authorDisplay: string;
  authorPubkeyHex?: string;
  /** Present when gateway serves JSON (gittr nsite-gateway fork). */
  description?: string;
  pathCount: number;
  pathsStatusUrl: string;
  snapshots: number;
  hits: number;
  updatedLabel: string;
  updatedIso?: string;
};

function toHttps(url: string): string {
  if (url.startsWith("http://")) {
    return `https://${url.slice("http://".length)}`;
  }
  return url;
}

/**
 * Parses the nsite-gateway `/status` HTML table (same source as pages.gittr.space/status).
 */
export function parseGatewayStatusHtml(
  html: string,
  pagesBase: string
): GatewayStatusSiteRow[] {
  const base = pagesBase.replace(/\/$/, "");
  const tbody = html.match(/<tbody>([\s\S]*?)<\/tbody>/i);
  const tbodyInner = tbody?.[1];
  if (!tbodyInner) {
    return [];
  }
  const rows = [...tbodyInner.matchAll(/<tr>([\s\S]*?)<\/tr>/gi)]
    .map((m) => m[1])
    .filter((r): r is string => typeof r === "string" && r.length > 0);
  const out: GatewayStatusSiteRow[] = [];

  for (const tr of rows) {
    const site = tr.match(
      /data-label="site"[^>]*>\s*<a\s+href="([^"]+)"[^>]*>([^<]*)<\/a>/i
    );
    const siteHref = site?.[1];
    const siteTitleRaw = site?.[2];
    if (!siteHref) {
      continue;
    }
    const siteUrl = toHttps(siteHref.trim());
    const title = (siteTitleRaw ?? "").replace(/&amp;/g, "&").trim();

    const authorSpan = tr.match(
      /data-label="author"[^>]*>\s*<span[^>]*title="([^"]*)"[^>]*>([\s\S]*?)<\/span>/i
    );
    const authorPubkeyHex = authorSpan?.[1]?.trim();
    const authorDisplay =
      authorSpan?.[2]?.replace(/<[^>]+>/g, "")?.trim() || "";

    const paths = tr.match(
      /data-label="paths"[^>]*>\s*<a\s+href="([^"]*)"[^>]*>(\d+)\s*paths?<\/a>/i
    );
    const pathsHrefRaw = paths?.[1];
    const pathsCountRaw = paths?.[2];
    if (!paths || pathsHrefRaw === undefined || pathsCountRaw === undefined) {
      continue;
    }
    const pathCount = parseInt(pathsCountRaw, 10);
    const pathsHref = pathsHrefRaw.trim();
    const pathsStatusUrl = pathsHref.startsWith("http")
      ? pathsHref
      : `${base}${pathsHref.startsWith("/") ? "" : "/"}${pathsHref}`;

    const snapshots = parseInt(
      tr.match(/data-label="snapshots"[^>]*>\s*([^<]+)/i)?.[1] ?? "0",
      10
    );
    const hits = parseInt(
      tr.match(/data-label="hits"[^>]*>\s*([^<]+)/i)?.[1] ?? "0",
      10
    );

    const updatedWithTitle = tr.match(
      /data-label="updated"[^>]*title="([^"]*)"[^>]*>([^<]*)<\/td>/i
    );
    const updatedPlain = tr.match(/data-label="updated"[^>]*>([^<]*)<\/td>/i);
    const updatedIso = updatedWithTitle?.[1]?.trim();
    const updatedLabel = (
      updatedWithTitle?.[2] ??
      updatedPlain?.[1] ??
      ""
    ).trim();

    out.push({
      title: title || "Untitled site",
      siteUrl,
      authorDisplay,
      authorPubkeyHex,
      pathCount,
      pathsStatusUrl,
      snapshots: Number.isFinite(snapshots) ? snapshots : 0,
      hits: Number.isFinite(hits) ? hits : 0,
      updatedLabel,
      updatedIso,
    });
  }

  return out;
}

export function parseGatewayStatusMeta(html: string): {
  siteCount: number | null;
  generatedAt: string | null;
} {
  const meta = html.match(
    /(\d+)\s+sites\s+available\s+through\s+[^|]+\s*\|\s*generated\s+([^<]+)/i
  );
  const countStr = meta?.[1];
  const genStr = meta?.[2];
  if (!meta || countStr === undefined || genStr === undefined) {
    return { siteCount: null, generatedAt: null };
  }
  return {
    siteCount: parseInt(countStr, 10),
    generatedAt: genStr.trim(),
  };
}
