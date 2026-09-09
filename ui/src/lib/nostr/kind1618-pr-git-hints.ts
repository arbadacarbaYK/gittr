import { collectCloneUrlsFromTags } from "./clone-url-quality";

/** Git object id from NIP-34 `c` / `merge-base` / `r` tags. */
export function sanitizeGitObjectId(raw: string | undefined): string | null {
  const s = String(raw || "")
    .trim()
    .toLowerCase();
  if (!/^[0-9a-f]{7,40}$/.test(s)) return null;
  return s;
}

export function nostrPrGitRef(eventId: string | undefined): string | null {
  const id = String(eventId || "")
    .trim()
    .toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(id)) return null;
  return `refs/nostr/${id}`;
}

export type Kind1618PrGitHints = {
  cloneUrls: string[];
  currentCommitId?: string;
  mergeBase?: string;
  earliestUniqueCommit?: string;
  branchName?: string;
};

function firstTagValue(tags: unknown[] | undefined, name: string): string {
  if (!Array.isArray(tags)) return "";
  for (const tag of tags) {
    if (!Array.isArray(tag) || tag[0] !== name) continue;
    const v = tag[1];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

/** Pull git fetch hints off a kind 1618 / 1619 event (content is markdown only). */
export function parseKind1618PrGitHints(
  tags: unknown[] | undefined | null
): Kind1618PrGitHints {
  const cloneUrls = collectCloneUrlsFromTags(tags);
  const currentCommitId =
    sanitizeGitObjectId(firstTagValue(tags as unknown[], "c")) || undefined;
  const mergeBase =
    sanitizeGitObjectId(firstTagValue(tags as unknown[], "merge-base")) ||
    undefined;
  const earliestUniqueCommit =
    sanitizeGitObjectId(firstTagValue(tags as unknown[], "r")) || undefined;
  const branchName =
    firstTagValue(tags as unknown[], "branch-name") || undefined;
  return {
    cloneUrls,
    currentCommitId,
    mergeBase,
    earliestUniqueCommit,
    branchName,
  };
}
