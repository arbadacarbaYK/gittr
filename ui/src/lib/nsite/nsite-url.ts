import { nip19 } from "nostr-tools";

import { pubkeyHexToPubkeyB36 } from "./pubkey-base36";

export function getPagesHostname(pagesBaseUrl: string): string {
  try {
    return new URL(pagesBaseUrl).hostname;
  } catch {
    return "pages.gittr.space";
  }
}

/**
 * NIP-5A: named-site label is 50-char pubkeyB36 + d tag (1–13 chars), no separator.
 */
export function buildNsiteSiteUrl(
  pagesBaseUrl: string,
  pubkeyHex: string,
  options: { kind: "root" } | { kind: "named"; dTag: string }
): string {
  const base = pagesBaseUrl.replace(/\/$/, "");
  const host = getPagesHostname(base);
  const protocol = base.startsWith("http") ? new URL(base).protocol : "https:";

  if (options.kind === "root") {
    const npub = nip19.npubEncode(pubkeyHex);
    return `${protocol}//${npub}.${host}/`;
  }
  const b36 = pubkeyHexToPubkeyB36(pubkeyHex);
  if (!b36) {
    return `${protocol}//${host}/`;
  }
  return `${protocol}//${b36}${options.dTag}.${host}/`;
}

/**
 * Map a repo slug to a valid NIP-5A `d` tag fragment (1–13 chars, [a-z0-9-], not ending with '-').
 */
export function slugToNsiteDTag(slug: string): string {
  let s = slug
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (s.length > 13) {
    s = s.slice(0, 13).replace(/-+$/, "");
  }
  if (!s) {
    s = "site";
  }
  if (s.endsWith("-")) {
    s = s.replace(/-+$/, "") || "site";
  }
  return s;
}
