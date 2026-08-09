/**
 * "Forked from" in the UI must mean a real foreign forge upstream — never the
 * owner's own GRASP / Nostr-git mirror clone URL (e.g. git.shakespeare.diy/npub…/repo).
 */

import { isGraspCloneUrl } from "../utils/grasp-servers";

import { urlLooksLikeSourceUpstream } from "./forge-tree-shrink";

export function isDisplayableForkAttribution(
  raw: string | null | undefined
): boolean {
  const u = String(raw || "").trim();
  if (!u) return false;
  if (isGraspCloneUrl(u)) return false;
  if (/\/npub1[a-z0-9]+/i.test(u)) return false;
  if (/\/grasp\//i.test(u)) return false;
  return urlLooksLikeSourceUpstream(u);
}

/** Drop GRASP/mirror values that were wrongly stored as forkedFrom/sourceUrl. */
export function sanitizeForkedFromField(
  raw: string | null | undefined
): string | undefined {
  if (!isDisplayableForkAttribution(raw)) return undefined;
  return String(raw).trim().replace(/\.git$/i, "");
}
