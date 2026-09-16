/**
 * Import GitHub Discussions into the repo Discussions tab (read-only).
 * gittr never posts back to GitHub Discussions.
 */
import {
  type Discussion,
  type DiscussionComment,
  isGithubDiscussion,
  loadDiscussions,
  persistDiscussionListPublic,
} from "@/lib/discussions/storage";
import { parseGitHubRepoSpec } from "@/lib/nostr/nip82-repository-links";

const DISCUSSIONS_QUERY = `
query RepoDiscussions($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    hasDiscussionsEnabled
    discussions(first: 50, orderBy: {field: UPDATED_AT, direction: DESC}) {
      nodes {
        id
        number
        title
        body
        url
        createdAt
        author { login }
        category { name }
        comments { totalCount }
      }
    }
  }
}
`;

const DISCUSSION_DETAIL_QUERY = `
query RepoDiscussion($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    discussion(number: $number) {
      id
      number
      title
      body
      url
      createdAt
      author { login }
      category { name }
      comments(first: 80) {
        nodes {
          id
          body
          createdAt
          author { login }
        }
      }
    }
  }
}
`;

function githubDiscussionId(number: number): string {
  return `gh-discussion-${number}`;
}

function mapGithubDiscussion(node: {
  number?: number | null;
  title?: string | null;
  body?: string | null;
  url?: string | null;
  createdAt?: string | null;
  author?: { login?: string | null } | null;
  category?: { name?: string | null } | null;
  comments?: {
    totalCount?: number | null;
    nodes?: Array<{
      id?: string | null;
      body?: string | null;
      createdAt?: string | null;
      author?: { login?: string | null } | null;
    }> | null;
  };
}): Discussion | null {
  const number = node.number;
  if (number == null) return null;
  const body = node.body || "";
  const comments: DiscussionComment[] = (node.comments?.nodes || [])
    .filter((c): c is NonNullable<typeof c> => !!c?.id)
    .map((c) => ({
      id: `gh-dcomment-${c.id}`,
      author: c.author?.login || "github",
      content: c.body || "",
      createdAt: c.createdAt ? Date.parse(c.createdAt) : Date.now(),
    }));
  return {
    id: githubDiscussionId(number),
    title: node.title || `Discussion #${number}`,
    description: body,
    preview: body.slice(0, 200),
    author: node.author?.login || "github",
    category: node.category?.name || undefined,
    createdAt: node.createdAt ? Date.parse(node.createdAt) : Date.now(),
    commentCount: node.comments?.totalCount ?? comments.length,
    comments,
    source: "github",
    htmlUrl: node.url || undefined,
    githubNumber: number,
  };
}

function mergeGithubDiscussionsIntoLocal(
  local: Discussion[],
  fromGithub: Discussion[]
): Discussion[] {
  const kept = local.filter((d) => !isGithubDiscussion(d));
  return [...fromGithub, ...kept];
}

async function githubGraphql<T>(
  query: string,
  variables: Record<string, unknown>
): Promise<{ ok: boolean; data?: T; error?: string }> {
  try {
    const res = await fetch("/api/github/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) {
      return { ok: false, error: `http-${res.status}` };
    }
    const payload = (await res.json()) as {
      data?: T;
      errors?: Array<{ message?: string }>;
    };
    if (payload.errors?.length) {
      return {
        ok: false,
        error: payload.errors.map((e) => e.message).join("; "),
        data: payload.data,
      };
    }
    return { ok: true, data: payload.data };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "sync-failed",
    };
  }
}

export function parseGithubDiscussionNumber(id: string): number | null {
  const m = /^gh-discussion-(\d+)$/.exec(id);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

export async function syncGithubDiscussionsForRepo(
  entity: string,
  repoSlug: string,
  sourceUrl: string
): Promise<{
  ok: boolean;
  imported: number;
  error?: string;
  enabled?: boolean;
}> {
  const spec = parseGitHubRepoSpec(sourceUrl);
  if (!spec) return { ok: false, imported: 0, error: "not-github" };

  const result = await githubGraphql<{
    repository?: {
      hasDiscussionsEnabled?: boolean;
      discussions?: {
        nodes?: Array<Parameters<typeof mapGithubDiscussion>[0] | null>;
      };
    };
  }>(DISCUSSIONS_QUERY, { owner: spec.owner, name: spec.repo });

  if (!result.ok && !result.data) {
    return { ok: false, imported: 0, error: result.error };
  }

  const repoNode = result.data?.repository;
  if (repoNode && repoNode.hasDiscussionsEnabled === false) {
    const local = loadDiscussions(entity, repoSlug);
    persistDiscussionListPublic(
      entity,
      repoSlug,
      mergeGithubDiscussionsIntoLocal(local, [])
    );
    return { ok: true, imported: 0, enabled: false };
  }

  const fromGithub = (repoNode?.discussions?.nodes || [])
    .map((n) => (n ? mapGithubDiscussion(n) : null))
    .filter((d): d is Discussion => !!d);

  const local = loadDiscussions(entity, repoSlug);
  const merged = mergeGithubDiscussionsIntoLocal(local, fromGithub);
  persistDiscussionListPublic(entity, repoSlug, merged);
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("gittr:discussion-created", {
        detail: { entity, repo: repoSlug, imported: fromGithub.length },
      })
    );
  }
  return {
    ok: true,
    imported: fromGithub.length,
    enabled: repoNode?.hasDiscussionsEnabled !== false,
  };
}

export async function fetchGithubDiscussionDetail(
  sourceUrl: string,
  number: number
): Promise<Discussion | null> {
  const spec = parseGitHubRepoSpec(sourceUrl);
  if (!spec) return null;
  const result = await githubGraphql<{
    repository?: {
      discussion?: Parameters<typeof mapGithubDiscussion>[0] | null;
    };
  }>(DISCUSSION_DETAIL_QUERY, {
    owner: spec.owner,
    name: spec.repo,
    number,
  });
  const node = result.data?.repository?.discussion;
  return node ? mapGithubDiscussion(node) : null;
}
