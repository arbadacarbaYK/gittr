import {
  GITTR_OWNER_PUBKEY_HEX,
  gittrRepoSlugForPagesDTag,
} from "../gittr-repo-links";
import { gittrRepoPathFromNip34A } from "../nostr/nip82-software";

import { authorPubkeyHexNormalized } from "./author-card-label";
import { extractNamedPagesDTagFromSiteUrl } from "./gateway-site-match";

function looksLikeRepoSlug(value: string): boolean {
  const s = value.trim();
  if (!s || s.length > 100) return false;
  if (/[\s/?#]/.test(s)) return false;
  return /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(s);
}

/**
 * gittr Code path for a Pages directory row when we can name the repo.
 *
 * Named-site `d` tags are not always the 30617 slug (`gittr-docu` ≠ `gittr`).
 * Prefer the platform reverse map, then a repo-shaped title (Push Manifest
 * uses the repo name), then the d-tag itself when it already looks like a slug.
 * Root npub sites have no single repo.
 */
export function gittrRepoPathForPagesSite(site: {
  siteUrl: string;
  title?: string;
  authorPubkeyHex?: string;
}): string | null {
  const hex = authorPubkeyHexNormalized(site.authorPubkeyHex);
  if (!hex) return null;
  const dTag = extractNamedPagesDTagFromSiteUrl(site.siteUrl, hex);
  if (dTag === null || dTag === "") return null;

  let repo: string | null = null;
  if (hex === GITTR_OWNER_PUBKEY_HEX) {
    repo = gittrRepoSlugForPagesDTag(dTag);
  }
  const title = (site.title || "").trim();
  if (!repo && looksLikeRepoSlug(title)) {
    repo = title;
  }
  if (!repo && looksLikeRepoSlug(dTag)) {
    repo = dTag;
  }
  if (!repo) return null;
  return gittrRepoPathFromNip34A(`30617:${hex}:${repo}`);
}
