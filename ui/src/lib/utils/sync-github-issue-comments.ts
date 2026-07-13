import { type StoredRepo } from "@/lib/repos/storage";
import {
  resolveGithubUpstreamForTabs,
  resolveRepoUpstreamSource,
} from "@/lib/repos/upstream-precedence";

export type GithubIssueCommentRow = {
  id: string;
  author: string;
  content: string;
  createdAt: number;
  edited?: boolean;
  editedAt?: number;
  url?: string;
  source: "github";
};

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

export function isGithubIssueSyntheticId(id: string | undefined): boolean {
  return /^issue-\d+$/i.test(String(id ?? ""));
}

export function githubIssueNumberFromSyntheticId(
  id: string | undefined
): string | null {
  const m = String(id ?? "").match(/^issue-(\d+)$/i);
  return m?.[1] ? m[1] : null;
}

/** Resolve GitHub issue number from stored row, synthetic id, or URL segment. */
export function resolveGithubIssueNumber(opts: {
  issueId?: string;
  issueNumber?: string | number;
  routeIssueId?: string;
}): string {
  const fromRow = String(opts.issueNumber ?? "").trim();
  if (fromRow && /^\d+$/.test(fromRow)) return fromRow;

  const fromSynthetic = githubIssueNumberFromSyntheticId(opts.issueId);
  if (fromSynthetic) return fromSynthetic;

  const route = decodeURIComponent(String(opts.routeIssueId ?? "").trim());
  if (/^\d+$/.test(route)) return route;

  return "";
}

export async function fetchGithubIssueComments(opts: {
  repo: StoredRepo | null | undefined;
  issueId: string | undefined;
  issueNumber: string | undefined;
  entity?: string;
  repoSlug?: string;
  routeIssueId?: string;
}): Promise<GithubIssueCommentRow[]> {
  const sourceUrl =
    resolveRepoUpstreamSource(opts.repo) ||
    (opts.entity && opts.repoSlug
      ? resolveGithubUpstreamForTabs(opts.entity, opts.repoSlug, opts.repo)
      : "");

  if (!sourceUrl) {
    console.warn("[gittr] GitHub comments: no upstream sourceUrl", {
      entity: opts.entity,
      repo: opts.repoSlug,
    });
    return [];
  }

  const parsed = parseGithubOwnerRepo(sourceUrl);
  if (!parsed) return [];

  const issueNumber = resolveGithubIssueNumber({
    issueId: opts.issueId,
    issueNumber: opts.issueNumber,
    routeIssueId: opts.routeIssueId,
  });
  if (!issueNumber) {
    console.warn("[gittr] GitHub comments: could not resolve issue number", {
      issueId: opts.issueId,
      issueNumber: opts.issueNumber,
      routeIssueId: opts.routeIssueId,
    });
    return [];
  }

  const endpoint = `/repos/${parsed.owner}/${parsed.repo}/issues/${encodeURIComponent(
    issueNumber
  )}/comments?per_page=100&sort=created&direction=asc`;
  const proxyUrl = `/api/github/proxy?endpoint=${encodeURIComponent(endpoint)}`;

  const response = await fetch(proxyUrl);
  if (!response.ok) {
    console.warn(
      `[gittr] GitHub comments fetch failed ${response.status} for ${parsed.owner}/${parsed.repo}#${issueNumber}`
    );
    return [];
  }

  const list = (await response.json()) as unknown;
  if (!Array.isArray(list)) return [];

  const out: GithubIssueCommentRow[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const it = item as Record<string, unknown>;
    const user = it.user as { login?: string } | undefined;
    const createdAtIso = String(it.created_at || "");
    const updatedAtIso = String(it.updated_at || "");
    const createdAt = createdAtIso ? new Date(createdAtIso).getTime() : 0;
    const editedAt = updatedAtIso ? new Date(updatedAtIso).getTime() : 0;

    const idRaw = String(it.id ?? "");
    if (!idRaw) continue;

    out.push({
      id: `gh-comment-${idRaw}`,
      author: String(user?.login || ""),
      content: String(it.body || ""),
      createdAt: createdAt || Date.now(),
      edited: Boolean(editedAt && createdAt && editedAt > createdAt),
      editedAt: editedAt && editedAt > (createdAt || 0) ? editedAt : undefined,
      url: String(it.html_url || ""),
      source: "github",
    });
  }

  return out;
}

