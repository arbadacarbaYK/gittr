import { loadDiscussions } from "@/lib/discussions/storage";
import { inferLanguagesFromFiles } from "@/lib/repos/infer-languages-from-files";
import {
  type StoredRepo,
  loadRepoFiles,
  loadStoredRepos,
} from "@/lib/repos/storage";
import {
  getRepoStorageKey,
  readRepoIssuesFromLocalStorage,
  readRepoPullsFromLocalStorage,
} from "@/lib/utils/entity-normalizer";
import { normalizeIssueListStatus } from "@/lib/utils/issue-pr-status";
import { findRepoByEntityAndName } from "@/lib/utils/repo-finder";

export type InsightsCountSplit = {
  total: number;
  open: number;
  closed: number;
  merged?: number;
};

export type RepoInsightsSnapshot = {
  fileCount: number;
  storedStars: number;
  forks: number;
  contributors: number;
  issues: InsightsCountSplit;
  prs: InsightsCountSplit;
  commits: number;
  discussions: number;
  languages: Record<string, number>;
};

function emptySplit(): InsightsCountSplit {
  return { total: 0, open: 0, closed: 0 };
}

function countIssues(rows: unknown[]): InsightsCountSplit {
  let open = 0;
  let closed = 0;
  for (const row of rows) {
    const status =
      row && typeof row === "object" && "status" in row
        ? normalizeIssueListStatus((row as { status?: string }).status)
        : "open";
    if (status === "closed") closed += 1;
    else open += 1;
  }
  return { total: rows.length, open, closed };
}

function countPrs(rows: unknown[]): InsightsCountSplit {
  let open = 0;
  let merged = 0;
  let closed = 0;
  for (const row of rows) {
    const raw =
      row && typeof row === "object" && "status" in row
        ? String((row as { status?: string }).status || "open")
            .toLowerCase()
            .trim()
        : "open";
    if (raw === "merged") merged += 1;
    else if (raw === "closed") closed += 1;
    else open += 1;
  }
  return { total: rows.length, open, closed, merged };
}

export function countCachedCommits(entity: string, repo: string): number {
  if (typeof window === "undefined") return 0;
  try {
    const raw = localStorage.getItem(
      getRepoStorageKey("gittr_commits", entity, repo)
    );
    if (!raw) return 0;
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

function countFiles(
  stored: StoredRepo | undefined,
  entity: string,
  repo: string
): number {
  if (typeof stored?.fileCount === "number" && stored.fileCount > 0) {
    return stored.fileCount;
  }
  const tree = loadRepoFiles(entity, repo);
  if (tree.length > 0) {
    return tree.filter((f) => !f.type || f.type === "file").length;
  }
  if (Array.isArray(stored?.files) && stored.files.length > 0) {
    return stored.files.filter((f) => !f.type || f.type === "file").length;
  }
  return 0;
}

function languagesFor(
  stored: StoredRepo | undefined,
  entity: string,
  repo: string
): Record<string, number> {
  if (stored?.languages && Object.keys(stored.languages).length > 0) {
    return stored.languages;
  }
  const tree = loadRepoFiles(entity, repo);
  const fromTree = inferLanguagesFromFiles(tree);
  if (Object.keys(fromTree).length > 0) return fromTree;
  if (Array.isArray(stored?.files)) {
    return inferLanguagesFromFiles(stored.files);
  }
  return {};
}

/** Browser snapshot from the same stores Code / Issues / PRs / Commits already use. */
export function loadRepoInsightsSnapshot(
  entity: string,
  repo: string
): RepoInsightsSnapshot {
  if (typeof window === "undefined" || !entity || !repo) {
    return {
      fileCount: 0,
      storedStars: 0,
      forks: 0,
      contributors: 0,
      issues: emptySplit(),
      prs: emptySplit(),
      commits: 0,
      discussions: 0,
      languages: {},
    };
  }

  const stored = findRepoByEntityAndName<StoredRepo>(
    loadStoredRepos(),
    entity,
    repo
  );

  return {
    fileCount: countFiles(stored, entity, repo),
    storedStars:
      typeof stored?.stars === "number" && Number.isFinite(stored.stars)
        ? stored.stars
        : 0,
    forks:
      typeof stored?.forks === "number" && Number.isFinite(stored.forks)
        ? stored.forks
        : 0,
    contributors: Array.isArray(stored?.contributors)
      ? stored.contributors.length
      : 0,
    issues: countIssues(readRepoIssuesFromLocalStorage(entity, repo)),
    prs: countPrs(readRepoPullsFromLocalStorage(entity, repo)),
    commits: countCachedCommits(entity, repo),
    discussions: loadDiscussions(entity, repo).length,
    languages: languagesFor(stored, entity, repo),
  };
}
