/**
 * Push policy for a browser that knows file names but not file bytes.
 * Publishing kind 30617/30618 in that state creates a public repo with no git objects.
 */

export const FILE_BYTES_MISSING_MESSAGE =
  "Push stopped. This browser has the file names, but not the file contents. Open the repo and wait until the files load, then push again. Nothing was published.";

export const EMPTY_STATE_BLOCKED_MESSAGE =
  "Push stopped. The files were not stored on the git server, so no branch was published. If a repo card already appeared, open the repo in this browser and push again once the files are loaded.";

/** Shown when the git copy fails before any announcement is sent. */
export const OBJECTS_NOT_COPIED_MESSAGE =
  "Push stopped. The files never landed on the git server, so the repository was not announced. Stay on this page and try again.";

/**
 * Forge import (the bridge clones the upstream tip) must not publish kind
 * 30617 until those commits exist. Announcing first makes the bridge create
 * an empty bare repo, and a failed copy leaves that empty card up.
 *
 * Local edits stay on the old order: announce the empty shell, then HTTP-push
 * the bytes. Copying those bytes first would make the bridge see an existing
 * repo and fetch the forge tip over the edits.
 */
export function requireObjectsBeforeAnnouncement(opts: {
  deferToBridgeSourceClone: boolean;
}): boolean {
  return opts.deferToBridgeSourceClone;
}

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
