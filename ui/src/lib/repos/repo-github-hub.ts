"use client";

import { KIND_REPOSITORY, KIND_REPOSITORY_NIP34 } from "@/lib/nostr/events";
import { parseGitHubRepoSpec } from "@/lib/nostr/nip82-repository-links";
import {
  type StoredRepo,
  loadStoredRepos,
  saveStoredRepos,
} from "@/lib/repos/storage";
import {
  readUpstreamSourceSession,
  resolveGithubUpstreamForTabs,
  resolveRepoUpstreamSource,
  writeUpstreamSourceSession,
} from "@/lib/repos/upstream-precedence";
import { resolveEntityToPubkey } from "@/lib/utils/entity-resolver";
import { isRefetchableUpstreamSourceUrl } from "@/lib/utils/git-source-fetcher";
import { findRepoByEntityAndName } from "@/lib/utils/repo-finder";
import {
  syncGithubIssuesForRepo,
  syncGithubPullsForRepo,
} from "@/lib/utils/sync-github-repo-issues-prs";

import { nip19 } from "nostr-tools";

export type GithubRepoMeta = {
  stars: number;
  forks: number;
  openIssues: number;
  pushedAtMs: number;
  updatedAtMs: number;
  /** GitHub repository description (sidebar About when mirrored from source). */
  description?: string;
};

export function githubPushedSessionKey(entity: string, repo: string): string {
  return `gittr_github_pushed_ms__${entity}__${repo}`;
}

export function readGithubPushedSession(entity: string, repo: string): number {
  if (typeof window === "undefined") return 0;
  try {
    const raw = sessionStorage.getItem(githubPushedSessionKey(entity, repo));
    return raw ? parseInt(raw, 10) || 0 : 0;
  } catch {
    return 0;
  }
}

export function writeGithubPushedSession(
  entity: string,
  repo: string,
  pushedAtMs: number
): void {
  if (typeof window === "undefined" || !pushedAtMs) return;
  try {
    sessionStorage.setItem(
      githubPushedSessionKey(entity, repo),
      String(pushedAtMs)
    );
  } catch {
    /* ignore */
  }
}

export function findStoredRepoForRoute(
  entity: string,
  repoSlug: string
): StoredRepo | undefined {
  const repos = loadStoredRepos();
  let r = findRepoByEntityAndName<StoredRepo>(repos, entity, repoSlug);
  if (r) return r;
  const pk = resolveEntityToPubkey(entity)?.toLowerCase();
  return repos.find((x) => {
    const nameMatch = [x.repo, x.slug, x.name].some(
      (n) => n && String(n).toLowerCase() === repoSlug.toLowerCase()
    );
    if (!nameMatch) return false;
    if (pk && x.ownerPubkey) {
      return x.ownerPubkey.toLowerCase() === pk;
    }
    return true;
  });
}

function extractGithubUrlFromEventTags(tags: string[][]): string {
  for (const tag of tags) {
    if (!Array.isArray(tag)) continue;
    if (
      tag[0] === "source" &&
      tag[1] &&
      isRefetchableUpstreamSourceUrl(tag[1])
    ) {
      const u = String(tag[1]);
      if (u.includes("github.com")) return u;
    }
  }
  for (const tag of tags) {
    if (!Array.isArray(tag) || tag[0] !== "clone" || !tag[1]) continue;
    const u = String(tag[1]);
    if (u.includes("github.com") && isRefetchableUpstreamSourceUrl(u)) {
      return u;
    }
  }
  return "";
}

/** Latest kind 30617/51 on relays — finds github.com in source/clone tags. */
export function queryNostrForGithubSourceUrl(
  entity: string,
  repoSlug: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  subscribe: (...args: any[]) => () => void,
  relays: string[]
): Promise<string> {
  return new Promise((resolve) => {
    let ownerPubkey: string | null = resolveEntityToPubkey(entity);
    if (!ownerPubkey && entity.startsWith("npub")) {
      try {
        const decoded = nip19.decode(entity);
        if (decoded.type === "npub") {
          ownerPubkey = decoded.data as string;
        }
      } catch {
        /* ignore */
      }
    }
    if (!ownerPubkey || !/^[0-9a-f]{64}$/i.test(ownerPubkey)) {
      resolve("");
      return;
    }

    let bestUrl = "";
    let bestCreated = 0;
    let settled = false;

    const finish = (url: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        unsub();
      } catch {
        /* ignore */
      }
      resolve(url);
    };

    const timer = setTimeout(() => finish(bestUrl), 6000);

    const unsub = subscribe(
      [
        {
          kinds: [KIND_REPOSITORY, KIND_REPOSITORY_NIP34],
          authors: [ownerPubkey],
          "#d": [repoSlug],
        },
      ],
      relays,
      (event: { kind: number; created_at: number; tags: string[][] }) => {
        const url = extractGithubUrlFromEventTags(event.tags || []);
        if (!url) return;
        if (event.created_at >= bestCreated) {
          bestCreated = event.created_at;
          bestUrl = url;
        }
      },
      () => finish(bestUrl)
    );
  });
}

export function persistGithubSourceOnRepo(
  entity: string,
  repoSlug: string,
  sourceUrl: string
): void {
  const normalized = resolveRepoUpstreamSource({
    sourceUrl,
    clone: [sourceUrl],
  });
  if (!normalized.includes("github.com")) return;

  const repos = loadStoredRepos();
  const idx = repos.findIndex((r) => {
    const found = findRepoByEntityAndName([r], entity, repoSlug);
    return found !== undefined;
  });
  if (idx < 0) return;

  const existing = repos[idx]!;
  const clones = Array.isArray(existing.clone) ? [...existing.clone] : [];
  if (!clones.some((c) => String(c).includes("github.com"))) {
    clones.unshift(
      normalized.endsWith(".git") ? normalized : `${normalized}.git`
    );
  }
  repos[idx] = {
    ...existing,
    sourceUrl: normalized.replace(/\.git$/, ""),
    forkedFrom: existing.forkedFrom || normalized.replace(/\.git$/, ""),
    clone: clones,
  };
  saveStoredRepos(repos);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("gittr:repos-updated"));
  }
}

export async function fetchGithubRepoMeta(
  sourceUrl: string
): Promise<GithubRepoMeta | null> {
  const spec = parseGitHubRepoSpec(sourceUrl);
  if (!spec) return null;
  try {
    const endpoint = `/repos/${spec.owner}/${spec.repo}`;
    const r = await fetch(
      `/api/github/proxy?endpoint=${encodeURIComponent(endpoint)}`
    );
    if (!r.ok) return null;
    const j = (await r.json()) as {
      stargazers_count?: number;
      forks_count?: number;
      open_issues_count?: number;
      pushed_at?: string;
      updated_at?: string;
      description?: string | null;
    };
    const pushedAtMs = j.pushed_at ? new Date(j.pushed_at).getTime() : 0;
    const updatedAtMs = j.updated_at ? new Date(j.updated_at).getTime() : 0;
    const description =
      typeof j.description === "string" ? j.description.trim() : "";
    return {
      stars: typeof j.stargazers_count === "number" ? j.stargazers_count : 0,
      forks: typeof j.forks_count === "number" ? j.forks_count : 0,
      openIssues:
        typeof j.open_issues_count === "number" ? j.open_issues_count : 0,
      pushedAtMs,
      updatedAtMs,
      ...(description ? { description } : {}),
    };
  } catch {
    return null;
  }
}

/**
 * Resolve GitHub mirror, sync issues/PRs into localStorage, refresh forge metadata.
 * Safe to call from layout on every repo visit.
 */
export async function hydrateRepoFromGithub(
  entity: string,
  repoSlug: string,
  opts: {
    repoRecord?: StoredRepo | null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    subscribe?: (...args: any[]) => () => void;
    defaultRelays?: string[];
  }
): Promise<{
  sourceUrl: string;
  meta: GithubRepoMeta | null;
  synced: boolean;
}> {
  const record =
    opts.repoRecord ?? findStoredRepoForRoute(entity, repoSlug) ?? null;

  let sourceUrl = resolveGithubUpstreamForTabs(entity, repoSlug, record);
  if (
    !sourceUrl &&
    opts.subscribe &&
    opts.defaultRelays &&
    opts.defaultRelays.length > 0
  ) {
    sourceUrl = await queryNostrForGithubSourceUrl(
      entity,
      repoSlug,
      opts.subscribe,
      opts.defaultRelays
    );
    if (sourceUrl) {
      persistGithubSourceOnRepo(entity, repoSlug, sourceUrl);
    }
  }

  if (!sourceUrl) {
    return { sourceUrl: "", meta: null, synced: false };
  }

  writeUpstreamSourceSession(entity, repoSlug, sourceUrl);

  const [issuesOk, pullsOk] = await Promise.all([
    syncGithubIssuesForRepo(entity, repoSlug, sourceUrl),
    syncGithubPullsForRepo(entity, repoSlug, sourceUrl),
  ]);

  const meta = await fetchGithubRepoMeta(sourceUrl);
  if (meta?.pushedAtMs) {
    writeGithubPushedSession(entity, repoSlug, meta.pushedAtMs);
  }

  if (meta) {
    const repos = loadStoredRepos();
    const idx = repos.findIndex((r) => {
      const found = findRepoByEntityAndName([r], entity, repoSlug);
      return found !== undefined;
    });
    if (idx >= 0 && repos[idx]) {
      repos[idx] = {
        ...repos[idx]!,
        stars: meta.stars,
        forks: meta.forks,
        ...(meta.description ? { description: meta.description } : {}),
        lastNostrEventCreatedAt: Math.floor(
          (meta.pushedAtMs || Date.now()) / 1000
        ),
      } as StoredRepo;
      saveStoredRepos(repos);
      window.dispatchEvent(new Event("gittr:repos-updated"));
    }
  }

  return { sourceUrl, meta, synced: Boolean(issuesOk || pullsOk) };
}

/** GitHub `description` field for sidebar About (import / refetch). */
export async function fetchGithubRepoDescription(
  sourceUrl: string
): Promise<string | null> {
  const meta = await fetchGithubRepoMeta(sourceUrl);
  return meta?.description?.trim() || null;
}

export function persistRepoDescription(
  entity: string,
  repoSlug: string,
  description: string
): void {
  const trimmed = description.trim();
  if (!trimmed) return;
  const repos = loadStoredRepos();
  const idx = repos.findIndex((r) => {
    const found = findRepoByEntityAndName([r], entity, repoSlug);
    return found !== undefined;
  });
  if (idx < 0 || !repos[idx]) return;
  if (repos[idx]!.description === trimmed) return;
  repos[idx] = { ...repos[idx]!, description: trimmed };
  saveStoredRepos(repos);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("gittr:repos-updated"));
  }
}

/** Milliseconds for "last activity" display (not repo birth date). */
export function resolveRepoActivityDisplayMs(
  repo:
    | {
        createdAt?: number;
        updatedAt?: number;
        lastNostrEventCreatedAt?: number;
      }
    | null
    | undefined,
  entity: string,
  repoSlug: string
): number | undefined {
  const candidates: number[] = [];
  const sessionPush = readGithubPushedSession(entity, repoSlug);
  if (sessionPush > 0) candidates.push(sessionPush);

  if (repo?.lastNostrEventCreatedAt) {
    const n = Number(repo.lastNostrEventCreatedAt);
    candidates.push(n < 1e12 ? n * 1000 : n);
  }
  if (repo?.updatedAt) {
    const u = Number(repo.updatedAt);
    candidates.push(u < 1e12 ? u * 1000 : u);
  }
  if (candidates.length > 0) return Math.max(...candidates);
  if (repo?.createdAt) {
    const c = Number(repo.createdAt);
    return c < 1e12 ? c * 1000 : c;
  }
  return undefined;
}
