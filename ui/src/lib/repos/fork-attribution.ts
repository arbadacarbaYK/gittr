/**
 * `sourceUrl` = forge provenance for refetch (this repo’s GitHub/GitLab URL).
 * `forkedFrom` = a real fork of someone else’s work:
 *   - GitHub/GitLab parent URL (different repo), or
 *   - gittr pointer (`/npub1…/repo` from the Fork button).
 * Importing your own GitHub repo is not a fork.
 */
import { isGraspCloneUrl } from "../utils/grasp-servers";

import { urlLooksLikeSourceUpstream } from "./forge-tree-shrink";
import { normalizeForgeSourceKey } from "./github-source-match";

export type ForkAttributionOwnRepo = {
  sourceUrl?: string | null;
  clone?: Array<string | null | undefined> | null;
  htmlUrl?: string | null;
};

/** gittr Fork target: `/npub1…/repo`, `npub1…/repo`, or `/entity/repo`. */
export function isGittrForkPointer(raw: string | null | undefined): boolean {
  const u = String(raw || "").trim();
  if (!u) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(u)) return false;
  if (u.includes("://")) return false;
  const path = u.replace(/^\//, "");
  const parts = path.split("/").filter(Boolean);
  if (parts.length !== 2) return false;
  const entity = parts[0]!;
  const repo = parts[1]!;
  if (!entity || !repo || repo.length > 200) return false;
  if (/^npub1[a-z0-9]+$/i.test(entity)) return true;
  if (/^[0-9a-f]{64}$/i.test(entity)) return true;
  return (
    u.startsWith("/") &&
    /^[a-zA-Z0-9._-]+$/.test(entity) &&
    /^[A-Za-z0-9._-]+$/.test(repo)
  );
}

function ownForgeKeys(own?: ForkAttributionOwnRepo | null): Set<string> {
  const keys = new Set<string>();
  if (!own) return keys;
  const add = (raw: string | null | undefined) => {
    const key = normalizeForgeSourceKey(raw);
    if (key) keys.add(key);
  };
  add(own.sourceUrl);
  add(own.htmlUrl);
  for (const c of own.clone || []) add(c);
  return keys;
}

/**
 * Show “Forked from” / forked pill only for a foreign parent or a
 * gittr fork pointer — never this repo’s own GitHub URL.
 */
export function isDisplayableForkAttribution(
  raw: string | null | undefined,
  own?: ForkAttributionOwnRepo | null
): boolean {
  const u = String(raw || "").trim();
  if (!u) return false;
  if (isGittrForkPointer(u)) return true;
  if (isGraspCloneUrl(u)) return false;
  if (/\/grasp\//i.test(u)) return false;
  if (/\/npub1[a-z0-9]+/i.test(u) && /^https?:\/\//i.test(u)) return false;
  if (!urlLooksLikeSourceUpstream(u)) return false;
  const key = normalizeForgeSourceKey(u);
  if (key && ownForgeKeys(own).has(key)) return false;
  return true;
}

/** Drop GRASP/mirror values and self-import GitHub URLs wrongly stored as forkedFrom. */
export function sanitizeForkedFromField(
  raw: string | null | undefined,
  own?: ForkAttributionOwnRepo | null
): string | undefined {
  const u = String(raw || "").trim();
  if (!u) return undefined;
  if (isGittrForkPointer(u)) return u.replace(/\/+$/, "");
  if (!isDisplayableForkAttribution(u, own)) return undefined;
  return u.replace(/\.git$/i, "");
}

export function isRealForkAttribution(
  raw: string | null | undefined,
  own?: ForkAttributionOwnRepo | null
): boolean {
  return !!sanitizeForkedFromField(raw, own);
}

/** GitHub parent URL when this repo is a GitHub fork of a different repository. */
export function githubParentForkedFrom(opts: {
  htmlUrl?: string | null;
  isFork?: boolean | null;
  parentHtmlUrl?: string | null;
}): string | undefined {
  if (!opts.isFork) return undefined;
  const parent = String(opts.parentHtmlUrl || "").trim();
  if (!parent) return undefined;
  const parentKey = normalizeForgeSourceKey(parent);
  const selfKey = normalizeForgeSourceKey(opts.htmlUrl);
  if (!parentKey || (selfKey && parentKey === selfKey)) return undefined;
  return parent.replace(/\.git$/i, "");
}

/**
 * Reconcile stored forkedFrom with GitHub hub metadata and own forge URL.
 * Keeps gittr `/npub/repo` pointers. Uses GitHub `parent` when this is a
 * GitHub fork. Clears self-import URLs.
 */
/** Apply GitHub `fork` + `parent` metadata to a profile/repo row (pure). */
export function applyGithubForkMetaToRepo<
  T extends {
    sourceUrl?: string | null;
    forkedFrom?: string | null;
    clone?: unknown;
  },
>(
  repo: T,
  meta: {
    isFork?: boolean | null;
    parentHtmlUrl?: string | null;
    htmlUrl?: string | null;
  } | null
): T {
  if (!meta || !repo.sourceUrl) return repo;
  const clone = Array.isArray(repo.clone)
    ? repo.clone.map((c) => (c == null ? "" : String(c)))
    : undefined;
  const nextForked = resolveStoredForkedFrom({
    existingForkedFrom: repo.forkedFrom,
    sourceUrl: repo.sourceUrl,
    clone,
    githubIsFork: meta.isFork,
    githubParentHtmlUrl: meta.parentHtmlUrl,
    githubHtmlUrl: meta.htmlUrl || repo.sourceUrl,
  });
  if (!nextForked || nextForked === repo.forkedFrom) return repo;
  return { ...repo, forkedFrom: nextForked };
}

export function resolveStoredForkedFrom(opts: {
  existingForkedFrom?: string | null;
  sourceUrl?: string | null;
  clone?: Array<string | null | undefined> | null;
  githubIsFork?: boolean | null;
  githubParentHtmlUrl?: string | null;
  githubHtmlUrl?: string | null;
}): string | undefined {
  const own: ForkAttributionOwnRepo = {
    sourceUrl: opts.sourceUrl,
    clone: opts.clone,
    htmlUrl: opts.githubHtmlUrl,
  };
  if (isGittrForkPointer(opts.existingForkedFrom)) {
    return sanitizeForkedFromField(opts.existingForkedFrom, own);
  }
  if (opts.githubIsFork === true) {
    return (
      githubParentForkedFrom({
        htmlUrl: opts.githubHtmlUrl || opts.sourceUrl,
        isFork: true,
        parentHtmlUrl: opts.githubParentHtmlUrl,
      }) || sanitizeForkedFromField(opts.existingForkedFrom, own)
    );
  }
  if (opts.githubIsFork === false) {
    // Keep a real foreign parent; sanitize already drops self-import URLs.
    return sanitizeForkedFromField(opts.existingForkedFrom, own);
  }
  return sanitizeForkedFromField(opts.existingForkedFrom, own);
}
