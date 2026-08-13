/**
 * When a declared NIP-34 `source` / `forkedFrom` listing is smaller than the
 * local/index tree (files deleted upstream), allow replace.
 *
 * Applies to any external git SOURCE: GitHub, GitLab.com, Codeberg, Gitea /
 * self-hosted HTTPS remotes — not only github.com.
 * Never for GRASP / nostr-git mirror listings (those were wiping richer trees).
 * Nostr-only repos (no source/forkedFrom) keep the no-shrink safety; explicit
 * Refetch still opts in via persist context `[Refetch]`.
 */

const SOURCE_FETCH_TYPES = new Set([
  "github",
  "gitlab",
  "codeberg",
  "self-hosted-git",
]);

/** True for a declared SOURCE URL (forge or self-hosted), not a GRASP /npub path. */
export function urlLooksLikeSourceUpstream(
  raw: string | null | undefined
): boolean {
  const u = String(raw || "")
    .trim()
    .toLowerCase();
  if (!u) return false;
  if (
    u.includes("github.com") ||
    u.includes("gitlab.com") ||
    u.includes("codeberg.org")
  ) {
    return true;
  }
  if (/^git@[^:]+:.+/.test(u)) return true;
  try {
    let candidate = u;
    if (candidate.startsWith("git://")) {
      candidate = candidate.replace(/^git:\/\//, "https://");
    } else if (!/^https?:\/\//.test(candidate)) {
      candidate = `https://${candidate}`;
    }
    const url = new URL(candidate);
    // GRASP-shaped paths are mirrors, not SOURCE forges
    if (/\/npub1[a-z0-9]+/i.test(url.pathname)) return false;
    if (/\/grasp\//i.test(url.pathname)) return false;
    const parts = url.pathname
      .replace(/\.git$/i, "")
      .split("/")
      .filter(Boolean);
    return parts.length >= 2;
  } catch {
    return false;
  }
}

/** @deprecated Use urlLooksLikeSourceUpstream */
export const urlLooksLikeForgeUpstream = urlLooksLikeSourceUpstream;

export function isSourceUpstreamFetchType(
  sourceType: string | null | undefined
): boolean {
  if (sourceType == null || String(sourceType).trim() === "") return false;
  return SOURCE_FETCH_TYPES.has(String(sourceType).toLowerCase());
}

/** True when this fetch status is the declared SOURCE (not a GRASP mirror). */
export function isSourceUpstreamFetchStatus(
  status:
    | { source?: { type?: string; url?: string } | null }
    | null
    | undefined,
  sourceUrl?: string | null,
  forkedFrom?: string | null
): boolean {
  if (!status?.source) return false;
  if (isSourceUpstreamFetchType(status.source.type)) return true;
  const fetched = String(status.source.url || "")
    .trim()
    .toLowerCase()
    .replace(/\.git$/i, "");
  if (!fetched) return false;
  for (const raw of [sourceUrl, forkedFrom]) {
    if (!urlLooksLikeSourceUpstream(raw)) continue;
    const target = String(raw)
      .trim()
      .toLowerCase()
      .replace(/\.git$/i, "");
    if (!target) continue;
    if (
      fetched === target ||
      fetched.includes(target) ||
      target.includes(fetched)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Accept a smaller SOURCE listing when source/forkedFrom is set and the user
 * has no local edits. `sourceType` when set must be a forge/self-hosted fetch
 * (not nostr-git).
 */
export function allowShrinkToSourceUpstreamTree(opts: {
  hasUnpushedEdits?: boolean;
  /** Fetch that produced the tree — github | gitlab | codeberg | self-hosted-git */
  sourceType?: string | null;
  sourceUrl?: string | null;
  forkedFrom?: string | null;
  /** Ignored for eligibility — SOURCE is source/forkedFrom only, not clone[]. */
  clone?: string[] | null;
}): boolean {
  if (opts.hasUnpushedEdits === true) return false;
  const hasSource =
    urlLooksLikeSourceUpstream(opts.sourceUrl) ||
    urlLooksLikeSourceUpstream(opts.forkedFrom);
  if (!hasSource) return false;
  if (opts.sourceType != null && String(opts.sourceType).trim() !== "") {
    return isSourceUpstreamFetchType(opts.sourceType);
  }
  return true;
}

/** @deprecated Use allowShrinkToSourceUpstreamTree */
export const allowShrinkToForgeUpstreamTree = allowShrinkToSourceUpstreamTree;
