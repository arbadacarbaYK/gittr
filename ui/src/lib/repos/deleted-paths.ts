/**
 * Local tombstones for files/folders removed in the browser before push.
 * A folder path hides that path and every descendant.
 */

export function normalizeDeletedPath(path: string): string {
  if (!path || typeof path !== "string") return "";
  const normalized = path.trim().replace(/^\/+|\/+$/g, "");
  return normalized || "";
}

/** True when path is an exact deleted entry or lives under a deleted folder. */
export function isRepoPathDeleted(
  path: string,
  deletedPaths: string[]
): boolean {
  const normalized = normalizeDeletedPath(path);
  if (!normalized || !Array.isArray(deletedPaths) || deletedPaths.length === 0) {
    return false;
  }
  return deletedPaths.some((raw) => {
    const deleted = normalizeDeletedPath(raw);
    if (!deleted) return false;
    return normalized === deleted || normalized.startsWith(`${deleted}/`);
  });
}

/**
 * Mark a file or folder as deleted. Folder tombstones hide all descendants.
 * Redundant descendant tombstones under the same path are pruned.
 */
export function appendRepoDeletedPath(
  deletedPaths: string[],
  pathToDelete: string
): string[] {
  const target = normalizeDeletedPath(pathToDelete);
  if (!target) return Array.isArray(deletedPaths) ? [...deletedPaths] : [];
  const current = Array.isArray(deletedPaths) ? deletedPaths : [];
  if (isRepoPathDeleted(target, current)) {
    return current;
  }
  const pruned = current.filter((raw) => {
    const deleted = normalizeDeletedPath(raw);
    if (!deleted) return false;
    return !(deleted === target || deleted.startsWith(`${target}/`));
  });
  return [...pruned, target];
}

/**
 * After files are re-added, drop tombstones that would hide them.
 * If a folder tombstone is cleared because a child was re-uploaded, expand the
 * remaining known siblings back into individual deleted paths so the rest of
 * the folder stays gone.
 */
export function reconcileDeletedPathsAfterAdd(
  deletedPaths: string[],
  addedPaths: string[],
  knownPaths: string[] = []
): string[] {
  const current = Array.isArray(deletedPaths) ? deletedPaths : [];
  const added = (addedPaths || [])
    .map(normalizeDeletedPath)
    .filter((p): p is string => Boolean(p));
  if (added.length === 0) return current;

  const addedSet = new Set(added);
  const known = (knownPaths || [])
    .map(normalizeDeletedPath)
    .filter((p): p is string => Boolean(p));

  let next = current
    .map(normalizeDeletedPath)
    .filter((p): p is string => Boolean(p));

  for (const addedPath of added) {
    const covering = next.filter(
      (deleted) =>
        addedPath === deleted || addedPath.startsWith(`${deleted}/`)
    );
    if (covering.length === 0) continue;

    next = next.filter((deleted) => !covering.includes(deleted));

    for (const cover of covering) {
      if (addedPath === cover) continue;
      for (const path of known) {
        if (
          path !== cover &&
          path.startsWith(`${cover}/`) &&
          !addedSet.has(path) &&
          !next.includes(path)
        ) {
          next.push(path);
        }
      }
    }
  }

  return next;
}
