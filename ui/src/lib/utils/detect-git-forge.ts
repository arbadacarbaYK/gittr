/**
 * Detect forge type and normalize clone URLs for Import (/new → /api/import-git).
 */

export type GitForgeType =
  | "github"
  | "gitlab"
  | "codeberg"
  | "gitea"
  | "self-hosted"
  | "unknown";

export type DetectedGitForge = {
  type: GitForgeType;
  label: string;
  /** Use GitHub REST `/api/import` instead of git clone */
  useGithubApi: boolean;
  host: string;
};

function hostnameOf(raw: string): string {
  try {
    let u = raw.trim();
    if (u.startsWith("git@")) {
      const m = u.match(/^git@([^:]+):/);
      return (m?.[1] || "").toLowerCase();
    }
    if (u.startsWith("git://")) u = u.replace(/^git:\/\//, "https://");
    if (!/^https?:\/\//i.test(u) && !u.startsWith("git@")) {
      u = `https://${u}`;
    }
    return new URL(u).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/**
 * Strip web-UI path junk so `git clone` gets a real repo URL.
 * Keeps GitLab subgroups (group/sub/repo).
 */
export function normalizeGitCloneUrl(input: string): string {
  const trimmed = (input || "").trim();
  if (!trimmed) return trimmed;

  if (trimmed.startsWith("git@")) {
    return trimmed.replace(/\/+$/, "");
  }

  let raw = trimmed;
  if (raw.startsWith("git://")) {
    raw = raw.replace(/^git:\/\//, "https://");
  }
  if (!/^https?:\/\//i.test(raw)) {
    raw = `https://${raw}`;
  }

  try {
    const url = new URL(raw);
    let pathname = url.pathname || "/";

    // GitLab web UI: /group/repo/-/tree/main → /group/repo
    pathname = pathname.replace(/\/-\/.*$/i, "");
    // Codeberg / Gitea / Forgejo: /owner/repo/src/branch/main → /owner/repo
    pathname = pathname.replace(/\/src\/(branch|tag|commit)\/.*$/i, "");
    // GitHub-style browse paths
    pathname = pathname.replace(/\/(tree|blob|commit|commits|raw|issues|pulls|wiki)\/.*$/i, "");
    pathname = pathname.replace(/\/+$/, "");
    if (!pathname.startsWith("/")) pathname = `/${pathname}`;

    url.pathname = pathname;
    url.search = "";
    url.hash = "";
    // Prefer no trailing slash; keep .git if already present
    return url.toString().replace(/\/$/, "");
  } catch {
    return trimmed;
  }
}

export function detectGitForge(sourceUrl: string): DetectedGitForge {
  const host = hostnameOf(normalizeGitCloneUrl(sourceUrl) || sourceUrl);

  if (host === "github.com" || host.endsWith(".github.com")) {
    return {
      type: "github",
      label: "GitHub",
      useGithubApi: true,
      host,
    };
  }
  if (
    host === "gitlab.com" ||
    host.endsWith(".gitlab.com") ||
    /(^|\.)gitlab\./i.test(host)
  ) {
    return {
      type: "gitlab",
      label: "GitLab",
      useGithubApi: false,
      host,
    };
  }
  if (host === "codeberg.org" || host.endsWith(".codeberg.org")) {
    return {
      type: "codeberg",
      label: "Codeberg",
      useGithubApi: false,
      host,
    };
  }
  if (
    /(^|\.)gitea\./i.test(host) ||
    /(^|\.)forgejo\./i.test(host) ||
    host.includes("gitea") ||
    host.includes("forgejo")
  ) {
    return {
      type: "gitea",
      label: "Gitea",
      useGithubApi: false,
      host,
    };
  }
  if (host) {
    return {
      type: "self-hosted",
      label: host,
      useGithubApi: false,
      host,
    };
  }
  return {
    type: "unknown",
    label: "git server",
    useGithubApi: false,
    host: "",
  };
}

/** owner + repo slug for display / storage (last path segment = repo). */
export function parseOwnerRepoFromGitUrl(sourceUrl: string): {
  owner: string;
  repo: string;
  host: string;
} | null {
  try {
    const normalized = normalizeGitCloneUrl(sourceUrl);
    let httpsUrl = normalized;
    if (normalized.startsWith("git@")) {
      const m = normalized.match(/^git@([^:]+):(.+)$/);
      if (!m) return null;
      httpsUrl = `https://${m[1]}/${m[2]}`;
    }
    const url = new URL(httpsUrl);
    const parts = url.pathname
      .replace(/\.git$/i, "")
      .split("/")
      .filter(Boolean);
    if (parts.length < 1) return null;
    const repo = (parts[parts.length - 1] || "").replace(/\.git$/i, "");
    const owner =
      parts.length >= 2 ? parts.slice(0, -1).join("/") : "";
    if (!repo) return null;
    return { owner, repo, host: url.hostname };
  } catch {
    return null;
  }
}
