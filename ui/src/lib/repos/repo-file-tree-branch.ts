/**
 * Keep file tree listings and per-file fetches on the same git branch.
 * Prevents flip-flop when parallel fetches use different branches (e.g. main vs feature).
 */

export function resolveActiveRepoBranch(
  repo:
    | { filesBranch?: string; defaultBranch?: string }
    | null
    | undefined,
  selectedBranch: string
): string {
  const sel = (selectedBranch || "").trim();
  if (sel) return sel;
  const filesBr = (repo?.filesBranch || "").trim();
  if (filesBr) return filesBr;
  return (repo?.defaultBranch || "").trim() || "main";
}

/** Only replace the visible tree when the fetch matches the branch the user is on. */
export function shouldApplyFetchedFileTree(
  incomingBranch: string,
  existingFileCount: number,
  activeBranch: string
): boolean {
  if (existingFileCount === 0) return true;
  return incomingBranch === activeBranch;
}
