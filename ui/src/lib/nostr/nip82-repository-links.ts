/**
 * Map publisher `repository` URLs to a "releases" view when we recognize the host.
 */

/** Parse `owner` / `repo` for github.com (https or git@). */
export function parseGitHubRepoSpec(
  repository: string
): { owner: string; repo: string } | null {
  const raw = repository.trim();
  if (!raw) return null;

  const ssh = raw.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/i);
  if (ssh?.[1] && ssh[2]) {
    return {
      owner: ssh[1],
      repo: ssh[2].replace(/\.git$/i, ""),
    };
  }

  try {
    const base = raw.includes("://") ? raw : `https://${raw}`;
    const url = new URL(base);
    const host = url.hostname.toLowerCase();
    if (host !== "github.com" && !host.endsWith(".github.com")) {
      return null;
    }
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments.length < 2) return null;
    return {
      owner: segments[0]!,
      repo: segments[1]!.replace(/\.git$/i, ""),
    };
  } catch {
    return null;
  }
}

export function repositoryUrlToReleasesHref(repository: string): string {
  const raw = repository.trim();
  if (!raw) return raw;

  const sshGithub = raw.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/i);
  if (sshGithub?.[1] && sshGithub[2]) {
    const owner = sshGithub[1];
    const repo = sshGithub[2].replace(/\.git$/i, "");
    return `https://github.com/${owner}/${repo}/releases`;
  }

  try {
    const base = raw.includes("://") ? raw : `https://${raw}`;
    const url = new URL(base);
    const host = url.hostname.toLowerCase();
    const path = url.pathname.replace(/\/$/, "");
    const segments = path.split("/").filter(Boolean);

    if (host === "github.com" || host.endsWith(".github.com")) {
      if (segments.length >= 2) {
        const owner = segments[0]!;
        const repo = segments[1]!.replace(/\.git$/i, "");
        return `${url.origin}/${owner}/${repo}/releases`;
      }
    }

    if (host.includes("gitlab")) {
      if (segments.length >= 2) {
        const projectPath = segments.join("/");
        return `${url.origin}/${projectPath}/-/releases`;
      }
    }

    if (host === "gittr.space" || host.endsWith(".gittr.space")) {
      if (segments.length >= 2) {
        return `${url.origin}/${segments[0]!}/${segments[1]!}/releases`;
      }
    }

    if (host === "codeberg.org" && segments.length >= 2) {
      const owner = segments[0]!;
      const repo = segments[1]!.replace(/\.git$/i, "");
      return `${url.origin}/${owner}/${repo}/releases`;
    }

    return raw.includes("://") ? raw : base;
  } catch {
    return raw;
  }
}
