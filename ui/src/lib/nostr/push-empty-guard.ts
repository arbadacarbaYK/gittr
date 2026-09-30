/**
 * Push policy for a browser that knows file names but not file bytes.
 * Publishing kind 30617/30618 in that state creates a public repo with no git objects.
 */

export const FILE_BYTES_MISSING_MESSAGE =
  "Push stopped. This browser has the file names, but not the file contents. Open the repo and wait until the files load, then push again. Nothing was published.";

export const EMPTY_STATE_BLOCKED_MESSAGE =
  "Push stopped. The files were not stored on the git server, so no branch was published. If a repo card already appeared, open the repo in this browser and push again once the files are loaded.";

export function blockPushWhenFileBytesMissing(opts: {
  deferToBridgeSourceClone: boolean;
  filesWithContent: number;
  namedFileCount: number;
}): boolean {
  if (opts.deferToBridgeSourceClone) return false;
  if (opts.filesWithContent > 0) return false;
  return opts.namedFileCount > 0;
}

/** A kind 30618 with a blank commit id advertises a branch that has no files. */
export function blockEmptyRepositoryState(refsWithCommitShas: number): boolean {
  return refsWithCommitShas <= 0;
}
