/**
 * Conflict detection for PR merges
 * Detects if changes in a PR conflict with the current state of the target branch
 */

export interface Conflict {
  path: string;
  type: "edit-edit" | "edit-delete" | "delete-edit";
  prContent?: string;
  baseContent?: string;
  message: string;
}

export interface ConflictResult {
  hasConflicts: boolean;
  conflicts: Conflict[];
}

/**
 * Detect conflicts between PR changes and current branch state
 * @param prFiles Files being changed in the PR
 * @param baseFiles Current state of files in the target branch
 * @param baseBranch Branch being merged into
 */
export function detectConflicts(
  prFiles: Array<{
    path: string;
    status: "added" | "modified" | "deleted";
    before?: string;
    after?: string;
  }>,
  baseFiles: Record<string, string>, // path -> content
  baseBranch: string = "main"
): ConflictResult {
  const conflicts: Conflict[] = [];

  for (const prFile of prFiles) {
    const currentContent = baseFiles[prFile.path];

    // Case 1: PR modifies a file that was deleted in base
    if (prFile.status === "modified" && currentContent === undefined) {
      conflicts.push({
        path: prFile.path,
        type: "edit-delete",
        prContent: prFile.after,
        baseContent: undefined,
        message: `File ${prFile.path} was deleted in ${baseBranch} but modified in PR`,
      });
    }

    // Case 2: PR deletes a file that was modified in base
    if (prFile.status === "deleted" && currentContent !== undefined) {
      // Check if content actually changed (not just the PR trying to delete)
      if (prFile.before !== currentContent) {
        conflicts.push({
          path: prFile.path,
          type: "delete-edit",
          prContent: undefined,
          baseContent: currentContent,
          message: `File ${prFile.path} was modified in ${baseBranch} but deleted in PR`,
        });
      }
    }

    // Case 3: PR modifies a file that was also modified in base (edit-edit conflict)
    if (prFile.status === "modified" && currentContent !== undefined) {
      // If the base content is different from what PR expected, there's a conflict
      if (prFile.before !== currentContent) {
        // Check if changes overlap (both modified the same parts)
        const hasOverlappingChanges = checkOverlappingChanges(
          prFile.before || "",
          prFile.after || "",
          currentContent
        );

        if (hasOverlappingChanges) {
          conflicts.push({
            path: prFile.path,
            type: "edit-edit",
            prContent: prFile.after,
            baseContent: currentContent,
            message: `File ${prFile.path} was modified in both ${baseBranch} and PR. Changes conflict.`,
          });
        }
      }
    }
  }

  return {
    hasConflicts: conflicts.length > 0,
    conflicts,
  };
}

/**
 * Check if changes overlap (simple heuristic)
 * If the base changed from what PR expected, and PR also changed it, conflict
 */
function checkOverlappingChanges(
  prBefore: string,
  prAfter: string,
  baseContent: string
): boolean {
  // Simple check: if base content is different from what PR expected (before),
  // and PR also changed it (before != after), it's a conflict
  if (prBefore !== baseContent && prBefore !== prAfter) {
    return true;
  }

  // More sophisticated: check if same lines were modified
  // For now, simple heuristic is enough
  return false;
}

/**
 * Resolve a conflict by choosing one version
 */
export function resolveConflict(
  conflict: Conflict,
  resolution: "pr" | "base" | "manual"
): { content: string | null; resolved: boolean } {
  if (resolution === "pr") {
    return {
      content: conflict.prContent || null,
      resolved: true,
    };
  }

  if (resolution === "base") {
    return {
      content: conflict.baseContent || null,
      resolved: true,
    };
  }

  // Manual resolution - content must be provided separately
  return {
    content: null,
    resolved: false,
  };
}
