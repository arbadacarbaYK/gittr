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

/**
 * Canonical `htree://npub…/repo` (keeps a leading `htree://` string as-is).
 * Also undoes the accidental `https://` prepend: `https://htree://npub…/repo.git`.
 */
export function normalizeHashtreeCloneUrl(raw: string): string | null {
  if (!raw || typeof raw !== "string") return null;
  let t = raw.trim();
  if (!t) return null;

  if (/^https?:\/\/htree:\/\//i.test(t)) {
    t = t.replace(/^https?:\/\/htree:\/\//i, "htree://");
  }

  if (/^htree:\/\//i.test(t)) {
    return t;
  }

  // URL parser of the malformed form: hostname `htree`, path `/npub1…/repo`
  try {
    const withProto = /^[a-z][a-z0-9+.-]*:/i.test(t) ? t : `https://${t}`;
    const u = new URL(withProto);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (u.hostname.toLowerCase() !== "htree") return null;
    const parts = u.pathname.split("/").filter(Boolean);
    const npub = parts[0] || "";
    const repo = (parts[1] || "").replace(/\.git$/i, "");
    if (!/^npub1[a-z0-9]+$/i.test(npub) || !repo) return null;
    return `htree://${npub.toLowerCase()}/${repo}`;
  } catch {
    return null;
  }
}

/** Iris Hashtree remote helper scheme (not HTTPS git). */
export function isHashtreeCloneUrl(raw: string): boolean {
  return normalizeHashtreeCloneUrl(raw) !== null;
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
  const parsed = parseHashtreeCloneUrl(cloneUrl);
  if (!parsed?.npub || !parsed.repo) return null;
  return `https://git.iris.to/#/${parsed.npub}/${parsed.repo}`;
}

export function parseHashtreeCloneUrl(
  cloneUrl: string
): HashtreeGitSource | null {
  const normalized = normalizeHashtreeCloneUrl(cloneUrl);
  if (!normalized) return null;
  try {
    const u = new URL(normalized);
    const npub = (u.hostname || "").toLowerCase();
    const repo =
      u.pathname
        .replace(/^\/+|\/+$/g, "")
        .split("/")
        .filter(Boolean)[0]
        ?.replace(/\.git$/i, "") || "";
    return {
      type: "hashtree",
      url: normalized,
      displayName: "Hashtree",
      ...(npub ? { npub } : {}),
      ...(repo ? { repo } : {}),
    };
  } catch {
    return {
      type: "hashtree",
      url: normalized,
      displayName: "Hashtree",
    };
  }
}
