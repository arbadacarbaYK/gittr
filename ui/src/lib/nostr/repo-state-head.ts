import { sanitizeGitObjectId } from "./kind1618-pr-git-hints";

/**
 * Tip SHA from a NIP-34 kind 30618 state event.
 * Homepage "new commit" rows used the state event id; git commits are 40-char SHAs.
 */
export function headCommitIdFromRepoStateTags(
  tags: unknown
): string | undefined {
  const list = Array.isArray(tags) ? tags : [];
  let headRef = "";
  for (const tag of list) {
    if (!Array.isArray(tag) || tag[0] !== "HEAD") continue;
    const raw = typeof tag[1] === "string" ? tag[1].trim() : "";
    const match = raw.match(/^ref:\s*(refs\/heads\/\S+)/i);
    if (match?.[1]) {
      headRef = match[1];
      break;
    }
  }
  if (headRef) {
    for (const tag of list) {
      if (!Array.isArray(tag) || tag[0] !== headRef) continue;
      const sha = sanitizeGitObjectId(
        typeof tag[1] === "string" ? tag[1] : undefined
      );
      if (sha) return sha;
    }
  }
  for (const tag of list) {
    if (!Array.isArray(tag) || typeof tag[0] !== "string") continue;
    if (!tag[0].startsWith("refs/heads/")) continue;
    const sha = sanitizeGitObjectId(
      typeof tag[1] === "string" ? tag[1] : undefined
    );
    if (sha) return sha;
  }
  return undefined;
}
