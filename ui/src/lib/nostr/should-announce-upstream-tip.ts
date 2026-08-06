/**
 * When Push to Nostr should announce the forge tip (exact GitHub/GitLab/… SHAs)
 * instead of inventing a new "Push from gittr" commit on the bridge.
 *
 * Refetch caches file content in overrides — that is NOT a local edit.
 * Only `hasUnpushedEdits` means the user changed something after upstream.
 */
import { isCloneableUpstreamSourceUrl } from "../utils/detect-git-forge";
import { normalizeGithubSourceUrl } from "../utils/normalize-github-source-url";

export function shouldAnnounceUpstreamTip(opts: {
  sourceUrl?: string | null;
  hasUnpushedEdits?: boolean;
}): boolean {
  if (opts.hasUnpushedEdits === true) return false;
  const raw = (opts.sourceUrl || "").trim();
  if (!raw) return false;
  const normalized = normalizeGithubSourceUrl(raw) || raw;
  return isCloneableUpstreamSourceUrl(normalized);
}
