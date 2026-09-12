import { pickProfileDisplayName } from "../nostr/kind0-profile-fields";

import {
  authorSearchTokens,
  siteHostname,
  siteKindLabel,
} from "./author-card-label";
import { extractNamedPagesDTagFromSiteUrl } from "./gateway-site-match";
import type { GatewayStatusSiteRow } from "./parse-gateway-status-html";

export type PagesSearchAuthorMeta = {
  name?: unknown;
  display_name?: unknown;
  displayName?: unknown;
  nip05?: string | null;
};

/**
 * Kind-0 names are fetched after the first paint. Site-name / URL / npub
 * queries do not need that round-trip.
 */
export function queryNeedsKind0Names(query: string): boolean {
  const t = query.trim().toLowerCase();
  if (!t) return false;
  if (t.startsWith("http://") || t.startsWith("https://")) return false;
  if (t.startsWith("npub1")) return false;
  if (t.includes(".")) return false;
  if (/^[0-9a-f]{8,}$/i.test(t)) return false;
  return /[a-z]/.test(t);
}

export function pagesSiteSearchHaystack(
  site: GatewayStatusSiteRow,
  extra?: { authorMeta?: PagesSearchAuthorMeta | null }
): string {
  const dTag =
    extractNamedPagesDTagFromSiteUrl(
      site.siteUrl,
      site.authorPubkeyHex || ""
    ) || "";
  const kind0Name = pickProfileDisplayName(extra?.authorMeta) || "";
  const nip05 = (extra?.authorMeta?.nip05 || "").trim();
  return [
    site.title,
    authorSearchTokens(site),
    site.description,
    site.siteUrl,
    siteHostname(site.siteUrl),
    dTag,
    siteKindLabel(site.siteKind),
    site.updatedLabel,
    kind0Name,
    nip05,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function pagesSiteMatchesQuery(
  site: GatewayStatusSiteRow,
  query: string,
  extra?: { authorMeta?: PagesSearchAuthorMeta | null }
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return pagesSiteSearchHaystack(site, extra).includes(q);
}
