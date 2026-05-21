/**
 * Shared repo branch for Code, Commits, Issues, PRs — one ?branch= in the URL.
 */

const BOT_BRANCH_RE = /^(dependabot|renovate)\//i;

export function isBotFeatureBranch(name: string | undefined | null): boolean {
  return BOT_BRANCH_RE.test((name || "").trim());
}

/** Never treat dependabot/renovate as the repo default in UI or storage. */
export function sanitizeRepoDefaultBranch(
  defaultBranch: string | undefined | null,
  branches?: string[] | null
): string {
  const d = (defaultBranch || "").trim() || "main";
  if (!isBotFeatureBranch(d)) return d;
  const list = (branches || []).map((b) => (b || "").trim()).filter(Boolean);
  if (list.includes("main")) return "main";
  if (list.includes("master")) return "master";
  const canonical = list.find((b) => !isBotFeatureBranch(b));
  return canonical || "main";
}

export function repoDefaultBranch(
  repo?: { defaultBranch?: string; branches?: string[] } | null
): string {
  return sanitizeRepoDefaultBranch(
    (repo?.defaultBranch || "").trim() || "main",
    repo?.branches
  );
}

export function repoBranchPickStorageKey(entity: string, repo: string): string {
  return `gittr:branch-pick:${entity}/${repo}`;
}

export function readUserPickedRepoBranch(
  entity: string,
  repo: string
): string | null {
  if (typeof window === "undefined") return null;
  try {
    const v = sessionStorage
      .getItem(repoBranchPickStorageKey(entity, repo))
      ?.trim();
    return v || null;
  } catch {
    return null;
  }
}

export function writeUserPickedRepoBranch(
  entity: string,
  repo: string,
  branch: string | null
): void {
  if (typeof window === "undefined") return;
  try {
    const key = repoBranchPickStorageKey(entity, repo);
    if (branch?.trim()) sessionStorage.setItem(key, branch.trim());
    else sessionStorage.removeItem(key);
  } catch {
    /* ignore quota */
  }
}

/** Same branch on every repo tab: URL ?branch= if set, else stored repo default. */
export function resolveSharedRepoBranch(
  searchParams: { get(name: string): string | null } | null | undefined,
  repo?: { defaultBranch?: string; branches?: string[] } | null,
  route?: { entity: string; repo: string } | null
): string {
  const fromUrl = searchParams?.get("branch")?.trim();
  if (fromUrl) {
    if (!isBotFeatureBranch(fromUrl)) return fromUrl;
    if (
      route &&
      readUserPickedRepoBranch(route.entity, route.repo) === fromUrl
    ) {
      return fromUrl;
    }
  }
  return repoDefaultBranch(repo);
}

/** @deprecated alias */
export function resolveRepoTabBranch(
  searchParams: { get(name: string): string | null } | null | undefined,
  repo?: { defaultBranch?: string } | null
): string {
  return resolveSharedRepoBranch(searchParams, repo);
}

/** Build repo nav href with shared branch (+ optional file/path from Code). */
export function repoNavHref(
  path: string,
  branch: string,
  extraParams?: { get(name: string): string | null } | URLSearchParams | null
): string {
  const params =
    extraParams instanceof URLSearchParams
      ? new URLSearchParams(extraParams.toString())
      : extraParams
        ? new URLSearchParams()
        : new URLSearchParams();
  if (extraParams && !(extraParams instanceof URLSearchParams)) {
    for (const key of ["file", "path"] as const) {
      const v = extraParams.get(key);
      if (v) params.set(key, v);
    }
  }
  const b = (branch || "").trim();
  if (b) params.set("branch", b);
  const q = params.toString();
  return q ? `${path}?${q}` : path;
}

/**
 * Multifetch must not switch the branch dropdown to dependabot/main-heuristic noise.
 * Only accept fetch branch when it matches repo default or user already selected it.
 */
export function shouldSyncBranchFromFetch(
  resolvedBranch: string | undefined,
  repoDefault: string,
  currentSelected: string,
  userPickedBranch: boolean
): boolean {
  const b = (resolvedBranch || "").trim();
  if (!b) return false;
  const def = (repoDefault || "main").trim();
  const cur = (currentSelected || "").trim();
  if (userPickedBranch) return b === cur;
  if (b !== def) return false;
  return !cur || cur === def;
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
  return repoDefaultBranch(repo);
}

export function resolveContentBranch(
  repo:
    | { filesBranch?: string; defaultBranch?: string }
    | null
    | undefined,
  selectedBranch: string
): string {
  // User-selected / URL branch wins; filesBranch is only which tree is cached in memory.
  const sel = (selectedBranch || "").trim();
  if (sel) return sel;
  const filesBr = (repo?.filesBranch || "").trim();
  if (filesBr) return filesBr;
  return repoDefaultBranch(repo);
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

export function shouldApplyFetchedFileTree(
  incomingBranch: string,
  existingFileCount: number,
  activeBranch: string
): boolean {
  if (existingFileCount === 0) return true;
  return incomingBranch === activeBranch;
}
