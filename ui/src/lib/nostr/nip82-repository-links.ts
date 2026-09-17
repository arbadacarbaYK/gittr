/**
 * NIP-82 `repository` is the cloneable source tree ("must be able to git clone").
 * Zapstore listings almost always have this; a NIP-34 `a` tag is optional and rare.
 */

function hrefsMatch(a?: string, b?: string): boolean {
  if (!a || !b) return false;
  return (
    a.trim().replace(/\/+$/, "").toLowerCase() ===
    b.trim().replace(/\/+$/, "").toLowerCase()
  );
}

/** Browseable source URL from a NIP-82 `repository` tag (not the /releases page). */
export function repositoryUrlToSourceHref(
  repository: string
): string | undefined {
  const raw = repository.trim();
  if (!raw) return undefined;

  const ssh = raw.match(/^git@([^:]+):([^/]+)\/([^/]+?)(?:\.git)?$/i);
  if (ssh?.[1] && ssh[2] && ssh[3]) {
    return `https://${ssh[1]}/${ssh[2]}/${ssh[3].replace(/\.git$/i, "")}`;
  }

  try {
    const base = raw.includes("://") ? raw : `https://${raw}`;
    const url = new URL(base);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return undefined;
    }
    url.username = "";
    url.password = "";
    const segs = url.pathname.split("/").filter(Boolean);
    if (segs.length > 0) {
      segs[segs.length - 1] = segs[segs.length - 1]!.replace(/\.git$/i, "");
      url.pathname = `/${segs.join("/")}`;
    }
    return url.toString().replace(/\/$/, "");
  } catch {
    return undefined;
  }
}

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

    if (
      (host.includes("gitea") ||
        host.includes("forgejo") ||
        host.startsWith("git.")) &&
      segments.length >= 2 &&
      !/^npub1/i.test(segments[0] || "")
    ) {
      const owner = segments[0]!;
      const repo = segments[1]!.replace(/\.git$/i, "");
      return `${url.origin}/${owner}/${repo}/releases`;
    }

    return raw.includes("://") ? raw : base;
  } catch {
    return raw;
  }
}

export type SoftwareAppCardLinkInput = {
  gittrRepoPath?: string;
  repository?: string;
  webUrl?: string;
};

/**
 * Card footer hrefs: **Repo** is source you can audit (gittr Code when we have
 * a NIP-34 pointer, else the Zapstore/NIP-82 `repository` URL). **Releases** is
 * the forge downloads page only when we can name one that is not the tree.
 */
export function softwareAppCardLinks(app: SoftwareAppCardLinkInput): {
  repoHref?: string;
  repoIsExternal: boolean;
  releasesHref?: string;
  webHref?: string;
} {
  const source = app.repository
    ? repositoryUrlToSourceHref(app.repository)
    : undefined;
  const gittr = (app.gittrRepoPath || "").trim() || undefined;
  const repoHref = gittr || source;
  const rewritten = app.repository
    ? repositoryUrlToReleasesHref(app.repository)
    : undefined;
  const releasesHref =
    rewritten && source && !hrefsMatch(rewritten, source)
      ? rewritten
      : undefined;
  return {
    repoHref,
    repoIsExternal: !!repoHref && /^https?:\/\//i.test(repoHref),
    releasesHref,
    webHref: app.webUrl,
  };
}
