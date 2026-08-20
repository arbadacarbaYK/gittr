import { shouldDropFlatBasenameForNestedUpload } from "./select-display-file-tree";
import {
  getRepoStorageKey,
  normalizeEntityForStorage,
  normalizeRepoSlugForMatch,
} from "@/lib/utils/entity-normalizer";
import { getRepoOwnerPubkey } from "@/lib/utils/entity-resolver";
import { mergeStoredContributorLists } from "@/lib/utils/repo-contributors-from-nostr";
import { findRepoByEntityAndName } from "@/lib/utils/repo-finder";
import { markRepoAsEdited } from "@/lib/utils/repo-status";

import { nip19 } from "nostr-tools";

import { reconcileDeletedPathsAfterAdd } from "./deleted-paths";
import {
  forgetOverrideBlob,
  idbDeleteRepoOverrides,
  idbPutOverride,
  isOverrideIdbMarker,
  mimeForOverrideStorage,
  overrideIdbMarker,
  rememberOverrideBlob,
  resolveOverridesMap,
} from "./overrides-idb";
import {
  clearDeletedRepoTombstonesForOwner,
} from "./deleted-repo-tombstones";
import {
  classifyForeignReposForFlush,
  classifyOwnReposForFlush,
} from "./repo-cache-flush";

type JsonRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null;

export const estimateLocalStorageSize = (): number => {
  if (typeof window === "undefined") return 0;
  let total = 0;
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key) continue;
    const value = localStorage.getItem(key) || "";
    total += key.length + value.length;
  }
  return total;
};

export type RepoLinkType =
  | "docs"
  | "discord"
  | "slack"
  | "youtube"
  | "twitter"
  | "github"
  | "other";

export interface RepoLink {
  type: RepoLinkType;
  url: string;
  label?: string;
}

export interface RepoFileEntry {
  path: string;
  type: string;
  size?: number;
  sha?: string;
  url?: string;
  isBinary?: boolean; // Flag to indicate binary files (images, PDFs, etc.)
}

export interface StoredContributor {
  pubkey?: string;
  name?: string;
  picture?: string;
  weight?: number;
  githubLogin?: string;
  role?: "owner" | "maintainer" | "contributor";
  login?: string; // GitHub/GitLab/Codeberg format
  avatar_url?: string;
  contributions?: number;
}

export interface StoredRepo {
  entity: string;
  repo?: string;
  /** Some imports (e.g. GitHub) keep the upstream repo label separately from `repo`. */
  repositoryName?: string;
  slug?: string;
  name?: string;
  ownerPubkey?: string;
  contributors?: StoredContributor[];
  files?: RepoFileEntry[]; // Deprecated: Use fileCount + separate files storage instead
  fileCount?: number; // Number of files (files stored separately via saveRepoFiles)
  sourceUrl?: string;
  readme?: string;
  forkedFrom?: string;
  clone?: string[];
  relays?: string[];
  topics?: string[];
  defaultBranch?: string;
  description?: string;
  stars?: number;
  forks?: number;
  languages?: Record<string, number>;
  links?: RepoLink[];
  issues?: unknown[];
  pulls?: unknown[];
  commits?: unknown[];
  // Runtime properties (not always in storage)
  entityDisplayName?: string;
  createdAt?: number;
  updatedAt?: number;
  lastModifiedAt?: number;
  branches?: string[];
  tags?: string[];
  lastNostrEventId?: string;
  /** Unix seconds (Nostr created_at) of the latest kind 30617/51 we applied */
  lastNostrEventCreatedAt?: number;
  nostrEventId?: string;
  stateEventId?: string;
  lastStateEventId?: string;
  deleted?: boolean;
  hasUnpushedEdits?: boolean;
  status?: string;
  syncedFromNostr?: boolean;
  fromNostr?: boolean;
  publicRead?: boolean; // NIP-34: Repository privacy (read access)
  publicWrite?: boolean; // NIP-34: Repository privacy (write access)
  pushCostSats?: number; // Optional repo-level push paywall cost in sats
  /**
   * Optional gittr Pages named-site segment (NIP-5A `d` tag, 1–13 chars).
   * When set (after normalization), live URLs use this instead of the repo slug.
   */
  pagesSiteSlug?: string;
  /**
   * Android app id from the latest NIP-82 software announce published via gittr
   * (used to keep an Apps directory link in repo.links on Push).
   */
  announcedAppId?: string;
}

const hasLocalChanges = (repo: StoredRepo): boolean =>
  repo.hasUnpushedEdits === true || repo.status === "local";

const isNostrSyncedRepo = (repo: StoredRepo): boolean => {
  return !!(
    repo.syncedFromNostr ||
    repo.fromNostr ||
    repo.nostrEventId ||
    repo.lastNostrEventId ||
    repo.stateEventId ||
    repo.lastStateEventId
  );
};

export const isRepoOwnedByPubkey = (
  repo: StoredRepo,
  pubkey: string
): boolean => {
  if (!pubkey) return false;
  const normalizedPubkey = pubkey.toLowerCase();

  // Priority 1: Check direct ownerPubkey match (most reliable)
  const directOwnerPubkey = repo.ownerPubkey;
  if (directOwnerPubkey && /^[0-9a-f]{64}$/i.test(directOwnerPubkey)) {
    return directOwnerPubkey.toLowerCase() === normalizedPubkey;
  }

  // Priority 2: Check via getRepoOwnerPubkey (uses ownerPubkey or contributors)
  const repoOwnerPubkey = getRepoOwnerPubkey(repo, repo.entity);
  if (repoOwnerPubkey && /^[0-9a-f]{64}$/i.test(repoOwnerPubkey)) {
    return repoOwnerPubkey.toLowerCase() === normalizedPubkey;
  }

  // Priority 3: Check contributors for owner with matching pubkey
  if (repo.contributors && Array.isArray(repo.contributors)) {
    const ownerContributor = repo.contributors.find(
      (c: StoredContributor) =>
        c.pubkey &&
        /^[0-9a-f]{64}$/i.test(c.pubkey) &&
        c.pubkey.toLowerCase() === normalizedPubkey &&
        (c.weight === 100 || c.role === "owner")
    );
    if (ownerContributor) return true;
  }

  // Priority 4: Check if entity (npub format) matches current user's pubkey
  if (repo.entity && repo.entity.startsWith("npub")) {
    try {
      const decoded = nip19.decode(repo.entity);
      if (decoded.type === "npub") {
        const entityPubkey = decoded.data as string;
        return entityPubkey.toLowerCase() === normalizedPubkey;
      }
    } catch {
      return false;
    }
  }

  return false;
};

export type RepoCacheFlushStats = {
  /** Unique other-people / own repos actually dropped (matches cards, not duplicate rows). */
  clearedRepos: number;
  /** File/issue/PR/override localStorage keys deleted. */
  clearedKeys: number;
  /** Unique rows that remain in the catalog after the flush. */
  keptRepos: number;
  /** Unique repos owned by the signed-in pubkey that remain. */
  keptOwnRepos: number;
  /** Unique other-people repos kept because of unpushed local edits. */
  keptForeignLocal: number;
  /** Extra catalog rows collapsed because they were the same repo listed twice. */
  duplicateRowsCollapsed: number;
};

const emptyFlushStats = (): RepoCacheFlushStats => ({
  clearedRepos: 0,
  clearedKeys: 0,
  keptRepos: 0,
  keptOwnRepos: 0,
  keptForeignLocal: 0,
  duplicateRowsCollapsed: 0,
});

function readCatalogRowsForFlush(): StoredRepo[] {
  return parseJsonArray(localStorage.getItem("gittr_repos"), isStoredRepo);
}

function planForeignReposFlush(
  pubkey: string,
  options?: { preserveUnpushedEdits?: boolean; preserveWithMetadata?: boolean }
): {
  unique: StoredRepo[];
  keptRepos: StoredRepo[];
  foreignRepos: StoredRepo[];
  keptOwnRepos: number;
  keptForeignLocal: number;
  duplicateRowsCollapsed: number;
  metadataPatterns: Set<string>;
} | null {
  if (typeof window === "undefined" || !pubkey) return null;
  const preserveUnpushedEdits = options?.preserveUnpushedEdits ?? true;
  const preserveWithMetadata = options?.preserveWithMetadata ?? false;
  const metadataPatterns = preserveWithMetadata
    ? collectMetadataPatterns()
    : new Set<string>();
  const raw = readCatalogRowsForFlush();
  const classified = classifyForeignReposForFlush(
    raw,
    (repo) => isRepoOwnedByPubkey(repo, pubkey),
    { preserveUnpushedEdits }
  );
  let keptRepos = classified.keptRepos;
  if (preserveWithMetadata) {
    const extraKept = classified.foreignRepos.filter((repo) => {
      const entity = repo.entity || repo.slug?.split("/")[0] || "";
      const repoName =
        repo.repo || repo.slug?.split("/")[1] || repo.name || repo.slug || "";
      if (!entity || !repoName) return false;
      const pattern = getRepoStorageKey("gittr_test", entity, repoName).replace(
        "gittr_test__",
        ""
      );
      return metadataPatterns.has(pattern);
    });
    if (extraKept.length > 0) {
      keptRepos = [...keptRepos, ...extraKept];
    }
  }
  const foreignRepos = classified.unique.filter(
    (repo) => !keptRepos.includes(repo)
  );
  const keptOwnRepos = keptRepos.filter((repo) =>
    isRepoOwnedByPubkey(repo, pubkey)
  ).length;
  const keptForeignLocal = keptRepos.length - keptOwnRepos;
  return {
    unique: classified.unique,
    keptRepos,
    foreignRepos,
    keptOwnRepos,
    keptForeignLocal,
    duplicateRowsCollapsed: classified.duplicateRowsCollapsed,
    metadataPatterns,
  };
}

function planOwnReposFlush(pubkey: string): {
  unique: StoredRepo[];
  ownRepos: StoredRepo[];
  keptRepos: StoredRepo[];
  duplicateRowsCollapsed: number;
} | null {
  if (typeof window === "undefined" || !pubkey) return null;
  const raw = readCatalogRowsForFlush();
  const classified = classifyOwnReposForFlush(raw, (repo) =>
    isRepoOwnedByPubkey(repo, pubkey)
  );
  return {
    unique: classified.unique,
    ownRepos: classified.ownRepos,
    keptRepos: classified.keptRepos,
    duplicateRowsCollapsed: classified.duplicateRowsCollapsed,
  };
}

/** Dry-run of flush others — same numbers the confirm modal and alert will use. */
export const previewForeignReposFlush = (
  pubkey: string,
  options?: { preserveUnpushedEdits?: boolean; preserveWithMetadata?: boolean }
): RepoCacheFlushStats => {
  const plan = planForeignReposFlush(pubkey, options);
  if (!plan) return emptyFlushStats();
  const keptRepoPatterns = buildRepoKeyPatterns(plan.keptRepos);
  plan.metadataPatterns.forEach((pattern) => keptRepoPatterns.push(pattern));
  return {
    clearedRepos: plan.foreignRepos.length,
    clearedKeys: listRepoStorageKeysExceptPatterns(keptRepoPatterns).length,
    keptRepos: plan.keptRepos.length,
    keptOwnRepos: plan.keptOwnRepos,
    keptForeignLocal: plan.keptForeignLocal,
    duplicateRowsCollapsed: plan.duplicateRowsCollapsed,
  };
};

/** Dry-run of flush my own repos. */
export const previewOwnReposFlush = (pubkey: string): RepoCacheFlushStats => {
  const plan = planOwnReposFlush(pubkey);
  if (!plan) return emptyFlushStats();
  return {
    clearedRepos: plan.ownRepos.length,
    clearedKeys: listStorageKeysForPatterns(buildRepoKeyPatterns(plan.ownRepos))
      .length,
    keptRepos: plan.keptRepos.length,
    keptOwnRepos: 0,
    keptForeignLocal: plan.keptRepos.length,
    duplicateRowsCollapsed: plan.duplicateRowsCollapsed,
  };
};

export const clearForeignReposFromStorage = (
  pubkey: string,
  options?: { preserveUnpushedEdits?: boolean; preserveWithMetadata?: boolean }
): RepoCacheFlushStats => {
  const plan = planForeignReposFlush(pubkey, options);
  if (!plan) return emptyFlushStats();

  localStorage.setItem("gittr_repos", JSON.stringify(plan.keptRepos));

  const keptRepoPatterns = buildRepoKeyPatterns(plan.keptRepos);
  plan.metadataPatterns.forEach((pattern) => keptRepoPatterns.push(pattern));
  const keysToRemove = removeRepoStorageKeysExceptPatterns(keptRepoPatterns);

  // Drop IndexedDB override blobs for flushed foreign repos (async, best-effort)
  for (const repo of plan.foreignRepos) {
    const entity = repo.entity || "";
    const name = repo.repo || repo.slug || repo.name || "";
    if (entity && name) {
      void idbDeleteRepoOverrides(entity, name).catch(() => undefined);
    }
  }

  return {
    clearedRepos: plan.foreignRepos.length,
    clearedKeys: keysToRemove.length,
    keptRepos: plan.keptRepos.length,
    keptOwnRepos: plan.keptOwnRepos,
    keptForeignLocal: plan.keptForeignLocal,
    duplicateRowsCollapsed: plan.duplicateRowsCollapsed,
  };
};

/**
 * Remove only the signed-in user's own repos (and their file/issue/PR caches)
 * from this browser. Other people's cached repos stay.
 *
 * This is a *cache* flush — Nostr sync / profile-repos may refill the catalog.
 * Hide-tombstones for this owner are cleared so refill is not blocked.
 * Intentional Settings → Delete still uses tombstones; flush lifts them for a
 * clean re-sync (flush is the nuclear cache reset).
 */
export const clearOwnReposFromStorage = (
  pubkey: string
): RepoCacheFlushStats => {
  const plan = planOwnReposFlush(pubkey);
  // Lift own hide list even when the catalog is already empty (stuck after a
  // prior flush that wrote tombstones).
  clearDeletedRepoTombstonesForOwner(pubkey);
  if (!plan) return emptyFlushStats();

  localStorage.setItem("gittr_repos", JSON.stringify(plan.keptRepos));

  const ownPatterns = buildRepoKeyPatterns(plan.ownRepos);
  const keysToRemove = removeStorageKeysForPatterns(ownPatterns);

  for (const repo of plan.ownRepos) {
    const entity = repo.entity || "";
    const name = repo.repo || repo.slug || repo.name || "";
    if (entity && name) {
      void idbDeleteRepoOverrides(entity, name).catch(() => undefined);
    }
  }

  return {
    clearedRepos: plan.ownRepos.length,
    clearedKeys: keysToRemove.length,
    keptRepos: plan.keptRepos.length,
    keptOwnRepos: 0,
    keptForeignLocal: plan.keptRepos.length,
    duplicateRowsCollapsed: plan.duplicateRowsCollapsed,
  };
};

export const clearNonLocalReposFromStorage = (options?: {
  preserveWithMetadata?: boolean;
}): {
  clearedRepos: number;
  clearedKeys: number;
  keptRepos: number;
} => {
  if (typeof window === "undefined") {
    return { clearedRepos: 0, clearedKeys: 0, keptRepos: 0 };
  }

  const allRepos = JSON.parse(
    localStorage.getItem("gittr_repos") || "[]"
  ) as StoredRepo[];

  if (!Array.isArray(allRepos)) {
    return { clearedRepos: 0, clearedKeys: 0, keptRepos: 0 };
  }

  const preserveWithMetadata = options?.preserveWithMetadata ?? true;
  const metadataPatterns = preserveWithMetadata
    ? collectMetadataPatterns()
    : new Set<string>();

  const keptRepos = allRepos.filter((repo) => {
    if (hasLocalChanges(repo)) return true;
    if (isNostrSyncedRepo(repo)) return true;
    if (preserveWithMetadata) {
      const entity = repo.entity || repo.slug?.split("/")[0] || "";
      const repoName =
        repo.repo || repo.slug?.split("/")[1] || repo.name || repo.slug || "";
      if (entity && repoName) {
        const pattern = getRepoStorageKey(
          "gittr_test",
          entity,
          repoName
        ).replace("gittr_test__", "");
        if (metadataPatterns.has(pattern)) return true;
      }
    }
    return false;
  });
  const removedRepos = allRepos.filter((repo) => !keptRepos.includes(repo));

  localStorage.setItem("gittr_repos", JSON.stringify(keptRepos));

  const keptRepoPatterns = buildRepoKeyPatterns(keptRepos);
  metadataPatterns.forEach((pattern) => keptRepoPatterns.push(pattern));
  const keysToRemove = removeRepoStorageKeysExceptPatterns(keptRepoPatterns);

  return {
    clearedRepos: removedRepos.length,
    clearedKeys: keysToRemove.length,
    keptRepos: keptRepos.length,
  };
};

const buildRepoKeyPatterns = (repos: StoredRepo[]): string[] => {
  const patterns: string[] = [];
  repos.forEach((repo) => {
    const entity = repo.entity || repo.slug?.split("/")[0] || "";
    const repoName =
      repo.repo || repo.slug?.split("/")[1] || repo.name || repo.slug || "";
    if (entity && repoName) {
      const testKey = getRepoStorageKey("gittr_test", entity, repoName);
      const pattern = testKey.replace("gittr_test__", "");
      patterns.push(pattern);
      patterns.push(`${entity}__${repoName}`);
      patterns.push(`${entity}_${repoName}`);
    }
  });
  return patterns;
};

const repoDataKeyPrefixes = [
  "gittr_files__",
  "gittr_issues__",
  "gittr_prs__",
  "gittr_commits__",
  "gittr_releases__",
  "gittr_discussions__",
  "gittr_milestones_",
  "gittr_overrides__",
  "gittr_repo_overrides__",
  "gittr_accumulated_zaps_",
];

const isRepoDataKey = (key: string): boolean => {
  if (repoDataKeyPrefixes.some((prefix) => key.startsWith(prefix))) return true;
  return key.includes("gittr_issue_comments_");
};

const matchesRepoPattern = (key: string, pattern: string): boolean => {
  return (
    key.includes(`__${pattern}`) ||
    key.includes(`_${pattern.replace("__", "_")}`) ||
    key.includes(`/${pattern.replace("__", "/")}`)
  );
};

const collectMetadataPatterns = (): Set<string> => {
  const metadataPatterns = new Set<string>();
  const metadataPrefixes = [
    "gittr_issues__",
    "gittr_prs__",
    "gittr_commits__",
    "gittr_releases__",
    "gittr_discussions__",
    "gittr_milestones_",
  ];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key) continue;
    const prefix = metadataPrefixes.find((p) => key.startsWith(p));
    if (prefix) {
      metadataPatterns.add(key.replace(prefix, ""));
    }
    if (key.includes("gittr_issue_comments_")) {
      const stripped = key.replace("gittr_issue_comments_", "");
      metadataPatterns.add(stripped);
    }
  }
  return metadataPatterns;
};

const listRepoStorageKeysExceptPatterns = (
  allowedPatterns: string[]
): string[] => {
  const keysToRemove: string[] = [];
  const uniquePatterns = new Set(allowedPatterns.filter(Boolean));

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !isRepoDataKey(key)) continue;

    let isAllowed = false;
    for (const pattern of uniquePatterns) {
      if (matchesRepoPattern(key, pattern)) {
        isAllowed = true;
        break;
      }
    }

    if (!isAllowed) {
      keysToRemove.push(key);
    }
  }
  return keysToRemove;
};

const listStorageKeysForPatterns = (patterns: string[]): string[] => {
  const keysToRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key) continue;

    let isMatchingRepoKey = false;
    for (const pattern of patterns) {
      if (matchesRepoPattern(key, pattern) && isRepoDataKey(key)) {
        isMatchingRepoKey = true;
        break;
      }
    }

    if (isMatchingRepoKey) {
      keysToRemove.push(key);
    }
  }
  return keysToRemove;
};

const removeRepoStorageKeysExceptPatterns = (
  allowedPatterns: string[]
): string[] => {
  const keysToRemove = listRepoStorageKeysExceptPatterns(allowedPatterns);
  keysToRemove.forEach((key) => localStorage.removeItem(key));
  return keysToRemove;
};

const removeStorageKeysForPatterns = (patterns: string[]): string[] => {
  const keysToRemove = listStorageKeysForPatterns(patterns);
  keysToRemove.forEach((key) => localStorage.removeItem(key));
  return keysToRemove;
};

const isRepoFileEntry = (value: unknown): value is RepoFileEntry => {
  if (!isRecord(value)) return false;
  return typeof value.path === "string" && typeof value.type === "string";
};

const isStoredContributor = (value: unknown): value is StoredContributor => {
  if (!isRecord(value)) return false;
  return (
    (typeof value.pubkey === "undefined" || typeof value.pubkey === "string") &&
    (typeof value.name === "undefined" || typeof value.name === "string") &&
    (typeof value.picture === "undefined" ||
      typeof value.picture === "string") &&
    (typeof value.weight === "undefined" || typeof value.weight === "number") &&
    (typeof value.githubLogin === "undefined" ||
      typeof value.githubLogin === "string") &&
    (typeof value.role === "undefined" ||
      value.role === "owner" ||
      value.role === "maintainer" ||
      value.role === "contributor") &&
    (typeof value.login === "undefined" || typeof value.login === "string") &&
    (typeof value.avatar_url === "undefined" ||
      typeof value.avatar_url === "string") &&
    (typeof value.contributions === "undefined" ||
      typeof value.contributions === "number")
  );
};

const isStoredRepo = (value: unknown): value is StoredRepo => {
  if (!isRecord(value)) return false;
  if (typeof value.entity !== "string") return false;

  if (typeof value.files !== "undefined") {
    if (!Array.isArray(value.files) || !value.files.every(isRepoFileEntry)) {
      return false;
    }
  }

  if (typeof value.contributors !== "undefined") {
    if (
      !Array.isArray(value.contributors) ||
      !value.contributors.every(isStoredContributor)
    ) {
      return false;
    }
  }

  if (typeof value.links !== "undefined") {
    if (
      !Array.isArray(value.links) ||
      !value.links.every(
        (link) =>
          isRecord(link) &&
          typeof link.type === "string" &&
          typeof link.url === "string" &&
          (typeof link.label === "undefined" || typeof link.label === "string")
      )
    ) {
      return false;
    }
  }

  return true;
};

function ownerHexLowerForDedupe(r: StoredRepo): string {
  if (r.ownerPubkey && /^[0-9a-f]{64}$/i.test(r.ownerPubkey)) {
    return r.ownerPubkey.toLowerCase();
  }
  if (r.entity?.startsWith("npub")) {
    try {
      const d = nip19.decode(r.entity);
      if (d.type === "npub") {
        return (d.data as string).toLowerCase();
      }
    } catch {
      /* ignore */
    }
  }
  if (r.entity && /^[0-9a-f]{64}$/i.test(r.entity)) {
    return r.entity.toLowerCase();
  }
  return "";
}

function repoLabelForDedupeKey(r: StoredRepo): string {
  const label =
    (typeof r.repositoryName === "string" && r.repositoryName.trim()) ||
    (typeof r.repo === "string" && r.repo.trim()) ||
    (typeof r.name === "string" && r.name.trim()) ||
    (() => {
      if (typeof r.slug === "string" && r.slug.trim()) {
        const s = r.slug.trim();
        const i = s.lastIndexOf("/");
        return i >= 0 ? s.slice(i + 1) : s;
      }
      return "";
    })();
  return normalizeRepoSlugForMatch(label);
}

function nostrEventRecencyScore(r: StoredRepo): number {
  const sec = (r as { lastNostrEventCreatedAt?: number })
    .lastNostrEventCreatedAt;
  if (typeof sec === "number" && sec > 0) return sec;
  const ms =
    (r as { updatedAt?: number }).updatedAt ||
    (r as { lastModifiedAt?: number }).lastModifiedAt ||
    (r as { createdAt?: number }).createdAt;
  if (typeof ms === "number" && ms > 0) return Math.floor(ms / 1000);
  return 0;
}

/**
 * Merge duplicate rows that describe the same repo (owner pubkey + repo name),
 * e.g. hyphen vs underscore slug or repeated Nostr sync writes. Keeps the newest row.
 */
export function dedupeStoredReposByOwnerAndRepoLabel(
  repos: StoredRepo[]
): StoredRepo[] {
  if (!Array.isArray(repos) || repos.length < 2) return repos;
  const map = new Map<string, StoredRepo>();
  let orphanIdx = 0;
  for (const r of repos) {
    const owner = ownerHexLowerForDedupe(r);
    const slug = repoLabelForDedupeKey(r);
    const k =
      owner && slug ? `${owner}::${slug}` : `__incomplete__::${orphanIdx++}`;
    const prev = map.get(k);
    if (!prev) {
      map.set(k, r);
      continue;
    }
    const winner =
      nostrEventRecencyScore(r) >= nostrEventRecencyScore(prev) ? r : prev;
    const loser = winner === r ? prev : r;
    const mergedContributors = mergeStoredContributorLists(
      winner.contributors,
      loser.contributors
    );
    map.set(k, {
      ...winner,
      ...(mergedContributors.length > 0
        ? { contributors: mergedContributors as StoredContributor[] }
        : {}),
    });
  }
  return Array.from(map.values());
}

const parseJsonArray = <T>(
  raw: string | null,
  isValid: (value: unknown) => value is T
): T[] => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValid);
  } catch {
    return [];
  }
};

/** Keep gittr_repos small — file trees live under gittr_files__* keys. */
export function slimRepoForStorage(repo: StoredRepo): StoredRepo {
  const r = repo as StoredRepo & {
    issues?: unknown[];
    pulls?: unknown[];
    commits?: unknown[];
    readme?: string;
    releases?: unknown[];
    branches?: string[];
    tags?: string[];
    entityDisplayName?: string;
    logoUrl?: string;
    languages?: Record<string, number>;
  };
  const files = r.files;
  const slim: StoredRepo = { ...r };
  delete (slim as { files?: RepoFileEntry[] }).files;
  delete (slim as { issues?: unknown[] }).issues;
  delete (slim as { pulls?: unknown[] }).pulls;
  delete (slim as { commits?: unknown[] }).commits;
  delete (slim as { releases?: unknown[] }).releases;
  delete (slim as { branches?: string[] }).branches;
  delete (slim as { tags?: string[] }).tags;
  delete (slim as { entityDisplayName?: string }).entityDisplayName;
  delete (slim as { logoUrl?: string }).logoUrl;
  // README / About body never belongs in the explore catalog blob.
  delete (slim as { readme?: string }).readme;

  if (typeof slim.description === "string" && slim.description.length > 280) {
    slim.description = slim.description.slice(0, 280);
  }
  if (Array.isArray(slim.clone) && slim.clone.length > 4) {
    slim.clone = slim.clone.slice(0, 4);
  }
  if (Array.isArray(slim.relays) && slim.relays.length > 6) {
    slim.relays = slim.relays.slice(0, 6);
  }
  if (Array.isArray(slim.topics) && slim.topics.length > 12) {
    slim.topics = slim.topics.slice(0, 12);
  }
  if (Array.isArray(slim.links) && slim.links.length > 6) {
    slim.links = slim.links.slice(0, 6);
  }
  if (Array.isArray(slim.contributors) && slim.contributors.length > 6) {
    const owners = slim.contributors.filter(
      (c) => c.role === "owner" || c.weight === 100
    );
    const rest = slim.contributors.filter(
      (c) => !(c.role === "owner" || c.weight === 100)
    );
    slim.contributors = [...owners, ...rest].slice(0, 6);
  }
  if (r.languages && typeof r.languages === "object") {
    const entries = Object.entries(r.languages).sort((a, b) => b[1] - a[1]);
    if (entries.length > 3) {
      slim.languages = Object.fromEntries(entries.slice(0, 3));
    }
  }
  if (Array.isArray(files) && files.length > 0 && !slim.fileCount) {
    slim.fileCount = files.length;
  }
  return slim;
}

/** Ultra-compact row for discover cache when even slim rows won't fit. */
function ultraSlimRepoForCatalog(repo: StoredRepo): StoredRepo {
  const name = repo.repo || repo.slug || repo.name || "";
  const ownerOnly = Array.isArray(repo.contributors)
    ? repo.contributors
        .filter((c) => c.role === "owner" || c.weight === 100)
        .slice(0, 1)
    : undefined;
  const out: StoredRepo = {
    entity: repo.entity,
    repo: name,
    slug: repo.slug || name,
    name: repo.name || name,
    ownerPubkey: repo.ownerPubkey,
    createdAt: repo.createdAt,
    syncedFromNostr: repo.syncedFromNostr,
    fromNostr: repo.fromNostr,
    deleted: repo.deleted,
    hasUnpushedEdits: repo.hasUnpushedEdits,
    status: repo.status,
    nostrEventId: repo.nostrEventId,
    lastNostrEventId: repo.lastNostrEventId,
    lastNostrEventCreatedAt: repo.lastNostrEventCreatedAt,
    stars: repo.stars,
    forks: repo.forks,
    fileCount: repo.fileCount,
    publicRead: repo.publicRead,
    publicWrite: repo.publicWrite,
  };
  if (typeof repo.description === "string" && repo.description) {
    out.description = repo.description.slice(0, 160);
  }
  if (Array.isArray(repo.topics) && repo.topics.length) {
    out.topics = repo.topics.slice(0, 8);
  }
  if (Array.isArray(repo.clone) && repo.clone.length) {
    out.clone = repo.clone.slice(0, 2);
  }
  if (ownerOnly && ownerOnly.length) {
    out.contributors = ownerOnly.map((c) => ({
      pubkey: c.pubkey,
      role: c.role,
      weight: c.weight,
    }));
  }
  return out;
}

function slimReposForStorage(repos: StoredRepo[]): StoredRepo[] {
  return repos.map(slimRepoForStorage);
}

function rankReposForQuotaKeep(
  repos: StoredRepo[],
  preferOwnerPubkey?: string
): StoredRepo[] {
  const prefer = preferOwnerPubkey?.toLowerCase();
  return [...repos].sort((a: any, b: any) => {
    const score = (r: any) => {
      const owner = String(r.ownerPubkey || "").toLowerCase();
      const ownedBoost = prefer && owner && owner === prefer ? 1e16 : 0;
      return (
        ownedBoost +
        (r.hasUnpushedEdits || r.status === "local" ? 1e15 : 0) +
        (r.lastNostrEventCreatedAt
          ? r.lastNostrEventCreatedAt * 1000
          : r.updatedAt || r.createdAt || 0)
      );
    };
    return score(b) - score(a);
  });
}

export const loadStoredRepos = (): StoredRepo[] => {
  if (typeof window === "undefined") return [];
  const raw = parseJsonArray(localStorage.getItem("gittr_repos"), isStoredRepo);
  const deduped = dedupeStoredReposByOwnerAndRepoLabel(raw);
  const slimmed = slimReposForStorage(deduped);
  const hadEmbeddedFiles = deduped.some(
    (r) =>
      (Array.isArray(r.files) && r.files.length > 0) ||
      (Array.isArray((r as { issues?: unknown[] }).issues) &&
        (r as { issues?: unknown[] }).issues!.length > 0)
  );
  if (deduped.length < raw.length || hadEmbeddedFiles) {
    try {
      localStorage.setItem("gittr_repos", JSON.stringify(slimmed));
      if (hadEmbeddedFiles) {
        console.log(
          `🧹 [Storage] Stripped embedded file/issue lists from gittr_repos (${slimmed.length} repos)`
        );
      } else if (deduped.length < raw.length) {
        console.warn(
          `[Storage] Removed ${
            raw.length - deduped.length
          } duplicate gittr_repos rows (same owner + repo name)`
        );
      }
    } catch {
      /* quota or private mode — still return slimmed view for this read */
    }
  }
  return slimmed;
};

export const loadDeletedRepos = (): Array<{
  entity: string;
  repo: string;
  deletedAt: number;
  ownerPubkey?: string;
}> => {
  if (typeof window === "undefined") return [];
  return parseJsonArray(
    localStorage.getItem("gittr_deleted_repos"),
    (
      value
    ): value is {
      entity: string;
      repo: string;
      deletedAt: number;
      ownerPubkey?: string;
    } => {
      if (!isRecord(value)) return false;
      return (
        typeof value.entity === "string" &&
        typeof value.repo === "string" &&
        typeof value.deletedAt === "number"
      );
    }
  );
};

/** Appended to quota / localStorage alerts so users know where to trim cached repos */
export const LOCAL_STORAGE_REPOS_MANAGE_HINT =
  " Open My Repositories (/repositories) → Flush others' repos cache (or Flush my own repos cache after you've pushed).";

/**
 * Shown when Upload / New file cannot persist drafts (localStorage or IndexedDB full).
 * Flush frees space; the failed batch is not kept — user must upload again.
 */
export const ADD_FILES_STORAGE_FULL_HINT =
  "Browser storage is full. Open My Repositories → Flush others' repos cache (and/or Flush my own repos cache after you've pushed), then come back and upload/add the files again. If it still fails, try fewer or smaller files.";

/**
 * Persist slimmed `gittr_repos`. Returns false if the write still fails after
 * cleanup (caller may keep an in-memory list for Explore / My Repositories).
 */
export const saveStoredRepos = (
  repos: StoredRepo[],
  opts?: { quiet?: boolean; preferOwnerPubkey?: string }
): boolean => {
  if (typeof window === "undefined") return false;
  const quiet = opts?.quiet === true;
  const preferOwnerPubkey = opts?.preferOwnerPubkey;
  const toSave = slimReposForStorage(
    dedupeStoredReposByOwnerAndRepoLabel(repos)
  );
  if (toSave.length < repos.length) {
    console.warn(
      `[Storage] Deduped ${
        repos.length - toSave.length
      } duplicate repo row(s) before save`
    );
  }

  const tryWrite = (list: StoredRepo[]): boolean => {
    try {
      localStorage.setItem("gittr_repos", JSON.stringify(list));
      return true;
    } catch {
      return false;
    }
  };

  if (tryWrite(toSave)) return true;

  console.error(
    `❌ [Storage] Quota exceeded when saving repos. Attempting cleanup...`
  );

  // File trees / issue caches are usually the real hog — free them first.
  const evictedFirst = evictAllRepoFileCaches(250);
  if (evictedFirst > 0 && tryWrite(toSave)) {
    console.log(
      `✅ [Storage] Saved ${toSave.length} repos after evicting ${evictedFirst} cache key(s)`
    );
    return true;
  }

  const now = Date.now();
  const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;

  const cleaned30 = toSave.filter((r: any) => {
    const lastActivity =
      (r.lastNostrEventCreatedAt ? r.lastNostrEventCreatedAt * 1000 : 0) ||
      r.updatedAt ||
      r.lastModifiedAt ||
      r.createdAt ||
      0;
    return (
      lastActivity > thirtyDaysAgo || r.hasUnpushedEdits || r.status === "local"
    );
  });
  if (cleaned30.length < toSave.length) {
    console.log(
      `🧹 [Storage] Cleaned up ${
        toSave.length - cleaned30.length
      } old repos (older than 30 days)`
    );
    const cleanedDeduped = dedupeStoredReposByOwnerAndRepoLabel(cleaned30);
    if (tryWrite(cleanedDeduped)) {
      if (!quiet && typeof window !== "undefined") {
        setTimeout(() => {
          alert(
            `⚠️ localStorage is getting full. Cleaned up old repos. ${cleanedDeduped.length} repos remaining.${LOCAL_STORAGE_REPOS_MANAGE_HINT}`
          );
        }, 100);
      }
      return true;
    }

    const cleaned7 = cleaned30.filter((r: any) => {
      const lastActivity =
        (r.lastNostrEventCreatedAt ? r.lastNostrEventCreatedAt * 1000 : 0) ||
        r.updatedAt ||
        r.lastModifiedAt ||
        r.createdAt ||
        0;
      return (
        lastActivity > sevenDaysAgo ||
        r.hasUnpushedEdits ||
        r.status === "local"
      );
    });
    if (cleaned7.length < cleaned30.length) {
      const aggDeduped = dedupeStoredReposByOwnerAndRepoLabel(cleaned7);
      if (tryWrite(aggDeduped)) {
        if (!quiet && typeof window !== "undefined") {
          setTimeout(() => {
            alert(
              `⚠️ localStorage is full. Cleaned up repos older than 7 days. ${aggDeduped.length} repos remaining.${LOCAL_STORAGE_REPOS_MANAGE_HINT}`
            );
          }, 100);
        }
        return true;
      }
    }
  }

  // Sweep remaining fat caches again, then progressive caps (Explore can keep
  // the full list in memory even when we only persist a subset).
  const evicted = evictAllRepoFileCaches(500);
  if (evicted > 0 && tryWrite(toSave)) {
    console.log(
      `✅ [Storage] Saved ${toSave.length} repos after evicting ${evicted} cache key(s)`
    );
    return true;
  }

  const ranked = rankReposForQuotaKeep(toSave, preferOwnerPubkey);
  const capSizes = [2000, 1200, 800, 500, 350, 250, 150];
  for (const cap of capSizes) {
    if (cap >= ranked.length) continue;
    const capped = ranked.slice(0, cap);
    if (tryWrite(capped)) {
      console.warn(
        `⚠️ [Storage] Saved capped gittr_repos (${capped.length}/${toSave.length}) after quota reclaim`
      );
      if (!quiet && typeof window !== "undefined") {
        setTimeout(() => {
          alert(
            `⚠️ Browser storage was full — kept the ${capped.length} most recent repos locally.${LOCAL_STORAGE_REPOS_MANAGE_HINT}`
          );
        }, 100);
      }
      return true;
    }
  }

  // Last resort: ultra-slim catalog rows (drop clone/relays/langs bulk).
  const ultra = rankReposForQuotaKeep(
    toSave.map(ultraSlimRepoForCatalog),
    preferOwnerPubkey
  );
  if (tryWrite(ultra)) {
    console.warn(
      `⚠️ [Storage] Saved ultra-slim gittr_repos (${ultra.length} rows) after quota reclaim`
    );
    return true;
  }
  for (const cap of [1500, 800, 400, 200, 100]) {
    if (cap >= ultra.length) continue;
    const capped = ultra.slice(0, cap);
    if (tryWrite(capped)) {
      console.warn(
        `⚠️ [Storage] Saved ultra-slim capped gittr_repos (${capped.length}/${toSave.length})`
      );
      return true;
    }
  }

  console.error(
    `❌ [Storage] Quota exceeded; could not persist gittr_repos (${toSave.length} rows)`
  );
  if (!quiet && typeof window !== "undefined") {
    setTimeout(() => {
      alert(
        `❌ Error: localStorage is full.${LOCAL_STORAGE_REPOS_MANAGE_HINT} You can also clear this site's data in your browser settings.`
      );
    }, 100);
  }
  return false;
};

export const isGitHostContributor = (
  value: StoredContributor
): value is StoredContributor & { login: string } =>
  typeof value.login === "string";

function primaryRepoLabelFromStored(r: StoredRepo): string {
  if (typeof r.repositoryName === "string" && r.repositoryName.trim()) {
    return r.repositoryName.trim();
  }
  if (typeof r.repo === "string" && r.repo.trim()) return r.repo.trim();
  if (typeof r.name === "string" && r.name.trim()) return r.name.trim();
  if (typeof r.slug === "string" && r.slug.trim()) {
    const s = r.slug.trim();
    const i = s.lastIndexOf("/");
    return i >= 0 ? s.slice(i + 1) : s;
  }
  return "";
}

function repoHasIndexedStorage(entity: string, repo: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (loadRepoFiles(entity, repo).length > 0) return true;
    if (Object.keys(loadRepoOverrides(entity, repo)).length > 0) return true;
  } catch {
    /* ignore */
  }
  return false;
}

/**
 * URL / route `repo` may use hyphens while GitHub import or bridge used underscores (or vice versa).
 * Returns the repo string that actually has `gittr_files` / overrides keys and matches bridge DB.
 */
export function resolveRepoStorageAlias(
  entity: string,
  urlRepoSegment: string
): string {
  if (typeof window === "undefined") return urlRepoSegment;
  if (repoHasIndexedStorage(entity, urlRepoSegment)) return urlRepoSegment;

  const repos = loadStoredRepos();
  const target = normalizeRepoSlugForMatch(urlRepoSegment);
  const ne = normalizeEntityForStorage(entity);
  let fallback: string | null = null;

  for (const r of repos) {
    const rName = primaryRepoLabelFromStored(r);
    if (!rName || normalizeRepoSlugForMatch(rName) !== target) continue;
    const re = normalizeEntityForStorage(r.entity || "");
    if (re !== ne) continue;
    if (repoHasIndexedStorage(entity, rName)) return rName;
    if (!fallback) fallback = rName;
  }
  return fallback ?? urlRepoSegment;
}

// File storage helpers (for optimized storage when files are large)
export const loadRepoFiles = (
  entity: string,
  repo: string
): RepoFileEntry[] => {
  if (typeof window === "undefined") return [];
  try {
    const filesKey = getRepoStorageKey("gittr_files", entity, repo);
    const stored = localStorage.getItem(filesKey);
    if (!stored) return [];
    return parseJsonArray(stored, isRepoFileEntry);
  } catch {
    return [];
  }
};

/** @deprecated import from merge-repo-file-indexes — re-exported for callers */
export { mergeRepoFileIndexes } from "./merge-repo-file-indexes";

function evictLargestOtherRepoFileKeys(
  keepKey: string,
  maxRemovals: number
): number {
  const entries: { key: string; len: number }[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith("gittr_files__") || key === keepKey) continue;
    const raw = localStorage.getItem(key);
    entries.push({ key, len: raw ? raw.length : 0 });
  }
  entries.sort((a, b) => b.len - a.len);
  let removed = 0;
  for (const { key } of entries) {
    if (removed >= maxRemovals) break;
    try {
      localStorage.removeItem(key);
      removed++;
    } catch {
      /* ignore */
    }
  }
  if (removed > 0) {
    console.log(
      `🧹 [Storage] Evicted ${removed} other gittr_files key(s) (largest first) to free quota`
    );
  }
  return removed;
}

function evictAllRepoFileCaches(maxRemovals = 200): number {
  return evictLargestOtherRepoFileKeys("", maxRemovals);
}

export const saveRepoFiles = (
  entity: string,
  repo: string,
  files: RepoFileEntry[]
): boolean => {
  if (typeof window === "undefined") return false;
  const filesKey = getRepoStorageKey("gittr_files", entity, repo);
  const payload = JSON.stringify(files);
  try {
    localStorage.setItem(filesKey, payload);
    return true;
  } catch (error: any) {
    if (
      error.name === "QuotaExceededError" ||
      error.message?.includes("quota")
    ) {
      console.error(
        `❌ [Storage] Quota exceeded when saving files for ${entity}/${repo}. Attempting cleanup...`
      );

      try {
        const now = Date.now();
        const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
        let cleanedCount = 0;

        const allKeys: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && key.startsWith("gittr_files__")) {
            allKeys.push(key);
          }
        }

        const repos = loadStoredRepos();
        const repoMap = new Map<string, number>();
        repos.forEach((r: any) => {
          const key = getRepoStorageKey(
            "gittr_files",
            r.entity,
            r.repo || r.slug || r.name
          );
          const lastActivity =
            r.updatedAt || r.lastModifiedAt || r.createdAt || 0;
          repoMap.set(key, lastActivity);
        });

        for (const key of allKeys) {
          const lastActivity = repoMap.get(key) || 0;
          if (lastActivity < thirtyDaysAgo) {
            try {
              localStorage.removeItem(key);
              cleanedCount++;
            } catch (e) {
              /* ignore */
            }
          }
        }

        if (cleanedCount > 0) {
          console.log(
            `🧹 [Storage] Cleaned up ${cleanedCount} old file storage keys`
          );
          try {
            localStorage.setItem(filesKey, payload);
            console.log(`✅ [Storage] Successfully saved files after cleanup`);
            return true;
          } catch {
            /* fall through to size-based eviction */
          }
        }

        let evicted = 0;
        for (let round = 0; round < 8; round++) {
          try {
            localStorage.setItem(filesKey, payload);
            if (evicted > 0) {
              console.log(
                `✅ [Storage] Saved files after evicting ${evicted} other file-tree key(s)`
              );
            }
            return true;
          } catch {
            const n = evictLargestOtherRepoFileKeys(filesKey, 12);
            if (n === 0) break;
            evicted += n;
          }
        }

        console.error(
          `❌ [Storage] Quota still exceeded after cleanup (evicted ${evicted} keys by size)`
        );
        return false;
      } catch (cleanupError) {
        console.error(`❌ [Storage] Cleanup failed:`, cleanupError);
        return false;
      }
    } else {
      console.error("❌ [Storage] Failed to save repo files:", error);
      return false;
    }
  }
};

// Overrides storage (file content overrides)
export const loadRepoOverrides = (
  entity: string,
  repo: string
): Record<string, string> => {
  if (typeof window === "undefined") return {};
  try {
    const keyBase = `${entity}__${repo}`;
    const overrideKey = getRepoStorageKey("gittr_overrides", entity, repo);
    const legacyKey = `gittr_repo_overrides__${keyBase}`;
    const stored =
      localStorage.getItem(overrideKey) || localStorage.getItem(legacyKey);
    if (!stored) return {};
    const parsed = JSON.parse(stored);
    if (isRecord(parsed)) {
      const result: Record<string, string> = {};
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value === "string") {
          result[key] = value;
        }
      }
      return result;
    }
    return {};
  } catch {
    return {};
  }
};

export const saveRepoOverrides = (
  entity: string,
  repo: string,
  overrides: Record<string, string>
): boolean => {
  if (typeof window === "undefined") return false;
  const overrideKey = getRepoStorageKey("gittr_overrides", entity, repo);
  try {
    // Empty map → drop key (free quota) instead of storing "{}"
    if (!overrides || Object.keys(overrides).length === 0) {
      localStorage.removeItem(overrideKey);
      try {
        localStorage.removeItem(`gittr_repo_overrides__${entity}__${repo}`);
      } catch {
        /* ignore */
      }
      return true;
    }
    localStorage.setItem(overrideKey, JSON.stringify(overrides));
    return true;
  } catch (error: any) {
    const isQuota =
      error?.name === "QuotaExceededError" ||
      String(error?.message || "").includes("quota");
    if (!isQuota) {
      console.error("Failed to save repo overrides:", error);
      return false;
    }
    console.error(
      `[Storage] Quota exceeded saving overrides for ${entity}/${repo}. Evicting other override caches…`
    );
    try {
      // Drop orphan / other-repo override blobs (largest first)
      const entries: Array<{ key: string; len: number }> = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (
          !key ||
          !(
            key.startsWith("gittr_overrides__") ||
            key.startsWith("gittr_repo_overrides__")
          )
        ) {
          continue;
        }
        if (key === overrideKey) continue;
        const raw = localStorage.getItem(key) || "";
        entries.push({ key, len: raw.length });
      }
      entries.sort((a, b) => b.len - a.len);
      let evicted = 0;
      for (const { key } of entries) {
        if (evicted >= 40) break;
        try {
          localStorage.removeItem(key);
          evicted += 1;
        } catch {
          /* ignore */
        }
      }
      // Also free old file trees if still needed
      if (evicted < 8) {
        evictLargestOtherRepoFileKeys("", 24);
      }
      if (Object.keys(overrides).length === 0) {
        localStorage.removeItem(overrideKey);
        return true;
      }
      localStorage.setItem(overrideKey, JSON.stringify(overrides));
      console.log(
        `✅ [Storage] Saved overrides after evicting ${evicted} other override key(s)`
      );
      return true;
    } catch (retryErr) {
      console.error("Failed to save repo overrides after eviction:", retryErr);
      return false;
    }
  }
};

// Deleted paths storage
export const loadRepoDeletedPaths = (
  entity: string,
  repo: string
): string[] => {
  if (typeof window === "undefined") return [];
  try {
    const { getRepoStorageKey } = require("@/lib/utils/entity-normalizer");
    const keyBase = `${entity}__${repo}`;
    const deletedKey = `gittr_repo_deleted__${keyBase}`;
    const stored = localStorage.getItem(deletedKey);
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    if (
      Array.isArray(parsed) &&
      parsed.every((item) => typeof item === "string")
    ) {
      return parsed;
    }
    return [];
  } catch {
    return [];
  }
};

export const saveRepoDeletedPaths = (
  entity: string,
  repo: string,
  deletedPaths: string[]
): void => {
  if (typeof window === "undefined") return;
  try {
    const keyBase = `${entity}__${repo}`;
    const deletedKey = `gittr_repo_deleted__${keyBase}`;
    localStorage.setItem(deletedKey, JSON.stringify(deletedPaths));
  } catch (error) {
    console.error("Failed to save repo deleted paths:", error);
  }
};

/**
 * Normalize file path - remove leading/trailing slashes, handle root files
 */
export function normalizeFilePath(path: string): string {
  if (!path || typeof path !== "string") return "";
  // Remove leading and trailing slashes
  const normalized = path.trim().replace(/^\/+|\/+$/g, "");
  // If path is empty after normalization, it was just "/" - return empty (invalid)
  if (!normalized) return "";
  return normalized;
}

export {
  appendRepoDeletedPath,
  isRepoPathDeleted,
  reconcileDeletedPathsAfterAdd,
} from "./deleted-paths";

/**
 * Detect if a file is binary based on extension
 */
export function isBinaryFile(path: string, mimeType?: string): boolean {
  const ext = path.split(".").pop()?.toLowerCase() || "";
  const textExts = [
    "txt",
    "md",
    "json",
    "js",
    "ts",
    "jsx",
    "tsx",
    "css",
    "html",
    "htm",
    "xml",
    "yml",
    "yaml",
    "toml",
    "ini",
    "conf",
    "log",
    "csv",
    "tsv",
    "sh",
    "bash",
    "zsh",
    "fish",
    "py",
    "rb",
    "go",
    "rs",
    "java",
    "c",
    "cpp",
    "h",
    "hpp",
    "sql",
    "r",
    "m",
    "swift",
    "kt",
    "scala",
    "clj",
    "hs",
    "elm",
    "ex",
    "exs",
    "erl",
    "hrl",
    "ml",
    "mli",
    "fs",
    "fsx",
    "vb",
    "cs",
    "dart",
    "lua",
    "vim",
    "vimrc",
    "gitignore",
    "gitattributes",
    "dockerfile",
    "makefile",
    "cmake",
    "gradle",
    "maven",
    "pom",
    "sbt",
    "build",
    "rakefile",
    "gemfile",
    "podfile",
    "cartfile",
  ];
  const binaryExts = [
    "png",
    "jpg",
    "jpeg",
    "gif",
    "webp",
    "svg",
    "ico",
    "pdf",
    "woff",
    "woff2",
    "ttf",
    "otf",
    "eot",
    "mp4",
    "mp3",
    "wav",
    "avi",
    "mov",
    "zip",
    "tar",
    "gz",
    "bz2",
    "xz",
    "7z",
    "rar",
    "exe",
    "dll",
    "so",
    "dylib",
    "bin",
  ];

  // Check MIME type first (more reliable) — but generic octet-stream must
  // not override a known text extension (folder uploads often omit File.type).
  if (mimeType) {
    const isGenericBinary =
      mimeType === "application/octet-stream" || mimeType === "file";
    if (
      !isGenericBinary &&
      (mimeType.startsWith("image/") ||
        mimeType.startsWith("video/") ||
        mimeType.startsWith("audio/") ||
        mimeType === "application/pdf" ||
        mimeType.startsWith("font/"))
    ) {
      return true;
    }
    if (
      mimeType.startsWith("text/") ||
      mimeType === "application/json" ||
      mimeType === "application/xml"
    ) {
      return false;
    }
  }

  // Check by extension
  if (binaryExts.includes(ext)) return true;
  if (textExts.includes(ext)) return false;

  // Default: assume text for unknown extensions
  return false;
}

/**
 * Load overrides and expand IndexedDB markers to real content (for Push / async UI).
 */
export async function loadRepoOverridesResolved(
  entity: string,
  repo: string
): Promise<Record<string, string>> {
  const raw = loadRepoOverrides(entity, repo);
  return resolveOverridesMap(entity, repo, raw);
}

/**
 * Add files directly to repository (for owners, local repos, or immediate display)
 * Binary / large bodies go to IndexedDB; localStorage only keeps pointers + small text.
 */
export async function addFilesToRepo(
  entity: string,
  repo: string,
  files: Array<{
    path: string;
    content?: string;
    type?: string;
    isBinary?: boolean;
  }>,
  authorPubkey?: string
): Promise<boolean> {
  if (typeof window === "undefined") return false;

  try {
    const repos = loadStoredRepos();
    const repoData = findRepoByEntityAndName<StoredRepo>(repos, entity, repo);

    if (!repoData) {
      console.error("Repository not found:", entity, repo);
      return false;
    }

    const repoIndex = repos.indexOf(repoData);
    if (repoIndex === -1) {
      console.error("Repository found but index not found:", entity, repo);
      return false;
    }

    // Normalize and validate file paths
    const validFiles = files
      .map((f) => ({
        ...f,
        path: normalizeFilePath(f.path),
      }))
      .filter((f) => f.path && f.path.length > 0); // Remove invalid paths

    if (validFiles.length === 0) {
      console.error("No valid file paths after normalization");
      return false;
    }

    // Get existing files (check both repo.files and separate storage)
    let existingFiles: RepoFileEntry[] = [];
    if (repoData.files && Array.isArray(repoData.files)) {
      existingFiles = [...repoData.files];
    } else {
      // Try separate files storage
      existingFiles = loadRepoFiles(entity, repo);
    }

    // Create a map of existing files by path
    const existingFileMap = new Map<string, RepoFileEntry>();
    existingFiles.forEach((f) => {
      if (f.path) {
        existingFileMap.set(f.path, f);
      }
    });

    // Paths in this batch — nested docs/README.md must not erase root README.md
    // that was uploaded in the same folder pick.
    const pathsInThisUpload = new Set(validFiles.map((f) => f.path));

    // Add or update files
    validFiles.forEach((file) => {
      const normalizedPath = file.path;
      const isBinary =
        file.isBinary !== undefined
          ? file.isBinary
          : isBinaryFile(normalizedPath, file.type);
      const existing = existingFileMap.get(normalizedPath);
      const fileEntry: RepoFileEntry = {
        // Keep existing properties (size, sha, url) if present
        ...(existing || {}),
        // Override with new/updated values
        path: normalizedPath, // Ensure path is normalized
        type: file.type || existing?.type || "file",
        isBinary: isBinary, // Always use the new isBinary value
      };
      existingFileMap.set(normalizedPath, fileEntry);

      // Nested upload wins over a *stale* flat basename from an earlier pick —
      // but never drop a flat path that is also in this same upload batch.
      if (normalizedPath.includes("/")) {
        const base = normalizedPath.split("/").pop() || "";
        if (
          base &&
          shouldDropFlatBasenameForNestedUpload(
            normalizedPath,
            base,
            pathsInThisUpload
          ) &&
          existingFileMap.has(base)
        ) {
          existingFileMap.delete(base);
        }
      }
    });

    // Convert back to array
    const updatedFiles = Array.from(existingFileMap.values());

    // CRITICAL: Store files separately to avoid localStorage quota issues
    // Only store fileCount in repo object, not full files array
    saveRepoFiles(entity, repo, updatedFiles);

    // Update repo object - only store fileCount, not full files array
    repoData.fileCount = updatedFiles.length;
    // Remove files array if it exists (to save space)
    if (repoData.files) {
      delete repoData.files;
    }
    repos[repoIndex] = repoData;
    saveStoredRepos(repos);

    // Store file content: small text in localStorage; binaries/large → IndexedDB
    const TEXT_INLINE_MAX = 8_000;
    const overrides = loadRepoOverrides(entity, repo);
    for (const file of validFiles) {
      if (file.content === undefined) continue;
      const isBinary =
        file.isBinary !== undefined
          ? file.isBinary
          : isBinaryFile(file.path, file.type);
      const useIdb =
        isBinary ||
        file.content.length > TEXT_INLINE_MAX ||
        isOverrideIdbMarker(overrides[file.path]);

      if (useIdb) {
        const mime = mimeForOverrideStorage(file.path, file.type, isBinary);
        try {
          await idbPutOverride({
            entity,
            repo,
            path: file.path,
            content: file.content,
            mime,
          });
          overrides[file.path] = overrideIdbMarker(mime);
        } catch (idbErr) {
          console.error(
            `[addFilesToRepo] IndexedDB put failed for ${file.path}:`,
            idbErr
          );
          return false;
        }
      } else {
        rememberOverrideBlob(entity, repo, file.path, file.content);
        overrides[file.path] = file.content;
      }

      if (file.path.includes("/")) {
        const base = file.path.split("/").pop() || "";
        if (
          base &&
          shouldDropFlatBasenameForNestedUpload(
            file.path,
            base,
            pathsInThisUpload
          ) &&
          overrides[base] !== undefined
        ) {
          delete overrides[base];
          forgetOverrideBlob(entity, repo, base);
        }
      }
    }
    const overridesSaved = saveRepoOverrides(entity, repo, overrides);
    if (!overridesSaved) {
      console.error(
        "[addFilesToRepo] Failed to persist override pointers (browser storage full?)"
      );
      return false;
    }

    // CRITICAL: Remove files from deletedPaths when they're re-added
    // Also clears folder tombstones that would hide re-uploaded children, while
    // expanding known siblings so the rest of a deleted folder stays hidden.
    const deletedPaths = loadRepoDeletedPaths(entity, repo);
    if (deletedPaths.length > 0) {
      const knownPaths = [
        ...Array.from(existingFileMap.keys()),
        ...validFiles.map((f) => f.path),
        ...Object.keys(overrides),
      ];
      const updatedDeletedPaths = reconcileDeletedPathsAfterAdd(
        deletedPaths,
        validFiles.map((f) => f.path),
        knownPaths
      );
      if (
        updatedDeletedPaths.length !== deletedPaths.length ||
        updatedDeletedPaths.some((p, i) => p !== deletedPaths[i])
      ) {
        saveRepoDeletedPaths(entity, repo, updatedDeletedPaths);
        console.log(
          `✅ [addFilesToRepo] Reconciled deletedPaths after re-add (${deletedPaths.length} → ${updatedDeletedPaths.length})`
        );
      }
    }

    // CRITICAL: Mark repo as edited so "Push to Nostr" button appears
    markRepoAsEdited(repo, entity);
    console.log(
      `📝 [addFilesToRepo] Marked repo as having unpushed edits after adding ${validFiles.length} file(s)`
    );

    // Create a commit with auto-generated commit message
    if (authorPubkey && validFiles.length > 0) {
      try {
        const commitId = `commit-${Date.now()}-${Math.random()
          .toString(36)
          .substr(2, 9)}`;

        // Auto-generate commit message based on filenames
        let commitMessage: string;
        if (validFiles.length === 1 && validFiles[0]) {
          const fileName =
            validFiles[0].path.split("/").pop() || validFiles[0].path;
          commitMessage = `Add ${fileName}`;
        } else if (validFiles.length <= 3) {
          const fileNames = validFiles
            .map((f) => f?.path?.split("/").pop() || f?.path || "file")
            .join(", ");
          commitMessage = `Add ${fileNames}`;
        } else {
          const fileCount = validFiles.length;
          const firstFile =
            validFiles[0]?.path?.split("/").pop() ||
            validFiles[0]?.path ||
            "file";
          commitMessage = `Add ${firstFile} and ${fileCount - 1} more file${
            fileCount - 1 > 1 ? "s" : ""
          }`;
        }

        // Determine which files were added vs modified
        const addedFiles = validFiles.filter(
          (f) => !existingFileMap.has(f.path)
        );
        const modifiedFiles = validFiles.filter((f) =>
          existingFileMap.has(f.path)
        );

        const commit: any = {
          id: commitId,
          message: commitMessage,
          author: authorPubkey,
          timestamp: Date.now(),
          branch: repoData.defaultBranch || "main",
          filesChanged: validFiles.length,
          insertions: validFiles.length, // Approximate - we don't count lines here
          deletions: 0,
          changedFiles: validFiles.map((f) => ({
            path: f.path,
            status: addedFiles.includes(f) ? "added" : "modified",
          })),
        };

        const commitsKey = getRepoStorageKey("gittr_commits", entity, repo);
        const commits = JSON.parse(localStorage.getItem(commitsKey) || "[]");
        commits.unshift(commit);
        localStorage.setItem(commitsKey, JSON.stringify(commits));

        console.log(`✅ [addFilesToRepo] Created commit: ${commitMessage}`);

        // Dispatch event to refresh commits page
        window.dispatchEvent(
          new CustomEvent("gittr:commit-created", { detail: commit })
        );
      } catch (error) {
        console.error("Failed to create commit:", error);
        // Don't fail the file addition if commit creation fails
      }
    }

    // Trigger event to refresh repo page
    window.dispatchEvent(new Event("gittr:repo-updated"));

    return true;
  } catch (error) {
    console.error("Failed to add files to repo:", error);
    return false;
  }
}
