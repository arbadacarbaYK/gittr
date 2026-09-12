import { getPagesHostname } from "../nsite/nsite-url";
import { pubkeyHexToPubkeyB36 } from "../nsite/pubkey-base36";

/**
 * True when a gateway status row is this repo's named/root site.
 *
 * Do NOT use substring includes(dTag): for dTag "gittr", every
 * `*.pages.gittr.space` URL contains "gittr" and false-positives.
 */
function hostnameMatchesNamedDTag(
  siteUrl: string,
  dTag: string,
  pagesHost: string
): boolean {
  const d = dTag.trim().toLowerCase();
  if (!d) return false;
  let host = pagesHost.toLowerCase();
  try {
    host = getPagesHostname(
      pagesHost.startsWith("http") ? pagesHost : `https://${pagesHost}`
    ).toLowerCase();
  } catch {
    /* keep */
  }
  try {
    const hostname = new URL(siteUrl).hostname.toLowerCase();
    if (hostname === `${d}.${host}`) return true;
    if (
      hostname.endsWith(`${d}.${host}`) &&
      hostname.length > d.length + host.length + 1
    ) {
      return true;
    }
  } catch {
    if (siteUrl.endsWith(`${d}.${host}`)) return true;
  }
  return false;
}

export function gatewaySiteMatchesRepo(
  siteUrl: string | undefined | null,
  namedUrl: string,
  dTag: string,
  pagesHost = "pages.gittr.space",
  extra?: { rootUrl?: string | null; extraDTags?: string[] }
): boolean {
  const u = (siteUrl || "").replace(/\/$/, "").toLowerCase();
  if (!u) return false;
  const want = namedUrl.replace(/\/$/, "").toLowerCase();
  if (want && u === want) return true;
  const rootWant = (extra?.rootUrl || "").replace(/\/$/, "").toLowerCase();
  if (rootWant && u === rootWant) return true;

  const tags = [dTag, ...(extra?.extraDTags || [])]
    .map((t) => (t || "").trim().toLowerCase())
    .filter(Boolean);
  const seen = new Set<string>();
  for (const d of tags) {
    if (seen.has(d)) continue;
    seen.add(d);
    if (hostnameMatchesNamedDTag(u, d, pagesHost)) return true;
  }
  return false;
}

/**
 * Named-site d-tag from `{b36}{d}.pages.gittr.space`. Empty string = owner
 * root host (no d-tag). Null = not this author's pages host.
 */
export function extractNamedPagesDTagFromSiteUrl(
  siteUrl: string | undefined | null,
  ownerPubkeyHex: string,
  pagesHost = "pages.gittr.space"
): string | null {
  const b36 = pubkeyHexToPubkeyB36(ownerPubkeyHex).toLowerCase();
  if (!b36) return null;
  let host = pagesHost.toLowerCase();
  try {
    host = getPagesHostname(
      pagesHost.startsWith("http") ? pagesHost : `https://${pagesHost}`
    ).toLowerCase();
  } catch {
    /* keep */
  }
  try {
    const hostname = new URL(String(siteUrl || "")).hostname.toLowerCase();
    const suffix = `.${host}`;
    if (!hostname.endsWith(suffix)) return null;
    const left = hostname.slice(0, -suffix.length);
    if (left === b36) return "";
    if (!left.startsWith(b36)) return null;
    return left.slice(b36.length) || null;
  } catch {
    return null;
  }
}

export type GatewaySiteRow = { siteUrl?: string };

/**
 * Prefer the saved/public Pages name over leftover truncated hosts when the
 * gateway lists several sites for the same author.
 */
export function pickBestGatewaySiteForRepo(
  sites: GatewaySiteRow[],
  namedUrl: string,
  dTag: string,
  pagesHost = "pages.gittr.space",
  extra?: {
    rootUrl?: string | null;
    extraDTags?: string[];
    ownerPubkeyHex?: string;
  }
): { siteUrl: string; matchedDTag: string | null } | null {
  const primary = dTag.trim().toLowerCase();
  const extras = new Set(
    (extra?.extraDTags || []).map((t) => t.trim().toLowerCase()).filter(Boolean)
  );
  const owner = (extra?.ownerPubkeyHex || "").trim().toLowerCase();
  let best: {
    siteUrl: string;
    matchedDTag: string | null;
    score: number;
  } | null = null;
  const matchExtra = {
    rootUrl: extra?.rootUrl,
    extraDTags: extra?.extraDTags,
  };
  for (const row of sites) {
    const siteUrl = (row?.siteUrl || "").trim();
    if (!siteUrl) continue;
    if (
      !gatewaySiteMatchesRepo(siteUrl, namedUrl, dTag, pagesHost, matchExtra)
    ) {
      continue;
    }
    const extracted = owner
      ? extractNamedPagesDTagFromSiteUrl(siteUrl, owner, pagesHost)
      : null;
    const extractedD = extracted && extracted.length > 0 ? extracted : null;
    let score = 10;
    if (
      siteUrl.replace(/\/$/, "").toLowerCase() ===
      namedUrl.replace(/\/$/, "").toLowerCase()
    ) {
      score = 100;
    } else if (extractedD && extractedD === primary) {
      score = 90;
    } else if (extractedD && extras.has(extractedD)) {
      score = 70 + Math.min(extractedD.length, 13);
    } else if (
      extra?.rootUrl &&
      siteUrl.replace(/\/$/, "").toLowerCase() ===
        extra.rootUrl.replace(/\/$/, "").toLowerCase()
    ) {
      score = 20;
    }
    if (!best || score > best.score) {
      best = { siteUrl, matchedDTag: extractedD, score };
    }
  }
  return best ? { siteUrl: best.siteUrl, matchedDTag: best.matchedDTag } : null;
}
