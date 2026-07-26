/**
 * Import GitHub Projects V2 into the repo ToDo/Kanban tab (read-only from source).
 * Local-only boards/notes are preserved; GH-sourced boards are replaced each sync.
 *
 * No finalized Nostr NIP for git kanban yet — we mirror GH like Issues and keep
 * board state in localStorage until a draft (#1665 / #1804 / Headway) settles.
 */
import { parseGitHubRepoSpec } from "@/lib/nostr/nip82-repository-links";

export type KanbanStatus = "todo" | "in_progress" | "done";

export type SyncedProjectItem = {
  id: string;
  title: string;
  content?: string;
  type: "issue" | "pr" | "note";
  status: KanbanStatus;
  issueId?: string;
  prId?: string;
  source?: "github" | "local";
  githubItemId?: string;
};

export type SyncedProject = {
  id: string;
  name: string;
  description?: string;
  status: "active" | "completed" | "archived";
  items: SyncedProjectItem[];
  createdAt: number;
  view: "kanban" | "roadmap";
  source?: "github" | "local";
  githubProjectId?: string;
};

const PROJECTS_QUERY = `
query RepoProjects($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    projectsV2(first: 10) {
      nodes {
        id
        title
        shortDescription
        closed
        updatedAt
        items(first: 50) {
          nodes {
            id
            content {
              __typename
              ... on Issue {
                number
                title
                state
                body
                url
              }
              ... on PullRequest {
                number
                title
                state
                body
                url
              }
              ... on DraftIssue {
                title
                body
              }
            }
            fieldValues(first: 20) {
              nodes {
                __typename
                ... on ProjectV2ItemFieldSingleSelectValue {
                  name
                  field {
                    ... on ProjectV2FieldCommon {
                      name
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}
`;

/** Kanban only needs a preview; full GitHub issue bodies are opened via Issues. */
function truncateProjectBody(
  body: string | undefined | null,
  max = 280
): string | undefined {
  if (!body) return undefined;
  const t = body.trim();
  if (!t) return undefined;
  if (t.length <= max) return t;
  return `${t.slice(0, max).trimEnd()}…`;
}

function mapStatusName(raw: string | undefined, closed?: boolean): KanbanStatus {
  if (closed) return "done";
  const n = (raw || "").toLowerCase();
  if (!n) return "todo";
  if (
    n.includes("done") ||
    n.includes("complete") ||
    n.includes("closed") ||
    n.includes("finished")
  ) {
    return "done";
  }
  if (
    n.includes("progress") ||
    n.includes("doing") ||
    n.includes("review") ||
    n.includes("active")
  ) {
    return "in_progress";
  }
  return "todo";
}

function projectsStorageKey(entity: string, repo: string): string {
  return `gittr_projects_${entity}_${repo}`;
}

function isGithubProject(p: SyncedProject): boolean {
  return p.source === "github" || p.id.startsWith("gh-project-");
}

export function mergeGithubProjectsIntoLocal(
  local: SyncedProject[],
  fromGithub: SyncedProject[]
): SyncedProject[] {
  const keptLocal = local.filter((p) => !isGithubProject(p));
  return [...fromGithub, ...keptLocal];
}

export async function syncGithubProjectsForRepo(
  entity: string,
  repoSlug: string,
  sourceUrl: string
): Promise<{ ok: boolean; imported: number; error?: string }> {
  const spec = parseGitHubRepoSpec(sourceUrl);
  if (!spec) return { ok: false, imported: 0, error: "not-github" };

  try {
    const res = await fetch("/api/github/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: PROJECTS_QUERY,
        variables: { owner: spec.owner, name: spec.repo },
      }),
    });
    if (!res.ok) {
      return { ok: false, imported: 0, error: `http-${res.status}` };
    }
    const payload = (await res.json()) as {
      data?: {
        repository?: {
          projectsV2?: {
            nodes?: Array<{
              id: string;
              title?: string;
              shortDescription?: string | null;
              closed?: boolean;
              updatedAt?: string;
              items?: {
                nodes?: Array<{
                  id: string;
                  content?: {
                    __typename?: string;
                    number?: number;
                    title?: string;
                    state?: string;
                    body?: string;
                    url?: string;
                  } | null;
                  fieldValues?: {
                    nodes?: Array<{
                      __typename?: string;
                      name?: string;
                      field?: { name?: string };
                    }>;
                  };
                }>;
              };
            }>;
          };
        };
      };
      errors?: Array<{ message?: string }>;
    };

    if (payload.errors?.length) {
      console.warn(
        "[Projects] GraphQL errors:",
        payload.errors.map((e) => e.message).join("; ")
      );
    }

    const nodes = payload.data?.repository?.projectsV2?.nodes || [];
    const fromGithub: SyncedProject[] = nodes
      .filter((n): n is NonNullable<typeof n> => !!n?.id)
      .map((node) => {
        const items: SyncedProjectItem[] = (node.items?.nodes || [])
          .filter((it): it is NonNullable<typeof it> => !!it?.id)
          .map((it) => {
            const content = it.content;
            const statusField = (it.fieldValues?.nodes || []).find(
              (fv) =>
                fv?.__typename === "ProjectV2ItemFieldSingleSelectValue" &&
                (fv.field?.name || "").toLowerCase() === "status"
            );
            const typename = content?.__typename || "";
            const closed =
              (content?.state || "").toUpperCase() === "CLOSED" ||
              (content?.state || "").toUpperCase() === "MERGED";
            const status = mapStatusName(statusField?.name, closed);
            const number = content?.number;
            // Keep a short body excerpt only — full issue/PR markdown blows up
            // kanban cards and localStorage (e.g. cargo-limit research dumps).
            const bodyExcerpt = truncateProjectBody(content?.body);
            if (typename === "Issue" && number != null) {
              return {
                id: `gh-item-${it.id}`,
                title: String(content?.title || `Issue #${number}`),
                content: bodyExcerpt,
                type: "issue" as const,
                status,
                issueId: `issue-${number}`,
                source: "github" as const,
                githubItemId: it.id,
              };
            }
            if (typename === "PullRequest" && number != null) {
              return {
                id: `gh-item-${it.id}`,
                title: String(content?.title || `PR #${number}`),
                content: bodyExcerpt,
                type: "pr" as const,
                status,
                prId: `pr-${number}`,
                source: "github" as const,
                githubItemId: it.id,
              };
            }
            return {
              id: `gh-item-${it.id}`,
              title: String(content?.title || "Draft"),
              content: bodyExcerpt,
              type: "note" as const,
              status,
              source: "github" as const,
              githubItemId: it.id,
            };
          });

        return {
          id: `gh-project-${node.id}`,
          name: node.title || "GitHub Project",
          description: node.shortDescription || undefined,
          status: node.closed ? ("archived" as const) : ("active" as const),
          items,
          createdAt: node.updatedAt
            ? Date.parse(node.updatedAt)
            : Date.now(),
          view: "kanban" as const,
          source: "github" as const,
          githubProjectId: node.id,
        };
      });

    const key = projectsStorageKey(entity, repoSlug);
    let local: SyncedProject[] = [];
    try {
      const raw = JSON.parse(localStorage.getItem(key) || "[]");
      local = Array.isArray(raw) ? raw : [];
    } catch {
      local = [];
    }

    const merged = mergeGithubProjectsIntoLocal(local, fromGithub);
    localStorage.setItem(key, JSON.stringify(merged));
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("gittr:project-updated", {
          detail: { entity, repo: repoSlug, imported: fromGithub.length },
        })
      );
    }
    return { ok: true, imported: fromGithub.length };
  } catch (e) {
    console.warn("[Projects] GitHub sync failed:", e);
    return {
      ok: false,
      imported: 0,
      error: e instanceof Error ? e.message : "sync-failed",
    };
  }
}
