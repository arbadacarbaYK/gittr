/**
 * Fetch Forgejo/Gitea/Codeberg issues and PRs via `/api/v1` into the same
 * localStorage buckets as GitHub hub sync.
 */
import {
  giteaApiRepoBase,
  parseGiteaCompatibleRepo,
} from "@/lib/repos/gitea-forge";
import {
  getRepoStorageKey,
  readRepoIssuesFromLocalStorage,
  readRepoPullsFromLocalStorage,
} from "@/lib/utils/entity-normalizer";
import {
  mergeGithubIssuesAfterRefetch,
  mergeGithubPrsAfterRefetch,
} from "@/lib/utils/issue-pr-status";

async function fetchGiteaList(
  url: string,
  maxPages = 5
): Promise<unknown[] | null> {
  const all: unknown[] = [];
  const sep = url.includes("?") ? "&" : "?";
  for (let page = 1; page <= maxPages; page++) {
    const res = await fetch(`${url}${sep}limit=50&page=${page}`, {
      headers: {
        Accept: "application/json",
        "User-Agent": "gittr-space",
      },
    });
    if (!res.ok) {
      if (page === 1) return null;
      break;
    }
    const chunk = (await res.json()) as unknown;
    if (!Array.isArray(chunk)) {
      if (page === 1) return null;
      break;
    }
    if (chunk.length === 0) break;
    all.push(...chunk);
    if (chunk.length < 50) break;
  }
  return all;
}

function loginOf(it: Record<string, unknown>): string {
  const user = it.user as { login?: string; username?: string } | undefined;
  return user?.login || user?.username || "";
}

export async function syncGiteaIssuesForRepo(
  entity: string,
  repoSlug: string,
  sourceUrl: string
): Promise<boolean> {
  const parsed = parseGiteaCompatibleRepo(sourceUrl);
  if (!parsed) return false;
  try {
    const list = await fetchGiteaList(
      `${giteaApiRepoBase(parsed)}/issues?state=all&type=issues`
    );
    if (!list) return false;

    const issues = list
      .filter(
        (item: unknown) =>
          item &&
          typeof item === "object" &&
          !(item as { pull_request?: unknown }).pull_request
      )
      .map((item: unknown) => {
        const it = item as Record<string, unknown>;
        const labels = it.labels as
          | Array<{ name?: string } | string>
          | undefined;
        return {
          id: `issue-${it.number}`,
          entity,
          repo: repoSlug,
          title: String(it.title || ""),
          number: String(it.number ?? ""),
          status: it.state === "closed" ? "closed" : "open",
          author: loginOf(it),
          labels: Array.isArray(labels)
            ? labels.map((l) =>
                typeof l === "string"
                  ? l
                  : String((l as { name?: string }).name || "")
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
          description: String(it.body || ""),
          html_url: String(it.html_url || ""),
        };
      });

    const key = getRepoStorageKey("gittr_issues", entity, repoSlug);
    const existing = readRepoIssuesFromLocalStorage(entity, repoSlug);
    const merged = mergeGithubIssuesAfterRefetch(existing, issues);
    localStorage.setItem(key, JSON.stringify(merged));
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("gittr:issue-updated"));
    }
    return true;
  } catch {
    return false;
  }
}

export async function syncGiteaPullsForRepo(
  entity: string,
  repoSlug: string,
  sourceUrl: string
): Promise<boolean> {
  const parsed = parseGiteaCompatibleRepo(sourceUrl);
  if (!parsed) return false;
  try {
    const list = await fetchGiteaList(
      `${giteaApiRepoBase(parsed)}/pulls?state=all`
    );
    if (!list) return false;

    const prs = list.map((item: unknown) => {
      const it = item as Record<string, unknown>;
      const labels = it.labels as Array<{ name?: string } | string> | undefined;
      const merged =
        it.merged === true ||
        (typeof it.merged_at === "string" && it.merged_at.length > 0);
      return {
        id: `pr-${it.number}`,
        entity,
        repo: repoSlug,
        title: String(it.title || ""),
        number: String(it.number ?? ""),
        status: merged ? "merged" : it.state === "closed" ? "closed" : "open",
        author: loginOf(it),
        labels: Array.isArray(labels)
          ? labels.map((l) =>
              typeof l === "string"
                ? l
                : String((l as { name?: string }).name || "")
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
    const merged = mergeGithubPrsAfterRefetch(existing, prs);
    localStorage.setItem(key, JSON.stringify(merged));
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("gittr:pr-updated"));
    }
    return true;
  } catch {
    return false;
  }
}
