/**
 * Stable keys for repo-page chrome (Watch / Star / GitHub) and folder README.
 * File fetch and persist often replace the `repo` object with identical fields;
 * effects must depend on these strings, not object identity.
 */

export function repoPageChromeSignature(
  repo:
    | {
        lastNostrEventId?: string;
        nostrEventId?: string;
        sourceUrl?: string;
        clone?: string[];
        publicRead?: boolean;
        deleted?: boolean;
        forks?: number;
        stars?: number;
        repositoryName?: string;
        repo?: string;
        slug?: string;
      }
    | null
    | undefined
): string {
  if (!repo) return "";
  const name = repo.repositoryName || repo.repo || repo.slug || "";
  const clones = Array.isArray(repo.clone) ? repo.clone.join("|") : "";
  return [
    name,
    repo.lastNostrEventId || "",
    repo.nostrEventId || "",
    repo.sourceUrl || "",
    clones,
    repo.publicRead === false ? "0" : "1",
    repo.deleted ? "1" : "0",
    String(repo.forks ?? ""),
    String(repo.stars ?? ""),
  ].join("\n");
}

export function firstSuccessfulSourceKey(
  sources:
    | Array<{ sourceUrl?: string; resolvedBranch?: string }>
    | null
    | undefined,
  filesBranch?: string | null
): string {
  const first = Array.isArray(sources) ? sources[0] : undefined;
  const url =
    typeof first?.sourceUrl === "string" ? first.sourceUrl.trim() : "";
  if (!url) return "";
  const branch = String(first?.resolvedBranch || filesBranch || "").trim();
  return `${url}|${branch}`;
}

/** Listed tree path, or README.md at the current folder once a clone winner exists. */
export function folderReadmeFallbackPath(
  listedPath: string,
  currentPath: string
): string {
  const listed = listedPath.trim();
  if (listed) return listed;
  const folder = currentPath.replace(/\/+$/, "").trim();
  return folder ? `${folder}/README.md` : "README.md";
}

/**
 * Fetch README before the tree exists when a clone already won.
 * After a listing is present, only use a path that listing actually contains.
 */
export function folderReadmeLoadPath(opts: {
  listedPath: string;
  currentPath: string;
  hasWinner: boolean;
  hasListing: boolean;
}): string {
  const listed = opts.listedPath.trim();
  if (listed) return listed;
  if (opts.hasWinner && !opts.hasListing) {
    return folderReadmeFallbackPath("", opts.currentPath);
  }
  return "";
}

/** A winning clone URL is enough to fetch README — do not wait for a fuller tree listing. */
export function cloneSourceUrlIsUsable(
  sourceUrl: string | null | undefined
): boolean {
  if (!sourceUrl || !/^https?:\/\//i.test(sourceUrl)) return false;
  try {
    const u = new URL(sourceUrl);
    if (
      u.protocol === "http:" &&
      /^\d{1,3}(?:\.\d{1,3}){3}$/.test(u.hostname)
    ) {
      return false;
    }
  } catch {
    return false;
  }
  return true;
}

/** True when persisting a forge URL would not change localStorage. */
export function storedGithubSourceUnchanged(
  prev: {
    sourceUrl?: string;
    clone?: string[];
    forkedFrom?: string;
  },
  next: {
    sourceUrl?: string;
    clone?: string[];
    forkedFrom?: string;
  }
): boolean {
  return (
    (prev.sourceUrl || "") === (next.sourceUrl || "") &&
    (prev.forkedFrom || "") === (next.forkedFrom || "") &&
    JSON.stringify(prev.clone || []) === JSON.stringify(next.clone || [])
  );
}

/**
 * Header GitHub issue/PR hydrate. Retry when one side failed (rate limit).
 * Do not retry when GitHub says the repo is gone/private — that 404 storm
 * blocked first paint and spammed the console.
 */
export function githubHydrateShouldRetry(opts: {
  attempt: number;
  maxAttempts?: number;
  sourceUrl?: string;
  issuesOk?: boolean;
  pullsOk?: boolean;
  githubUnavailable?: boolean;
}): boolean {
  if (opts.githubUnavailable) return false;
  if (!opts.sourceUrl) return false;
  const max = opts.maxAttempts ?? 3;
  if (opts.attempt >= max) return false;
  if (!opts.issuesOk && !opts.pullsOk) return false;
  return !opts.issuesOk || !opts.pullsOk;
}
