/**
 * When a repo has a GitHub (or other refetchable) upstream mirror, the live forge
 * is authoritative — not legacy kind-51 embedded trees or old gittr_files / bridge mirrors.
 */
import { isRefetchableUpstreamSourceUrl } from "@/lib/utils/git-source-fetcher";
import { normalizeGithubSourceUrl } from "@/lib/utils/normalize-github-source-url";

export function isNostrEntityRoute(entity: string | undefined | null): boolean {
  if (!entity) return false;
  return entity.startsWith("npub") || /^[0-9a-f]{64}$/i.test(entity);
}

export function resolveUpstreamSourceUrl(
  ...candidates: Array<string | undefined | null>
): string {
  for (const c of candidates) {
    if (c == null) continue;
    const url = normalizeGithubSourceUrl(String(c).trim());
    if (url && isRefetchableUpstreamSourceUrl(url)) return url;
  }
  return "";
}

export function hasGithubUpstreamMirror(
  ...candidates: Array<string | undefined | null>
): boolean {
  const url = resolveUpstreamSourceUrl(...candidates);
  return url.includes("github.com");
}

export function resolveRepoUpstreamSource(
  repo:
    | {
        sourceUrl?: string | null;
        forkedFrom?: string | null;
        clone?: string[] | null;
      }
    | null
    | undefined
): string {
  const clones = Array.isArray(repo?.clone) ? repo.clone : [];
  return resolveUpstreamSourceUrl(repo?.sourceUrl, repo?.forkedFrom, ...clones);
}

/** GitHub/upstream should win over Nostr snapshots and local cache unless user has local edits. */
export function shouldPreferUpstreamMirror(
  entity: string | undefined | null,
  opts: {
    sourceUrl?: string | null;
    forkedFrom?: string | null;
    clone?: string[] | null;
    hasUnpushedEdits?: boolean;
  }
): boolean {
  if (opts.hasUnpushedEdits) return false;
  const clones = Array.isArray(opts.clone) ? opts.clone : [];
  if (hasGithubUpstreamMirror(opts.sourceUrl, opts.forkedFrom, ...clones)) {
    return true;
  }
  return isNostrEntityRoute(entity ?? "");
}

/** README / About text from GitHub — even when the file tree has unpushed local edits. */
export function shouldPreferUpstreamContent(
  entity: string | undefined | null,
  opts: {
    sourceUrl?: string | null;
    forkedFrom?: string | null;
    clone?: string[] | null;
  }
): boolean {
  const clones = Array.isArray(opts.clone) ? opts.clone : [];
  if (hasGithubUpstreamMirror(opts.sourceUrl, opts.forkedFrom, ...clones)) {
    return true;
  }
  return isNostrEntityRoute(entity ?? "");
}

export function sourceTreeFreshStorageKey(
  entity: string,
  repo: string
): string {
  return `gittr_source_tree_fresh_ms__${entity}__${repo}`;
}

export function readSourceTreeFreshMs(
  entity: string,
  repo: string,
  altRepo?: string
): number {
  if (typeof window === "undefined") return 0;
  const keys = [sourceTreeFreshStorageKey(entity, repo)];
  if (altRepo && altRepo !== repo) {
    keys.push(sourceTreeFreshStorageKey(entity, altRepo));
  }
  let max = 0;
  for (const key of keys) {
    try {
      const raw = sessionStorage.getItem(key);
      const n = raw ? parseInt(raw, 10) : 0;
      if (n > max) max = n;
    } catch {
      /* ignore */
    }
  }
  return max;
}

export function upstreamSourceSessionKey(entity: string, repo: string): string {
  return `gittr_upstream_source__${entity}__${repo}`;
}

/** Remember resolved GitHub URL for Issues/PRs tabs (same browser session). */
export function writeUpstreamSourceSession(
  entity: string,
  repo: string,
  sourceUrl: string
): void {
  if (typeof window === "undefined") return;
  const url = resolveUpstreamSourceUrl(sourceUrl);
  if (!url) return;
  try {
    sessionStorage.setItem(upstreamSourceSessionKey(entity, repo), url);
  } catch {
    /* ignore */
  }
}

export function readUpstreamSourceSession(
  entity: string,
  repo: string
): string {
  if (typeof window === "undefined") return "";
  try {
    return resolveUpstreamSourceUrl(
      sessionStorage.getItem(upstreamSourceSessionKey(entity, repo))
    );
  } catch {
    return "";
  }
}

export function resolveGithubUpstreamForTabs(
  entity: string,
  repoSlug: string,
  repoRecord?: {
    sourceUrl?: string | null;
    forkedFrom?: string | null;
    clone?: string[] | null;
  } | null
): string {
  const fromRecord = resolveRepoUpstreamSource(repoRecord);
  if (fromRecord.includes("github.com")) return fromRecord;
  const fromSession = readUpstreamSourceSession(entity, repoSlug);
  if (fromSession.includes("github.com")) return fromSession;
  return "";
}

export function markSourceTreeFresh(
  entity: string,
  repo: string,
  altRepo?: string
): void {
  if (typeof window === "undefined") return;
  const stamp = String(Date.now());
  try {
    sessionStorage.setItem(sourceTreeFreshStorageKey(entity, repo), stamp);
    if (altRepo && altRepo !== repo) {
      sessionStorage.setItem(
        sourceTreeFreshStorageKey(entity, altRepo),
        stamp
      );
    }
  } catch {
    /* ignore */
  }
}

/** Legacy kind 51 events often embed an ancient full tree; skip applying it when GitHub is canonical. */
/** Put GitHub (and explicit `sourceUrl`) first so GRASP timeouts do not block upstream refresh. */
export function prioritizeUpstreamCloneUrls(
  cloneUrls: string[],
  preferredSourceUrl?: string | null
): string[] {
  const github: string[] = [];
  const rest: string[] = [];
  const seen = new Set<string>();
  const add = (url: string) => {
    const t = url.trim();
    if (!t) return;
    const key = t.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    if (key.includes("github.com")) github.push(t);
    else rest.push(t);
  };
  const prefer = resolveUpstreamSourceUrl(preferredSourceUrl);
  if (prefer) add(prefer);
  for (const u of cloneUrls) add(u);
  return [...github, ...rest];
}

export function shouldSkipLegacyKind51EmbeddedFiles(opts: {
  eventKind: number;
  kindRepository: number;
  hasValidEmbeddedFiles: boolean;
  entity: string;
  sourceUrl?: string | null;
  forkedFrom?: string | null;
  clone?: string[] | null;
  eventSourceUrl?: string | null;
  eventForkedFrom?: string | null;
  /** When a kind 30617 exists, never apply kind-51 embedded file trees. */
  latestNip34CreatedAt?: number;
}): boolean {
  if (!opts.hasValidEmbeddedFiles || opts.eventKind !== opts.kindRepository) {
    return false;
  }
  if (opts.latestNip34CreatedAt && opts.latestNip34CreatedAt > 0) {
    return true;
  }
  return shouldPreferUpstreamContent(opts.entity, {
    sourceUrl:
      opts.eventSourceUrl || opts.sourceUrl || opts.eventForkedFrom || opts.forkedFrom,
    forkedFrom: opts.eventForkedFrom || opts.forkedFrom,
    clone: opts.clone,
  });
}
