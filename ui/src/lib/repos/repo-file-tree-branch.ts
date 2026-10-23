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

/**
 * Shallow `history.replaceState` updates the address bar without telling Next.
 * `useSearchParams()` stays on the old branch (often master). Tabs listen for
 * this and read `window.location.search` instead.
 */
export const REPO_QUERY_EVENT = "gittr:repo-query";

export function publishRepoQuery(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(REPO_QUERY_EVENT));
}

export function readLocationBranch(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const branch = new URLSearchParams(window.location.search)
      .get("branch")
      ?.trim();
    return branch || null;
  } catch {
    return null;
  }
}

/**
 * Address-bar `?branch=` wins over Next's search params when they disagree.
 * Pass `locationSearch: null` during SSR / first paint so hydration matches.
 */
export function preferLiveBranchSearchParams<
  T extends { get(name: string): string | null }
>(
  nextParams: T | null | undefined,
  locationSearch: string | null | undefined
): T | URLSearchParams {
  if (locationSearch == null) return nextParams ?? new URLSearchParams();
  const raw = locationSearch.startsWith("?")
    ? locationSearch.slice(1)
    : locationSearch;
  const live = new URLSearchParams(raw);
  if (live.get("branch")?.trim()) return live;
  return nextParams ?? live;
}

/** Merge query keys onto a repo href that may already contain `?branch=`. */
export function joinRepoHref(
  base: string,
  updates: Record<string, string | null | undefined>
): string {
  const hashIdx = base.indexOf("#");
  const hash = hashIdx === -1 ? "" : base.slice(hashIdx);
  const withoutHash = hashIdx === -1 ? base : base.slice(0, hashIdx);
  const qIdx = withoutHash.indexOf("?");
  const path = qIdx === -1 ? withoutHash : withoutHash.slice(0, qIdx);
  const params = new URLSearchParams(
    qIdx === -1 ? "" : withoutHash.slice(qIdx + 1)
  );
  for (const [key, value] of Object.entries(updates)) {
    const v = (value || "").trim();
    if (v) params.set(key, v);
    else params.delete(key);
  }
  const q = params.toString();
  return `${path}${q ? `?${q}` : ""}${hash}`;
}

const MAIN_MASTER = new Set(["main", "master"]);

/** Commit log tries. A named branch must not silently fall through to master. */
export function branchesToTryForCommits(
  requested: string,
  repo?: { defaultBranch?: string; branches?: string[] } | null
): string[] {
  const req = (requested || "").trim() || repoDefaultBranch(repo);
  const out = [req];
  // main and master are the same tip on many mirrors. A feature branch is not.
  if (req === "main") out.push("master");
  else if (req === "master") out.push("main");
  return out.filter((b, i, arr) => !!b && arr.indexOf(b) === i);
}

/** Whether a stored commit row belongs on the branch the viewer asked for. */
export function commitBelongsToBranch(
  commitBranch: string | undefined | null,
  requested: string
): boolean {
  const c = (commitBranch || "").trim();
  if (!c) return false;
  const req = (requested || "").trim();
  if (req && c === req) return true;
  if (MAIN_MASTER.has(req) && MAIN_MASTER.has(c)) return true;
  return false;
}

/**
 * main↔master only. Any other name in the address bar is the branch the
 * viewer picked — do not swap it for the repo default just because this
 * chrome's branch list has not caught up yet.
 */
function aliasDefaultTip(
  branch: string,
  repo?: { defaultBranch?: string; branches?: string[] } | null
): string {
  const name = (branch || "").trim();
  if (!name) return repoDefaultBranch(repo);
  const branches = (repo?.branches || [])
    .map((b) => (b || "").trim())
    .filter(Boolean);
  if (!branches.length || branches.includes(name)) return name;
  if (name === "main" && branches.includes("master")) return "master";
  if (name === "master" && branches.includes("main")) return "main";
  return name;
}

/**
 * Branch to keep in the address bar when `repo.branches` refreshes.
 * main↔master still aliases. Any other name stays, even if this list is
 * only the default — that refresh was putting master back after a pick.
 */
export function preserveAddressBarBranch(
  branch: string,
  repo?: { defaultBranch?: string; branches?: string[] } | null
): string {
  return aliasDefaultTip(branch, repo);
}

/**
 * Branch for Issues, PRs, Commits, and the other tabs.
 *
 * Next's useSearchParams() stays on the old tip until a full reload, because
 * the Code tab updates the address bar with history.replaceState. The address
 * bar (then the dropdown pick) is the branch to carry across.
 */
export function resolveTabBranch(
  nextParams: { get(name: string): string | null } | null | undefined,
  repo?: { defaultBranch?: string; branches?: string[] } | null,
  route?: { entity: string; repo: string } | null,
  locationSearch?: string | null
): string {
  const fromNext = (nextParams?.get("branch") || "").trim();
  let live = "";
  if (locationSearch != null) {
    const raw = locationSearch.startsWith("?")
      ? locationSearch.slice(1)
      : locationSearch;
    live = new URLSearchParams(raw).get("branch")?.trim() || "";
  }
  const picked = route
    ? (readUserPickedRepoBranch(route.entity, route.repo) || "").trim()
    : "";
  if (live) return aliasDefaultTip(live, repo);
  // Dropdown moved, address bar write has not landed, Next still says master.
  if (picked && picked !== fromNext) return aliasDefaultTip(picked, repo);
  return resolveSharedRepoBranch(nextParams, repo, route);
}

/** Same branch on every repo tab: URL ?branch= if set, else stored repo default.
 * When the URL tip is missing on the mirror (e.g. ?branch=main but only master),
 * fall back to the sibling default or repo default — never keep a dead tip.
 */
export function resolveSharedRepoBranch(
  searchParams: { get(name: string): string | null } | null | undefined,
  repo?: { defaultBranch?: string; branches?: string[] } | null,
  route?: { entity: string; repo: string } | null
): string {
  const fromUrl = searchParams?.get("branch")?.trim();
  const def = repoDefaultBranch(repo);
  const branches = (repo?.branches || [])
    .map((b) => (b || "").trim())
    .filter(Boolean);

  if (fromUrl) {
    if (isBotFeatureBranch(fromUrl)) {
      if (
        route &&
        readUserPickedRepoBranch(route.entity, route.repo) === fromUrl
      ) {
        return fromUrl;
      }
    } else if (!branches.length || branches.includes(fromUrl)) {
      return fromUrl;
    } else if (fromUrl === "main" && branches.includes("master")) {
      return "master";
    } else if (fromUrl === "master" && branches.includes("main")) {
      return "main";
    } else {
      return def;
    }
  }
  return def;
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
const CANONICAL_DEFAULT_BRANCHES = new Set(["main", "master"]);

export type FetchedTreeBranchOpts = {
  /**
   * True only when the viewer chose a named branch (dropdown / session pick).
   * Nav `?branch=` copied from a stored default is not a pick.
   */
  userPickedBranch?: boolean;
};

/**
 * Whether a fetched listing may replace the tree for this Code-tab branch.
 *
 * Git discovers HEAD under whatever name the repo uses (`develop`, `trunk`,
 * `gittr`, `master`, …). When the viewer did not pick a branch, that tip is
 * the default — names do not have to match. A real pick (`dev` in the
 * dropdown) must still match so we do not paint `main` onto `dev`.
 */
export function fetchedTreeBranchesCompatible(
  incomingBranch: string,
  activeBranch: string,
  opts?: FetchedTreeBranchOpts
): boolean {
  const incoming = (incomingBranch || "").trim();
  const active = (activeBranch || "").trim();
  if (!incoming || !active || incoming === active) return true;
  if (!opts?.userPickedBranch) return true;
  return incoming === active;
}

/** Remount / URL default must not throw away a cached tree for the git tip. */
export function shouldWipeCachedFileTreeOnBranchChange(opts: {
  cachedFilesBranch: string;
  currentBranch: string;
  userPickedBranch: boolean;
  hasFiles: boolean;
}): boolean {
  if (!opts.hasFiles) return false;
  if (!opts.userPickedBranch) return false;
  const cached = (opts.cachedFilesBranch || "").trim();
  const current = (opts.currentBranch || "").trim();
  if (!cached || !current) return false;
  return cached !== current;
}

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
  if (b === def) return !cur || cur === def;
  // GRASP mirrors often use `master` while UI default is `main` — still sync the tree.
  if (
    CANONICAL_DEFAULT_BRANCHES.has(b) &&
    CANONICAL_DEFAULT_BRANCHES.has(def)
  ) {
    return !cur || CANONICAL_DEFAULT_BRANCHES.has(cur);
  }
  // e.g. GitHub Pages repos: tree listed from `gh-pages` while Nostr/default still says `main`
  if (!userPickedBranch && b !== def) {
    return !cur || cur === def;
  }
  return false;
}

export function resolveActiveRepoBranch(
  repo: { filesBranch?: string; defaultBranch?: string } | null | undefined,
  selectedBranch: string
): string {
  const sel = (selectedBranch || "").trim();
  if (sel) return sel;
  const filesBr = (repo?.filesBranch || "").trim();
  if (filesBr) return filesBr;
  return repoDefaultBranch(repo);
}

export type RepoBranchRoute = { entity: string; repo: string };

export function userExplicitlyPickedBranch(
  route: RepoBranchRoute | null | undefined,
  selectedBranch: string
): boolean {
  const sel = (selectedBranch || "").trim();
  if (!route || !sel) return false;
  return readUserPickedRepoBranch(route.entity, route.repo) === sel;
}

export function resolveContentBranch(
  repo: { filesBranch?: string; defaultBranch?: string } | null | undefined,
  selectedBranch: string,
  route?: RepoBranchRoute | null
): string {
  const sel = (selectedBranch || "").trim();
  const filesBr = (repo?.filesBranch || "").trim();
  const def = repoDefaultBranch(repo);
  if (userExplicitlyPickedBranch(route, selectedBranch) && sel) {
    return sel;
  }
  if (filesBr) return filesBr;
  if (sel) return sel;
  return def;
}

export function branchesToTryForContent(
  repo:
    | {
        filesBranch?: string;
        defaultBranch?: string;
        successfulSources?: Array<{ resolvedBranch?: string } | null> | null;
      }
    | null
    | undefined,
  selectedBranch: string,
  route?: RepoBranchRoute | null
): string[] {
  const primary = resolveContentBranch(repo, selectedBranch, route);
  // Multifetch winners (e.g. pyramid → master) must lead — otherwise README/logo
  // burn time on bridge ?branch=main 404s while the tree already resolved master.
  const fromSources = (repo?.successfulSources || [])
    .map((s) =>
      s && typeof s.resolvedBranch === "string" ? s.resolvedBranch.trim() : ""
    )
    .filter((b): b is string => !!b);
  return [
    ...fromSources,
    primary,
    repo?.filesBranch,
    repo?.defaultBranch,
    selectedBranch,
    "main",
    "master",
  ]
    .map((b) => (typeof b === "string" ? b.trim() : ""))
    .filter((b): b is string => !!b)
    .filter((b, i, arr) => arr.indexOf(b) === i);
}

/** Count paths that live under a folder (have a `/`). Dirs at root do not count. */
export function nestedFilePathCount(
  files: Array<{ path?: string; type?: string }> | undefined | null
): number {
  if (!Array.isArray(files)) return 0;
  let n = 0;
  for (const f of files) {
    const p = String(f?.path || "").replace(/^\//, "");
    if (!p.includes("/")) continue;
    const t = String(f?.type || "file").toLowerCase();
    if (t === "dir" || t === "tree" || t === "folder") continue;
    n += 1;
  }
  return n;
}

/**
 * Decide whether a freshly fetched file tree may replace what's on screen /
 * in localStorage.
 *
 * Never replace a richer local tree with a smaller remote snapshot unless the
 * caller opts in (`allowShrink`) — that was wiping folder uploads after Push
 * when GRASP returned only a partial/flat listing on hard refresh.
 * Also refuse equal-count flat remotes when local still has nested paths.
 */
export function shouldApplyFetchedFileTree(
  incomingBranch: string,
  existingFileCount: number,
  activeBranch: string,
  incomingFileCount?: number,
  opts?: {
    allowShrink?: boolean;
    existingNestedCount?: number;
    incomingNestedCount?: number;
    userPickedBranch?: boolean;
    /** After GRASP-pollution / display scrub — 0 means treat as first load. */
    visibleExistingCount?: number;
  }
): boolean {
  const existing =
    typeof opts?.visibleExistingCount === "number"
      ? opts.visibleExistingCount
      : existingFileCount;
  if (existing === 0) return true;
  if (
    !fetchedTreeBranchesCompatible(incomingBranch, activeBranch, {
      userPickedBranch: opts?.userPickedBranch,
    })
  )
    return false;
  if (
    typeof incomingFileCount === "number" &&
    incomingFileCount > 0 &&
    incomingFileCount < existing &&
    !opts?.allowShrink
  ) {
    return false;
  }
  const existingNested = opts?.existingNestedCount ?? 0;
  const incomingNested = opts?.incomingNestedCount ?? 0;
  if (
    !opts?.allowShrink &&
    existingNested > 0 &&
    incomingNested < existingNested &&
    typeof incomingFileCount === "number" &&
    incomingFileCount > 0 &&
    incomingFileCount <= existing
  ) {
    return false;
  }
  return true;
}

/** Prefer merge (union by path) when remote listing is a strict subset. */
export function shouldMergeFetchedFileTree(
  existingFileCount: number,
  incomingFileCount: number,
  opts?: { allowShrink?: boolean }
): boolean {
  return (
    !opts?.allowShrink &&
    existingFileCount > 0 &&
    incomingFileCount > 0 &&
    incomingFileCount < existingFileCount
  );
}
