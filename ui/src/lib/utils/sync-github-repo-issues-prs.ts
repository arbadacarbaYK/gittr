/**
 * Fetch GitHub issues/PRs for a repo (when `sourceUrl` is github.com) and merge into
 * the same localStorage bucket as Nostr rows (`readRepo*` + merge helpers).
 * Used by repo Issues/PRs tabs so lists match `/issues` and `/pulls` global pages.
 */
import {
  getRepoStorageKey,
  readRepoIssuesFromLocalStorage,
  readRepoPullsFromLocalStorage,
} from "@/lib/utils/entity-normalizer";
import {
  mergeGithubIssuesAfterRefetch,
  mergeGithubPrsAfterRefetch,
} from "@/lib/utils/issue-pr-status";

function parseGithubOwnerRepo(
  sourceUrl: string
): { owner: string; repo: string } | null {
  if (!sourceUrl || !sourceUrl.includes("github.com")) return null;
  try {
    const url = new URL(sourceUrl);
    const pathParts = url.pathname
      .replace(/\.git$/, "")
      .split("/")
      .filter(Boolean);
    if (pathParts.length < 2 || !pathParts[0] || !pathParts[1]) return null;
    return { owner: pathParts[0], repo: pathParts[1] };
  } catch {
    return null;
  }
}

/** Pulls issues + PRs from GitHub (excludes PRs from issues list). */
export async function syncGithubIssuesForRepo(
  entity: string,
  repoSlug: string,
  sourceUrl: string
): Promise<boolean> {
  const parsed = parseGithubOwnerRepo(sourceUrl);
  if (!parsed) return false;
  const { owner, repo: ghRepo } = parsed;
  try {
    const proxyUrl = `/api/github/proxy?endpoint=${encodeURIComponent(
      `/repos/${owner}/${ghRepo}/issues?state=all&per_page=100&sort=updated&direction=desc`
    )}`;
    const response = await fetch(proxyUrl);
    if (!response.ok) return false;
    const githubList: unknown[] = await response.json();
    if (!Array.isArray(githubList)) return false;

    const githubIssues = githubList
      .filter(
        (item: unknown) =>
          item &&
          typeof item === "object" &&
          !(item as { pull_request?: unknown }).pull_request
      )
      .map((item: unknown) => {
        const it = item as Record<string, unknown>;
        const user = it.user as { login?: string } | undefined;
        const labels = it.labels as Array<{ name?: string } | string> | undefined;
        return {
          id: `issue-${it.number}`,
          entity,
          repo: repoSlug,
          title: String(it.title || ""),
          number: String(it.number ?? ""),
          status: it.state === "closed" ? "closed" : "open",
          author: user?.login || "",
          labels: Array.isArray(labels)
            ? labels.map((l) =>
                typeof l === "string" ? l : String((l as { name?: string }).name || "")
              )
            : [],
          assignees: [],
          createdAt: it.created_at
            ? new Date(String(it.created_at)).getTime()
            : Date.now(),
          updatedAt: it.updated_at
            ? new Date(String(it.updated_at)).getTime()
            : undefined,
          body: String(it.body || ""),
          html_url: String(it.html_url || ""),
        };
      });

    const key = getRepoStorageKey("gittr_issues", entity, repoSlug);
    const existing = readRepoIssuesFromLocalStorage(entity, repoSlug);
    const merged = mergeGithubIssuesAfterRefetch(existing, githubIssues);
    localStorage.setItem(key, JSON.stringify(merged));
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("gittr:issue-updated"));
    }
    return true;
  } catch {
    return false;
  }
}

export async function syncGithubPullsForRepo(
  entity: string,
  repoSlug: string,
  sourceUrl: string
): Promise<boolean> {
  const parsed = parseGithubOwnerRepo(sourceUrl);
  if (!parsed) return false;
  const { owner, repo: ghRepo } = parsed;
  try {
    const proxyUrl = `/api/github/proxy?endpoint=${encodeURIComponent(
      `/repos/${owner}/${ghRepo}/pulls?state=all&per_page=100&sort=updated&direction=desc`
    )}`;
    const response = await fetch(proxyUrl);
    if (!response.ok) return false;
    const githubList: unknown[] = await response.json();
    if (!Array.isArray(githubList)) return false;

    const githubPRs = githubList.map((item: unknown) => {
      const it = item as Record<string, unknown>;
      const user = it.user as { login?: string } | undefined;
      const labels = it.labels as Array<{ name?: string } | string> | undefined;
      return {
        id: `pr-${it.number}`,
        entity,
        repo: repoSlug,
        title: String(it.title || ""),
        number: String(it.number ?? ""),
        status: it.merged_at
          ? "merged"
          : it.state === "closed"
            ? "closed"
            : "open",
        author: user?.login || "",
        labels: Array.isArray(labels)
          ? labels.map((l) =>
              typeof l === "string" ? l : String((l as { name?: string }).name || "")
            )
          : [],
        assignees: [],
        createdAt: it.created_at
          ? new Date(String(it.created_at)).getTime()
          : Date.now(),
        updatedAt: it.updated_at
          ? new Date(String(it.updated_at)).getTime()
          : undefined,
        body: String(it.body || ""),
        html_url: String(it.html_url || ""),
        merged_at: it.merged_at || null,
        head: (it.head as { ref?: string } | undefined)?.ref || null,
        base: (it.base as { ref?: string } | undefined)?.ref || null,
      };
    });

    const key = getRepoStorageKey("gittr_prs", entity, repoSlug);
    const existing = readRepoPullsFromLocalStorage(entity, repoSlug);
    const merged = mergeGithubPrsAfterRefetch(existing, githubPRs);
    localStorage.setItem(key, JSON.stringify(merged));
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("gittr:pr-updated"));
    }
    return true;
  } catch {
    return false;
  }
}
