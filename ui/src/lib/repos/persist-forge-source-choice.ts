import { isCloneableUpstreamSourceUrl } from "@/lib/utils/detect-git-forge";
import { findRepoByEntityAndName } from "@/lib/utils/repo-finder";

import { loadStoredRepos, saveStoredRepos } from "./storage";
import type { StoredRepo } from "./storage";

function normGitUrl(raw: string | undefined | null): string {
  return String(raw || "")
    .trim()
    .replace(/\.git$/i, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}

function findStoredIndex(
  entity: string,
  repoName: string
): {
  repos: StoredRepo[];
  idx: number;
} {
  const repos = loadStoredRepos();
  const idx = repos.findIndex(
    (row) => findRepoByEntityAndName([row], entity, repoName) !== undefined
  );
  return { repos, idx };
}

/** Owner dropped the forge source. Later pushes must not copy it back. */
export function persistForgeSourceCleared(opts: {
  entity: string;
  repo: string;
  /** Unix seconds of the card that cleared it. */
  clearedAt: number;
  previousSourceUrl?: string | null;
}): void {
  const { repos, idx } = findStoredIndex(opts.entity, opts.repo);
  if (idx < 0) return;
  const existing = repos[idx]!;
  const dropped = normGitUrl(opts.previousSourceUrl || existing.sourceUrl);
  const clone = (Array.isArray(existing.clone) ? existing.clone : []).filter(
    (url) => !dropped || normGitUrl(url) !== dropped
  );
  const next: StoredRepo = {
    ...existing,
    clone,
    forgeSourceClearedAt: opts.clearedAt,
  };
  delete next.sourceUrl;
  const fork = normGitUrl(existing.forkedFrom);
  if (dropped && fork && fork === dropped) {
    delete next.forkedFrom;
  }
  repos[idx] = next;
  saveStoredRepos(repos);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("gittr:repos-updated"));
  }
}

/** Owner pointed source at a public forge that already has the same commits. */
export function persistAdoptedForgeSource(opts: {
  entity: string;
  repo: string;
  sourceUrl: string;
}): void {
  const clean = opts.sourceUrl.trim().replace(/\.git$/i, "");
  if (!clean || !isCloneableUpstreamSourceUrl(clean)) return;
  const { repos, idx } = findStoredIndex(opts.entity, opts.repo);
  if (idx < 0) return;
  const next: StoredRepo = {
    ...repos[idx]!,
    sourceUrl: clean,
  };
  delete next.forgeSourceClearedAt;
  repos[idx] = next;
  saveStoredRepos(repos);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("gittr:repos-updated"));
  }
}
