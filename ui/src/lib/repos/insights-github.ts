export type GithubInsights = {
  fileCount: number;
  commitCount: number;
  languages: Record<string, number>;
  forks: number;
};

/** Last page from a GitHub `Link` header when `per_page=1` equals the total. */
export function parseGithubLinkLastPage(
  linkHeader: string | null | undefined
): number | null {
  if (!linkHeader) return null;
  const parts = linkHeader.split(",");
  for (const part of parts) {
    if (!/rel="?last"?/i.test(part)) continue;
    const m = part.match(/[?&]page=(\d+)/i);
    if (!m?.[1]) continue;
    const n = parseInt(m[1], 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

function githubProxy(endpoint: string): Promise<Response> {
  return fetch(`/api/github/proxy?endpoint=${encodeURIComponent(endpoint)}`);
}

async function jsonIfOk<T>(res: Response): Promise<T | null> {
  if (!res.ok) return null;
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/**
 * Live GitHub numbers for Insights when the repo has a github.com upstream.
 * Uses the same proxy allowlist as the Code / Commits tabs.
 */
export async function fetchGithubInsights(
  owner: string,
  repo: string,
  branch: string,
  triedDefaultBranch = false
): Promise<GithubInsights> {
  const empty: GithubInsights = {
    fileCount: 0,
    commitCount: 0,
    languages: {},
    forks: 0,
  };
  if (!owner || !repo) return empty;

  const sha = encodeURIComponent(branch || "main");

  const [langRes, commitsRes, treeRes, repoRes] = await Promise.all([
    githubProxy(`/repos/${owner}/${repo}/languages`),
    githubProxy(`/repos/${owner}/${repo}/commits?sha=${sha}&per_page=1`),
    githubProxy(`/repos/${owner}/${repo}/git/trees/${sha}?recursive=1`),
    githubProxy(`/repos/${owner}/${repo}`),
  ]);

  const languagesRaw = await jsonIfOk<Record<string, number>>(langRes);
  const languages: Record<string, number> = {};
  if (languagesRaw && typeof languagesRaw === "object") {
    for (const [lang, bytes] of Object.entries(languagesRaw)) {
      if (typeof bytes === "number" && bytes > 0) languages[lang] = bytes;
    }
  }

  let commitCount = parseGithubLinkLastPage(
    commitsRes.headers.get("link") || commitsRes.headers.get("x-github-link")
  );
  if (commitCount == null && commitsRes.ok) {
    const body = await jsonIfOk<unknown[]>(commitsRes);
    commitCount = Array.isArray(body) ? body.length : 0;
  }

  const tree = await jsonIfOk<{
    tree?: Array<{ type?: string }>;
    truncated?: boolean;
  }>(treeRes);
  const blobs = Array.isArray(tree?.tree)
    ? tree.tree.filter((n) => n.type === "blob").length
    : 0;

  const repoJson = await jsonIfOk<{
    forks_count?: number;
    default_branch?: string;
  }>(repoRes);
  const forks =
    typeof repoJson?.forks_count === "number" && repoJson.forks_count > 0
      ? repoJson.forks_count
      : 0;

  const result: GithubInsights = {
    fileCount: blobs,
    commitCount: commitCount ?? 0,
    languages,
    forks,
  };

  const fallbackBranch = repoJson?.default_branch?.trim();
  if (
    !triedDefaultBranch &&
    fallbackBranch &&
    fallbackBranch !== (branch || "main") &&
    result.fileCount === 0 &&
    result.commitCount === 0
  ) {
    const retry = await fetchGithubInsights(owner, repo, fallbackBranch, true);
    return {
      fileCount: Math.max(result.fileCount, retry.fileCount),
      commitCount: Math.max(result.commitCount, retry.commitCount),
      languages:
        Object.keys(retry.languages).length > 0
          ? retry.languages
          : result.languages,
      forks: Math.max(result.forks, retry.forks),
    };
  }

  return result;
}
