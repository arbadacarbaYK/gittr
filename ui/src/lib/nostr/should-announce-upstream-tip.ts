/**
 * When Push to Nostr should announce the forge tip (exact GitHub/GitLab/… SHAs)
 * instead of inventing a new "Push from gittr" commit on the bridge.
 *
 * Refetch caches file content in overrides — that is NOT a local edit.
 * Only `hasUnpushedEdits` means the user changed something after upstream.
 *
 * Large forge trees: prefer one server `sync-from-source` over N× `/api/git/file-content`
 * (Refetch hydrate + Push rehydrate were hammering GitHub/proxy into HTTP 429).
 */
import { isCloneableUpstreamSourceUrl } from "../utils/detect-git-forge";
import { normalizeGithubSourceUrl } from "../utils/normalize-github-source-url";

/** Skip client-side file-content floods when the tree is at least this large. */
export const LARGE_FORGE_TREE_BRIDGE_SYNC_THRESHOLD = 50;

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

/**
 * Prefer bridge `sync-from-source` (one git fetch) over per-file HTTP hydrate.
 *
 * Extends {@link shouldAnnounceUpstreamTip} for:
 * - post-Refetch tip announce (session hint; edits after Refetch clear the hint)
 * - metadata-only trees falsely marked dirty (no local bodies at all)
 */
export function shouldPreferBridgeSyncFromSource(opts: {
  sourceUrl?: string | null;
  hasUnpushedEdits?: boolean;
  /** sessionStorage `gittr_post_source_refetch_hint_v1__*` after forge Refetch */
  postSourceRefetchPending?: boolean;
  deletedPathCount?: number;
  fileCount?: number;
  filesWithLocalContent?: number;
}): boolean {
  if (
    shouldAnnounceUpstreamTip({
      sourceUrl: opts.sourceUrl,
      hasUnpushedEdits: opts.hasUnpushedEdits,
    })
  ) {
    return true;
  }

  const forgeOk = shouldAnnounceUpstreamTip({
    sourceUrl: opts.sourceUrl,
    hasUnpushedEdits: false,
  });
  if (!forgeOk) return false;

  const fileCount = opts.fileCount ?? 0;
  const withContent = opts.filesWithLocalContent ?? 0;
  const deletedCount = opts.deletedPathCount ?? 0;
  const remainingFiles = Math.max(0, fileCount - deletedCount);

  // Large metadata-only tree (Refetch caches paths, not bodies). Prefer one
  // server git fetch over N× /api/git/file-content (HTTP 429 storms).
  const sparseMetadataTree =
    fileCount >= LARGE_FORGE_TREE_BRIDGE_SYNC_THRESHOLD &&
    withContent === 0;

  // Refetch just aligned local tree to forge — announce that tip, don't rewrite
  // via hundreds of file-content GETs (even if a stale dirty flag remains).
  if (opts.postSourceRefetchPending === true) {
    return true;
  }

  if (sparseMetadataTree) {
    return true;
  }

  // Refetch → delete paths on a metadata-only tree: sync upstream once, then
  // apply UI deletes on the bridge (deletedPaths). Any real local bodies mean
  // the user edited/uploaded — keep per-file push so those changes are kept.
  if (
    deletedCount > 0 &&
    remainingFiles >= LARGE_FORGE_TREE_BRIDGE_SYNC_THRESHOLD &&
    withContent === 0
  ) {
    return true;
  }

  return false;
}
