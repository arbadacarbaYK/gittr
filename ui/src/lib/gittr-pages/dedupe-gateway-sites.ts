import type { GatewayStatusSiteRow } from "./parse-gateway-status-html";

function siteHostnameKey(siteUrl: string): string {
  try {
    return new URL(siteUrl.trim()).hostname.toLowerCase();
  } catch {
    return siteUrl.trim().toLowerCase();
  }
}

function normalizeAuthorPk(hex?: string): string {
  if (!hex) return "";
  return hex.toLowerCase().replace(/^0x/, "");
}

/** Gateway often lists root (npub host) and a named site (“portal”) as separate rows for the same project. */
function titleLooksLikeNpubOrTruncatedNpub(title: string): boolean {
  const t = title.trim().toLowerCase();
  if (t.startsWith("npub1")) return true;
  if (t.includes("…") && (t.startsWith("npub") || /^[0-9a-z]{6,}/i.test(t)))
    return true;
  return false;
}

function rowTitleDisplayQuality(title: string): number {
  const t = title.trim().toLowerCase();
  if (!t) return 0;
  if (t === "portal") return 1;
  if (t.startsWith("npub1")) return 2;
  if (title.includes("…")) return 3;
  return 10;
}

function chooseDisplayHeading(group: GatewayStatusSiteRow[]): string {
  const bestTitle = group.reduce((best, s) => {
    const t = (s.title || "").trim();
    if (rowTitleDisplayQuality(t) > rowTitleDisplayQuality(best)) return t;
    return best;
  }, (group[0]?.title || "").trim());

  if (rowTitleDisplayQuality(bestTitle) >= 6) return bestTitle;

  const desc = group
    .map((s) => (s.description || "").trim())
    .find((d) => d.length >= 2 && !d.toLowerCase().startsWith("http"));
  if (desc) return desc;

  return bestTitle || "Site";
}

function pickBaseRow(a: GatewayStatusSiteRow, b: GatewayStatusSiteRow): GatewayStatusSiteRow {
  if (b.pathCount !== a.pathCount) return b.pathCount > a.pathCount ? b : a;
  if (b.hits !== a.hits) return b.hits > a.hits ? b : a;
  return rowTitleDisplayQuality(a.title) >= rowTitleDisplayQuality(b.title) ? a : b;
}

function mergeable(a: GatewayStatusSiteRow, b: GatewayStatusSiteRow): boolean {
  const pa = normalizeAuthorPk(a.authorPubkeyHex);
  const pb = normalizeAuthorPk(b.authorPubkeyHex);
  if (!pa || pa !== pb) return false;

  const da = (a.description || "").trim().toLowerCase();
  const db = (b.description || "").trim().toLowerCase();
  if (da.length >= 3 && db.length >= 3 && da === db) return true;

  const ta = (a.title || "").trim().toLowerCase();
  const tb = (b.title || "").trim().toLowerCase();
  if (ta && ta === tb) return true;

  const aPortal = ta === "portal";
  const bPortal = tb === "portal";
  const aNpubish = titleLooksLikeNpubOrTruncatedNpub(a.title);
  const bNpubish = titleLooksLikeNpubOrTruncatedNpub(b.title);
  if ((aPortal && bNpubish) || (bPortal && aNpubish)) return true;

  return false;
}

function mergePair(a: GatewayStatusSiteRow, b: GatewayStatusSiteRow): GatewayStatusSiteRow {
  const base = pickBaseRow(a, b);
  const title = chooseDisplayHeading([a, b]);
  return { ...base, title };
}

/**
 * Collapse gateway duplicates: same author + same description, or portal + npub-style
 * site label, or identical titles. Then one card per hostname for edge cases.
 */
function mergeDuplicateGatewayRows(sites: GatewayStatusSiteRow[]): GatewayStatusSiteRow[] {
  let list = [...sites];
  let changed = true;
  while (changed) {
    changed = false;
    outer: for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const A = list[i]!;
        const B = list[j]!;
        if (!mergeable(A, B)) continue;
        const merged = mergePair(A, B);
        list = list.filter((_, idx) => idx !== i && idx !== j);
        list.push(merged);
        changed = true;
        break outer;
      }
    }
  }
  return list;
}

export function dedupeGatewaySitesByHostname(
  sites: GatewayStatusSiteRow[]
): GatewayStatusSiteRow[] {
  const seen = new Set<string>();
  const out: GatewayStatusSiteRow[] = [];
  for (const s of sites) {
    const k = siteHostnameKey(s.siteUrl);
    if (!k || seen.has(k)) {
      continue;
    }
    seen.add(k);
    out.push(s);
  }
  return out;
}

/** Use on `/pages` payload: merge logical dupes, then hostname uniqueness. */
export function dedupeGatewaySitesForDirectory(
  sites: GatewayStatusSiteRow[]
): GatewayStatusSiteRow[] {
  return dedupeGatewaySitesByHostname(mergeDuplicateGatewayRows(sites));
}
