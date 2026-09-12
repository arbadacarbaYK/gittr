/**
 * Slice the Pages directory for `/pages` first paint + Load more.
 * `limit === null` means the full list (profile sidebar, search hydrate).
 */

export function parseStatusSitesAuthor(searchParams: {
  get(name: string): string | null;
}): string | null {
  const raw = (searchParams.get("author") || "")
    .trim()
    .toLowerCase()
    .replace(/^0x/, "");
  return /^[0-9a-f]{64}$/.test(raw) ? raw : null;
}

export function parseStatusSitesLimitOffset(searchParams: {
  get(name: string): string | null;
}): { limit: number | null; offset: number } {
  const offsetRaw = Number.parseInt(searchParams.get("offset") || "0", 10);
  const offset = Number.isFinite(offsetRaw) && offsetRaw > 0 ? offsetRaw : 0;
  const limitParam = searchParams.get("limit");
  if (limitParam == null || limitParam.trim() === "") {
    return { limit: null, offset };
  }
  const limitRaw = Number.parseInt(limitParam, 10);
  if (!Number.isFinite(limitRaw) || limitRaw <= 0) {
    return { limit: null, offset };
  }
  return { limit: Math.min(limitRaw, 500), offset };
}

export function sortGatewaySitesByUpdated<T extends { updatedIso?: string }>(
  sites: T[]
): T[] {
  return [...sites].sort((a, b) => {
    const tb = Date.parse((b.updatedIso || "").trim());
    const ta = Date.parse((a.updatedIso || "").trim());
    const nb = Number.isFinite(tb) ? tb : 0;
    const na = Number.isFinite(ta) ? ta : 0;
    return nb - na;
  });
}

export function sliceStatusSites<T>(
  sites: T[],
  offset: number,
  limit: number | null
): { page: T[]; total: number; hasMore: boolean } {
  const total = sites.length;
  const start = Math.max(0, offset);
  if (limit == null) {
    return {
      page: start > 0 ? sites.slice(start) : sites.slice(),
      total,
      hasMore: false,
    };
  }
  const page = sites.slice(start, start + limit);
  return {
    page,
    total,
    hasMore: start + page.length < total,
  };
}
