"use client";

import { KIND_REPOSITORY, KIND_REPOSITORY_NIP34 } from "@/lib/nostr/events";
import { parseGitHubRepoSpec } from "@/lib/nostr/nip82-repository-links";
import { extractGithubUrlFromEventTags } from "@/lib/repos/extract-forge-url-from-event-tags";
import { fetchForgeRepoForkMeta } from "@/lib/repos/forge-fork-meta";
import {
  applyGithubForkMetaToRepo,
  isRealForkAttribution,
  resolveStoredForkedFrom,
  sanitizeForkedFromField,
} from "@/lib/repos/fork-attribution";
import { parseGiteaCompatibleRepo } from "@/lib/repos/gitea-forge";
import { fetchRepoCloneHintsFromProfile } from "@/lib/repos/hydrate-clone-from-profile-repos";
import { isPlaceholderRepositoryDescription } from "@/lib/repos/repo-about-text";
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
import { isCloneableUpstreamSourceUrl } from "@/lib/utils/detect-git-forge";
import { resolveEntityToPubkey } from "@/lib/utils/entity-resolver";
import { isRefetchableUpstreamSourceUrl } from "@/lib/utils/git-source-fetcher";
import { findRepoByEntityAndName } from "@/lib/utils/repo-finder";
import {
  syncGiteaIssuesForRepo,
  syncGiteaPullsForRepo,
} from "@/lib/utils/sync-gitea-repo-issues-prs";
import {
  syncGithubIssuesForRepo,
  syncGithubPullsForRepo,
} from "@/lib/utils/sync-github-repo-issues-prs";
import { syncGithubReleasesForRepo } from "@/lib/utils/sync-github-repo-releases";

import { nip19 } from "nostr-tools";

export {
  extractForgeSourceFromEventTags,
  extractGithubUrlFromEventTags,
} from "@/lib/repos/extract-forge-url-from-event-tags";

export type GithubRepoMeta = {
  stars: number;
  forks: number;
  openIssues: number;
  pushedAtMs: number;
  updatedAtMs: number;
  /** GitHub repository description (sidebar About when mirrored from source). */
  description?: string;
  isFork?: boolean;
  parentHtmlUrl?: string;
  htmlUrl?: string;
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
  const r = findRepoByEntityAndName<StoredRepo>(repos, entity, repoSlug);
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

function resolveOwnerHexForRepo(entity: string): string | null {
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
  if (!ownerPubkey || !/^[0-9a-f]{64}$/i.test(ownerPubkey)) return null;
  return ownerPubkey.toLowerCase();
}

/** Latest kind 30617/51 — forge URL from profile-repos, then live subscribe. */
export async function queryNostrForGithubSourceUrl(
  entity: string,
  repoSlug: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  subscribe?: (...args: any[]) => () => void,
  relays?: string[]
): Promise<string> {
  const ownerPubkey = resolveOwnerHexForRepo(entity);
  if (!ownerPubkey) return "";

  try {
    const hints = await fetchRepoCloneHintsFromProfile(ownerPubkey, repoSlug);
    const fromProfile = hints?.sourceUrl?.trim();
    if (fromProfile && isCloneableUpstreamSourceUrl(fromProfile)) {
      return fromProfile.replace(/\.git$/i, "");
    }
  } catch {
    /* fall through to live subscribe */
  }

  if (!subscribe || !relays?.length) return "";

  return new Promise((resolve) => {
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
  if (!normalized || !isRefetchableUpstreamSourceUrl(normalized)) return;

  const repos = loadStoredRepos();
  const idx = repos.findIndex((r) => {
    const found = findRepoByEntityAndName([r], entity, repoSlug);
    return found !== undefined;
  });
  if (idx < 0) return;

  const existing = repos[idx]!;
  const clones = Array.isArray(existing.clone) ? [...existing.clone] : [];
  const forgeHostHint = (() => {
    try {
      return new URL(
        normalized.startsWith("http") ? normalized : `https://${normalized}`
      ).hostname.toLowerCase();
    } catch {
      return "";
    }
  })();
  const alreadyHasForge = clones.some((c) => {
    const s = String(c);
    if (forgeHostHint && s.toLowerCase().includes(forgeHostHint)) return true;
    return isRefetchableUpstreamSourceUrl(s);
  });
  // Keep forge discoverable locally; Push still omits it from clone when GRASP is present.
  if (!alreadyHasForge) {
    clones.unshift(
      normalized.endsWith(".git") ? normalized : `${normalized}.git`
    );
  }
  const clean = normalized.replace(/\.git$/, "");
  const nextForked = resolveStoredForkedFrom({
    existingForkedFrom: existing.forkedFrom,
    sourceUrl: clean,
    clone: clones,
    githubHtmlUrl: clean,
  });
  const next: StoredRepo = {
    ...existing,
    sourceUrl: clean,
    clone: clones,
  };
  if (nextForked) next.forkedFrom = nextForked;
  else delete next.forkedFrom;
  repos[idx] = next;
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
      fork?: boolean;
      html_url?: string;
      parent?: { html_url?: string };
    };
    const pushedAtMs = j.pushed_at ? new Date(j.pushed_at).getTime() : 0;
    const updatedAtMs = j.updated_at ? new Date(j.updated_at).getTime() : 0;
    const description =
      typeof j.description === "string" ? j.description.trim() : "";
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
      stars: typeof j.stargazers_count === "number" ? j.stargazers_count : 0,
      forks: typeof j.forks_count === "number" ? j.forks_count : 0,
      openIssues:
        typeof j.open_issues_count === "number" ? j.open_issues_count : 0,
      pushedAtMs,
      updatedAtMs,
      ...(description ? { description } : {}),
      ...(typeof j.fork === "boolean" ? { isFork: j.fork } : {}),
      ...(htmlUrl ? { htmlUrl } : {}),
      ...(parentHtmlUrl ? { parentHtmlUrl } : {}),
    };
  } catch {
    return null;
  }
}

export type ProfileRepoForkRow = {
  entity?: string;
  repo?: string;
  slug?: string;
  sourceUrl?: string | null;
  forkedFrom?: string | null;
  clone?: unknown;
  ownerPubkey?: string | null;
};

/**
 * Hydrate `forkedFrom` from forge APIs when Nostr tags lack it (old imports).
 * GitHub, GitLab, Gitea, Forgejo, Codeberg.
 */
export async function enrichReposWithForgeForkMeta<
  T extends ProfileRepoForkRow
>(
  repos: T[],
  opts?: {
    /** When true, write discovered fork parent into localStorage for own profile. */
    persistLocal?: boolean;
  }
): Promise<T[]> {
  const candidates = repos.filter((r) => {
    const src = String(r.sourceUrl || "").trim();
    if (!src || !isRefetchableUpstreamSourceUrl(src)) return false;
    const clone = Array.isArray(r.clone)
      ? r.clone.map((c) => (c == null ? "" : String(c)))
      : undefined;
    return !isRealForkAttribution(r.forkedFrom, {
      sourceUrl: src,
      clone,
    });
  });
  if (candidates.length === 0) return repos;

  const metaBySource = new Map<
    string,
    Awaited<ReturnType<typeof fetchForgeRepoForkMeta>>
  >();
  const batchSize = 4;
  for (let i = 0; i < candidates.length; i += batchSize) {
    const batch = candidates.slice(i, i + batchSize);
    await Promise.all(
      batch.map(async (r) => {
        const src = String(r.sourceUrl || "").trim();
        const key = src.toLowerCase().replace(/\.git$/i, "");
        if (metaBySource.has(key)) return;
        metaBySource.set(key, await fetchForgeRepoForkMeta(src));
      })
    );
  }

  let changed = false;
  const next = repos.map((r) => {
    const src = String(r.sourceUrl || "").trim();
    const key = src.toLowerCase().replace(/\.git$/i, "");
    const meta = metaBySource.get(key);
    if (!meta) return r;
    const updated = applyGithubForkMetaToRepo(r, meta);
    if (updated.forkedFrom !== r.forkedFrom) {
      changed = true;
      if (opts?.persistLocal && updated.forkedFrom) {
        const entity = String(r.entity || "").trim();
        const repoSlug = String(r.repo || r.slug || "").trim();
        if (entity && repoSlug) {
          persistRepoAnnouncementMeta({
            entity,
            repo: repoSlug,
            sourceUrl: src,
            forkedFrom: updated.forkedFrom,
            clone: Array.isArray(r.clone)
              ? r.clone.filter((c): c is string => typeof c === "string")
              : undefined,
            ownerPubkey: r.ownerPubkey,
          });
        }
      }
    }
    return updated;
  });

  return changed ? next : repos;
}

/** @deprecated Use enrichReposWithForgeForkMeta */
export const enrichReposWithGithubForkMeta = enrichReposWithForgeForkMeta;

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
  issuesOk?: boolean;
  pullsOk?: boolean;
}> {
  const record =
    opts.repoRecord ?? findStoredRepoForRoute(entity, repoSlug) ?? null;

  let sourceUrl = resolveGithubUpstreamForTabs(entity, repoSlug, record);
  if (!sourceUrl) {
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
    return {
      sourceUrl: "",
      meta: null,
      synced: false,
      issuesOk: false,
      pullsOk: false,
    };
  }

  writeUpstreamSourceSession(entity, repoSlug, sourceUrl);

  const gitea = parseGiteaCompatibleRepo(sourceUrl);
  const [issuesOk, pullsOk] = await Promise.all(
    sourceUrl.includes("github.com")
      ? [
          syncGithubIssuesForRepo(entity, repoSlug, sourceUrl),
          syncGithubPullsForRepo(entity, repoSlug, sourceUrl),
        ]
      : gitea
      ? [
          syncGiteaIssuesForRepo(entity, repoSlug, sourceUrl),
          syncGiteaPullsForRepo(entity, repoSlug, sourceUrl),
        ]
      : [Promise.resolve(false), Promise.resolve(false)]
  );
  // Warm releases bucket (same soft-sync as Releases tab; safe if unused)
  void syncGithubReleasesForRepo(entity, repoSlug, sourceUrl);

  const meta = sourceUrl.includes("github.com")
    ? await fetchGithubRepoMeta(sourceUrl)
    : null;
  const forkMeta = await fetchForgeRepoForkMeta(sourceUrl);
  if (meta?.pushedAtMs) {
    writeGithubPushedSession(entity, repoSlug, meta.pushedAtMs);
  }

  {
    const repos = loadStoredRepos();
    const idx = repos.findIndex((r) => {
      const found = findRepoByEntityAndName([r], entity, repoSlug);
      return found !== undefined;
    });
    if (idx >= 0 && repos[idx]) {
      const existing = repos[idx]!;
      const existingDesc = existing.description || "";
      const mayFillAbout =
        !!meta?.description &&
        isPlaceholderRepositoryDescription(existingDesc, repoSlug);
      const existingCreatedAt = (
        existing as StoredRepo & { lastNostrEventCreatedAt?: number }
      ).lastNostrEventCreatedAt;
      const nextCreatedAt = meta?.pushedAtMs
        ? Math.floor(meta.pushedAtMs / 1000)
        : existingCreatedAt;
      const nextForked = resolveStoredForkedFrom({
        existingForkedFrom: existing.forkedFrom,
        sourceUrl,
        clone: existing.clone,
        githubIsFork: forkMeta?.isFork ?? meta?.isFork,
        githubParentHtmlUrl: forkMeta?.parentHtmlUrl ?? meta?.parentHtmlUrl,
        githubHtmlUrl: forkMeta?.htmlUrl ?? meta?.htmlUrl ?? sourceUrl,
      });
      const forkChanged = (existing.forkedFrom || undefined) !== nextForked;
      const changed =
        (meta &&
          (existing.stars !== meta.stars ||
            existing.forks !== meta.forks ||
            (mayFillAbout && existingDesc !== meta.description) ||
            existingCreatedAt !== nextCreatedAt)) ||
        forkChanged;
      if (changed) {
        const nextRepo: StoredRepo = {
          ...existing,
          ...(meta
            ? {
                stars: meta.stars,
                forks: meta.forks,
                ...(mayFillAbout ? { description: meta.description } : {}),
                ...(nextCreatedAt !== undefined
                  ? { lastNostrEventCreatedAt: nextCreatedAt }
                  : {}),
              }
            : {}),
        };
        if (nextForked) nextRepo.forkedFrom = nextForked;
        else delete nextRepo.forkedFrom;
        repos[idx] = nextRepo;
        saveStoredRepos(repos);
        window.dispatchEvent(new Event("gittr:repos-updated"));
      }
    }
  }

  // Only treat as fully synced when both sides succeeded — otherwise layout
  // used to freeze after PRs-only and leave the Issues tab badge at 0.
  return {
    sourceUrl,
    meta,
    synced: Boolean(issuesOk && pullsOk),
    issuesOk,
    pullsOk,
  };
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
  description: string,
  opts?: { force?: boolean }
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
  // Never clobber an owner-set About with a GitHub hub refresh (unless force from Nostr).
  const existing = repos[idx]!.description || "";
  if (
    !opts?.force &&
    existing &&
    !isPlaceholderRepositoryDescription(existing, repoSlug) &&
    trimmed !== existing
  ) {
    return;
  }
  repos[idx] = { ...repos[idx]!, description: trimmed };
  saveStoredRepos(repos);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("gittr:repos-updated"));
  }
}

/** Write live 30617 fields so Event ID / Refetch / My Repositories survive a cache flush. */
export function persistRepoAnnouncementMeta(opts: {
  entity: string;
  repo: string;
  lastNostrEventId?: string | null;
  sourceUrl?: string | null;
  forkedFrom?: string | null;
  clone?: string[] | null;
  description?: string | null;
  ownerPubkey?: string | null;
  publicRead?: boolean;
}): void {
  const repos = loadStoredRepos();
  const idx = repos.findIndex((r) => {
    const found = findRepoByEntityAndName([r], opts.entity, opts.repo);
    return found !== undefined;
  });
  const eventId =
    typeof opts.lastNostrEventId === "string" &&
    /^[0-9a-f]{64}$/i.test(opts.lastNostrEventId)
      ? opts.lastNostrEventId.toLowerCase()
      : "";
  const source =
    typeof opts.sourceUrl === "string" && opts.sourceUrl.trim()
      ? opts.sourceUrl.trim()
      : "";
  const forkedRaw =
    typeof opts.forkedFrom === "string" && opts.forkedFrom.trim()
      ? opts.forkedFrom.trim()
      : "";
  const clone = Array.isArray(opts.clone)
    ? opts.clone.filter((u) => typeof u === "string" && u.trim())
    : [];
  const description =
    typeof opts.description === "string" ? opts.description.trim() : "";
  const owner =
    typeof opts.ownerPubkey === "string" &&
    /^[0-9a-f]{64}$/i.test(opts.ownerPubkey)
      ? opts.ownerPubkey.toLowerCase()
      : "";

  const patch: Partial<StoredRepo> = {
    syncedFromNostr: true,
    fromNostr: true,
  };
  if (eventId) {
    patch.lastNostrEventId = eventId;
    patch.nostrEventId = eventId;
  }
  if (source) patch.sourceUrl = source;
  const prevForSanitize = idx >= 0 ? repos[idx] : undefined;
  const sanitizedFork = sanitizeForkedFromField(
    forkedRaw || prevForSanitize?.forkedFrom,
    {
      sourceUrl: source || prevForSanitize?.sourceUrl,
      clone: clone.length > 0 ? clone : prevForSanitize?.clone,
    }
  );
  if (sanitizedFork) patch.forkedFrom = sanitizedFork;
  if (clone.length > 0) patch.clone = clone;
  if (description) patch.description = description;
  if (owner) patch.ownerPubkey = owner;
  if (typeof opts.publicRead === "boolean") {
    patch.publicRead = opts.publicRead;
  }

  if (idx < 0 || !repos[idx]) {
    repos.push({
      entity: opts.entity,
      repo: opts.repo,
      slug: opts.repo,
      name: opts.repo,
      createdAt: Date.now(),
      ...patch,
    } as StoredRepo);
  } else {
    const prev = repos[idx]!;
    const next: StoredRepo = {
      ...prev,
      ...patch,
      clone: clone.length > 0 ? clone : prev.clone,
      sourceUrl: source || prev.sourceUrl,
      description: description || prev.description,
      lastNostrEventId: eventId || prev.lastNostrEventId,
      nostrEventId: eventId || prev.nostrEventId,
      ownerPubkey: owner || prev.ownerPubkey,
      publicRead:
        typeof opts.publicRead === "boolean"
          ? opts.publicRead
          : prev.publicRead,
      syncedFromNostr: true,
      fromNostr: true,
    };
    if (sanitizedFork) {
      next.forkedFrom = sanitizedFork;
    } else if (forkedRaw) {
      // Event explicitly carried a forkedFrom tag that did not survive sanitize.
      delete next.forkedFrom;
    } else if (prev.forkedFrom) {
      // Tag-less 30617 must not wipe a GitHub-hydrated fork parent.
      const kept = sanitizeForkedFromField(prev.forkedFrom, {
        sourceUrl: source || prev.sourceUrl,
        clone: clone.length > 0 ? clone : prev.clone,
      });
      if (kept) next.forkedFrom = kept;
      else delete next.forkedFrom;
    } else {
      delete next.forkedFrom;
    }
    // A live 30617 is not a local-only stub — drop the misleading badge.
    if ((eventId || next.lastNostrEventId) && next.status === "local") {
      delete next.status;
    }
    const unchanged =
      prev.lastNostrEventId === next.lastNostrEventId &&
      prev.nostrEventId === next.nostrEventId &&
      prev.sourceUrl === next.sourceUrl &&
      prev.forkedFrom === next.forkedFrom &&
      prev.description === next.description &&
      prev.ownerPubkey === next.ownerPubkey &&
      prev.publicRead === next.publicRead &&
      prev.syncedFromNostr === next.syncedFromNostr &&
      prev.status === next.status &&
      JSON.stringify(prev.clone || []) === JSON.stringify(next.clone || []);
    if (unchanged) return;
    repos[idx] = next;
  }
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
