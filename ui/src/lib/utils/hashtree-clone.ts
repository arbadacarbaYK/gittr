/**
 * Iris Hashtree (htree://) clone URL helpers.
 * Kept separate from git-source-fetcher so unit tests need no bridge/alias graph.
 */

export type HashtreeGitSource = {
  type: "hashtree";
  url: string;
  displayName: "Hashtree";
  npub?: string;
  repo?: string;
};

/** Iris Hashtree remote helper scheme (not HTTPS git). */
export function isHashtreeCloneUrl(raw: string): boolean {
  if (!raw || typeof raw !== "string") return false;
  return /^htree:\/\//i.test(raw.trim());
}

/** True when every clone URL is Hashtree (no HTTPS/GRASP/GitHub fallback). */
export function hasOnlyHashtreeCloneUrls(
  cloneUrls: string[] | null | undefined
): boolean {
  if (!Array.isArray(cloneUrls) || cloneUrls.length === 0) return false;
  return cloneUrls.every((u) => isHashtreeCloneUrl(u));
}

/**
 * Browser UI for an Iris Hashtree clone URL.
 * htree://npub1…/repo → https://git.iris.to/#/npub1…/repo
 */
export function irisGitBrowseUrlFromHashtreeClone(
  cloneUrl: string
): string | null {
  if (!isHashtreeCloneUrl(cloneUrl)) return null;
  try {
    const u = new URL(cloneUrl.trim());
    const npub = (u.hostname || "").toLowerCase();
    const repo = u.pathname.replace(/^\/+|\/+$/g, "").split("/")[0] || "";
    if (!/^npub1[a-z0-9]+$/i.test(npub) || !repo) return null;
    return `https://git.iris.to/#/${npub}/${repo}`;
  } catch {
    return null;
  }
}

export function parseHashtreeCloneUrl(
  cloneUrl: string
): HashtreeGitSource | null {
  if (!isHashtreeCloneUrl(cloneUrl)) return null;
  try {
    const u = new URL(cloneUrl.trim());
    const npub = (u.hostname || "").toLowerCase();
    const repo =
      u.pathname.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean)[0] || "";
    return {
      type: "hashtree",
      url: cloneUrl.trim(),
      displayName: "Hashtree",
      ...(npub ? { npub } : {}),
      ...(repo ? { repo } : {}),
    };
  } catch {
    return {
      type: "hashtree",
      url: cloneUrl.trim(),
      displayName: "Hashtree",
    };
  }
}
