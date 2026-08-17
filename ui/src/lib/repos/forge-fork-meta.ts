/**
 * Forge-agnostic fork parent lookup (GitHub, GitLab, Gitea/Forgejo/Codeberg).
 * Used for profile cards, repo header, and localStorage backfill when Nostr
 * kind 30617 lacks a `forkedFrom` tag.
 */
import { parseGitHubRepoSpec } from "@/lib/nostr/nip82-repository-links";
import {
  giteaApiRepoBase,
  parseGiteaCompatibleRepo,
} from "@/lib/repos/gitea-forge";
import { detectGitForge } from "@/lib/utils/detect-git-forge";

export type ForgeForkMeta = {
  isFork?: boolean;
  htmlUrl?: string;
  parentHtmlUrl?: string;
};

/** Human label for fork attribution links (any forge or gittr /npub/repo path). */
export function formatForgeAttributionLabel(raw: string): string {
  const u = String(raw || "").trim();
  if (!u) return "";
  if (u.startsWith("/")) return u.replace(/^\//, "");
  return u.replace(/^https?:\/\//i, "").replace(/\.git$/i, "");
}

function gitlabProjectPath(sourceUrl: string): string | null {
  let href = String(sourceUrl || "").trim();
  if (href.startsWith("git@")) {
    const m = href.match(/^git@([^:]+):(.+)$/);
    if (!m?.[2]) return null;
    href = `https://${m[1]}/${m[2].replace(/\.git$/i, "")}`;
  } else if (!/^https?:\/\//i.test(href)) {
    href = `https://${href}`;
  }
  try {
    const url = new URL(href);
    const parts = url.pathname.replace(/\.git$/i, "").split("/").filter(Boolean);
    if (parts.length < 2) return null;
    return parts.join("/");
  } catch {
    return null;
  }
}

async function fetchGithubForkMeta(sourceUrl: string): Promise<ForgeForkMeta | null> {
  const spec = parseGitHubRepoSpec(sourceUrl);
  if (!spec) return null;
  try {
    const r = await fetch(
      `/api/github/proxy?endpoint=${encodeURIComponent(
        `/repos/${spec.owner}/${spec.repo}`
      )}`
    );
    if (!r.ok) return null;
    const j = (await r.json()) as {
      fork?: boolean;
      html_url?: string;
      parent?: { html_url?: string };
    };
    const htmlUrl =
      typeof j.html_url === "string" && j.html_url.trim()
        ? j.html_url.trim().replace(/\.git$/i, "")
        : undefined;
    const parentHtmlUrl =
      j.fork === true &&
      typeof j.parent?.html_url === "string" &&
      j.parent.html_url.trim()
        ? j.parent.html_url.trim().replace(/\.git$/i, "")
        : undefined;
    return {
      isFork: j.fork,
      htmlUrl,
      parentHtmlUrl,
    };
  } catch {
    return null;
  }
}

async function fetchGiteaForkMeta(
  sourceUrl: string
): Promise<ForgeForkMeta | null> {
  const parsed = parseGiteaCompatibleRepo(sourceUrl);
  if (!parsed) return null;
  try {
    const r = await fetch(giteaApiRepoBase(parsed), {
      headers: { Accept: "application/json", "User-Agent": "gittr-space" },
    });
    if (!r.ok) return null;
    const j = (await r.json()) as {
      fork?: boolean;
      html_url?: string;
      parent?: { html_url?: string; full_name?: string };
    };
    const htmlUrl =
      typeof j.html_url === "string" && j.html_url.trim()
        ? j.html_url.trim().replace(/\.git$/i, "")
        : `${parsed.origin}/${parsed.owner}/${parsed.repo}`;
    let parentHtmlUrl: string | undefined;
    if (j.fork === true) {
      if (typeof j.parent?.html_url === "string" && j.parent.html_url.trim()) {
        parentHtmlUrl = j.parent.html_url.trim().replace(/\.git$/i, "");
      } else if (
        typeof j.parent?.full_name === "string" &&
        j.parent.full_name.includes("/")
      ) {
        parentHtmlUrl = `${parsed.origin}/${j.parent.full_name}`.replace(
          /\.git$/i,
          ""
        );
      }
    }
    return { isFork: j.fork, htmlUrl, parentHtmlUrl };
  } catch {
    return null;
  }
}

async function fetchGitlabForkMeta(
  sourceUrl: string
): Promise<ForgeForkMeta | null> {
  const projectPath = gitlabProjectPath(sourceUrl);
  if (!projectPath) return null;
  const encoded = encodeURIComponent(projectPath);
  try {
    const r = await fetch(
      `https://gitlab.com/api/v4/projects/${encoded}`,
      { headers: { Accept: "application/json", "User-Agent": "gittr-space" } }
    );
    if (!r.ok) return null;
    const j = (await r.json()) as {
      forked_from_project?: { web_url?: string; path_with_namespace?: string };
      web_url?: string;
    };
    const htmlUrl =
      typeof j.web_url === "string" && j.web_url.trim()
        ? j.web_url.trim().replace(/\.git$/i, "")
        : undefined;
    const parent = j.forked_from_project;
    const parentHtmlUrl =
      parent &&
      (typeof parent.web_url === "string"
        ? parent.web_url.trim().replace(/\.git$/i, "")
        : parent.path_with_namespace
        ? `https://gitlab.com/${parent.path_with_namespace}`.replace(
            /\.git$/i,
            ""
          )
        : undefined);
    return {
      isFork: !!parentHtmlUrl,
      htmlUrl,
      parentHtmlUrl,
    };
  } catch {
    return null;
  }
}

/** Resolve fork + parent for any supported forge URL. */
export async function fetchForgeRepoForkMeta(
  sourceUrl: string
): Promise<ForgeForkMeta | null> {
  const src = String(sourceUrl || "").trim();
  if (!src) return null;

  const forge = detectGitForge(src);
  if (forge.type === "github" || src.includes("github.com")) {
    return fetchGithubForkMeta(src);
  }
  if (forge.type === "gitlab" || src.includes("gitlab.com")) {
    return fetchGitlabForkMeta(src);
  }
  const gitea = parseGiteaCompatibleRepo(src);
  if (gitea) {
    return fetchGiteaForkMeta(src);
  }
  return null;
}
