/**
 * Keep file tree listings and per-file fetches on the same git branch.
 * Prevents flip-flop when parallel fetches use different branches (e.g. main vs feature).
 */

/** Branch for repo sub-pages (commits, releases, …): URL param, then stored default, then main. */
export function resolveRepoTabBranch(
  searchParams: { get(name: string): string | null } | null | undefined,
  repo?: { defaultBranch?: string } | null
): string {
  const fromQuery = searchParams?.get("branch")?.trim();
  if (fromQuery) return fromQuery;
  const fromRepo = (repo?.defaultBranch || "").trim();
  if (fromRepo) return fromRepo;
  return "main";
}

/** Append `?branch=` for cross-tab navigation (GitHub uses master, gittr default was main). */
export function withRepoBranchQuery(
  path: string,
  branch: string,
  existingSearch?: { toString(): string } | null
): string {
  if (existingSearch?.toString()) {
    const params = new URLSearchParams(existingSearch.toString());
    if (branch && !params.has("branch")) {
      params.set("branch", branch);
    }
    const q = params.toString();
    return q ? `${path}?${q}` : path;
  }
  if (branch && branch !== "main") {
    return `${path}?branch=${encodeURIComponent(branch)}`;
  }
  if (branch === "master") {
    return `${path}?branch=${encodeURIComponent(branch)}`;
  }
  return path;
}

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

/** Branch for per-file / README fetches — must match the tree we already loaded. */
export function resolveContentBranch(
  repo:
    | { filesBranch?: string; defaultBranch?: string }
    | null
    | undefined,
  selectedBranch: string
): string {
  const filesBr = (repo?.filesBranch || "").trim();
  if (filesBr) return filesBr;
  const sel = (selectedBranch || "").trim();
  if (sel) return sel;
  return (repo?.defaultBranch || "").trim() || "main";
}

export function branchesToTryForContent(
  repo:
    | { filesBranch?: string; defaultBranch?: string }
    | null
    | undefined,
  selectedBranch: string
): string[] {
  const primary = resolveContentBranch(repo, selectedBranch);
  return [primary, repo?.defaultBranch, selectedBranch, "main", "master"]
    .map((b) => (typeof b === "string" ? b.trim() : ""))
    .filter((b): b is string => !!b)
    .filter((b, i, arr) => arr.indexOf(b) === i);
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
