/**
 * Decide whether a freshly fetched listing should replace the on-screen /
 * localStorage tree, and what the merged tree should be.
 *
 * Hollow local extras (path-only `dist/*`) must not block a smaller forge
 * or bridge listing. Real local uploads with bodies are kept via overlay.
 */
import {
  type PathishRepoFile,
  localExtrasAreHollowOnly,
  overlayLocalBodiesOnRemoteTree,
} from "./file-inline-body";
import { allowShrinkToSourceUpstreamTree } from "./forge-tree-shrink";
import {
  shouldApplyFetchedFileTree,
  shouldMergeFetchedFileTree,
} from "./repo-file-tree-branch";

export function prepareFetchedFileTree<T extends PathishRepoFile>(opts: {
  incoming: T[];
  local: T[];
  overridePaths?: Iterable<string> | null;
  hasUnpushedEdits?: boolean;
  sourceType?: string | null;
  sourceUrl?: string | null;
  forkedFrom?: string | null;
  clone?: string[] | null;
  incomingBranch: string;
  activeBranch: string;
  existingNestedCount?: number;
  incomingNestedCount?: number;
}): {
  files: T[];
  apply: boolean;
  allowShrink: boolean;
  hollowExtrasOnly: boolean;
} {
  const incoming = Array.isArray(opts.incoming) ? opts.incoming : [];
  const local = Array.isArray(opts.local) ? opts.local : [];
  const hollowExtrasOnly = localExtrasAreHollowOnly(local, incoming);
  const effectiveDirty = opts.hasUnpushedEdits === true && !hollowExtrasOnly;
  const allowShrink = allowShrinkToSourceUpstreamTree({
    hasUnpushedEdits: effectiveDirty,
    sourceType: opts.sourceType,
    sourceUrl: opts.sourceUrl,
    forkedFrom: opts.forkedFrom,
    clone: opts.clone,
  });
  const files = overlayLocalBodiesOnRemoteTree(
    incoming,
    local,
    opts.overridePaths
  );
  const existingCount = local.length;
  const shrinkOrHollow = allowShrink || hollowExtrasOnly;
  const shouldApply = shouldApplyFetchedFileTree(
    opts.incomingBranch,
    existingCount,
    opts.activeBranch,
    incoming.length,
    {
      allowShrink: shrinkOrHollow,
      existingNestedCount: opts.existingNestedCount,
      incomingNestedCount: opts.incomingNestedCount,
    }
  );
  const shouldMerge = shouldMergeFetchedFileTree(
    existingCount,
    incoming.length,
    { allowShrink: shrinkOrHollow }
  );
  const apply =
    incoming.length > 0 &&
    opts.incomingBranch === opts.activeBranch &&
    (shouldApply || shouldMerge || hollowExtrasOnly);

  return { files, apply, allowShrink, hollowExtrasOnly };
}
