import { getRepoStorageKey } from "@/lib/utils/entity-normalizer";
import { getRepoOwnerPubkey } from "@/lib/utils/entity-resolver";
import { findRepoByEntityAndName } from "@/lib/utils/repo-finder";
import { markRepoAsEdited } from "@/lib/utils/repo-status";

import { nip19 } from "nostr-tools";

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
  branches?: string[];
  tags?: string[];
  lastNostrEventId?: string;
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

export const clearForeignReposFromStorage = (
  pubkey: string,
  options?: { preserveUnpushedEdits?: boolean; preserveWithMetadata?: boolean }
): {
  clearedRepos: number;
  clearedKeys: number;
  keptRepos: number;
} => {
  if (typeof window === "undefined" || !pubkey) {
    return { clearedRepos: 0, clearedKeys: 0, keptRepos: 0 };
  }

  const preserveUnpushedEdits = options?.preserveUnpushedEdits ?? true;
  const preserveWithMetadata = options?.preserveWithMetadata ?? false;
  const allRepos = JSON.parse(
    localStorage.getItem("gittr_repos") || "[]"
  ) as StoredRepo[];

  if (!Array.isArray(allRepos)) {
    return { clearedRepos: 0, clearedKeys: 0, keptRepos: 0 };
  }

  const metadataPatterns = preserveWithMetadata
    ? collectMetadataPatterns()
    : new Set<string>();

  const keptRepos = allRepos.filter((repo) => {
    if (isRepoOwnedByPubkey(repo, pubkey)) return true;
    if (preserveUnpushedEdits && hasLocalChanges(repo)) return true;
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

  const foreignRepos = allRepos.filter((repo) => !keptRepos.includes(repo));

  localStorage.setItem("gittr_repos", JSON.stringify(keptRepos));

  const keptRepoPatterns = buildRepoKeyPatterns(keptRepos);
  metadataPatterns.forEach((pattern) => keptRepoPatterns.push(pattern));
  const keysToRemove = removeRepoStorageKeysExceptPatterns(keptRepoPatterns);

  return {
    clearedRepos: foreignRepos.length,
    clearedKeys: keysToRemove.length,
    keptRepos: keptRepos.length,
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

const removeRepoStorageKeysExceptPatterns = (
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

  keysToRemove.forEach((key) => localStorage.removeItem(key));
  return keysToRemove;
};

const removeStorageKeysForPatterns = (patterns: string[]): string[] => {
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

export const loadStoredRepos = (): StoredRepo[] => {
  if (typeof window === "undefined") return [];
  return parseJsonArray(localStorage.getItem("gittr_repos"), isStoredRepo);
};

export const loadDeletedRepos = (): Array<{
  entity: string;
  repo: string;
  deletedAt: number;
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

export const saveStoredRepos = (repos: StoredRepo[]): void => {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem("gittr_repos", JSON.stringify(repos));
  } catch (error: any) {
    if (
      error.name === "QuotaExceededError" ||
      error.message?.includes("quota")
    ) {
      console.error(
        `❌ [Storage] Quota exceeded when saving repos. Attempting cleanup...`
      );

      // Try to clean up old repos (older than 30 days)
      try {
        const now = Date.now();
        const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;

        // Filter out old repos
        const cleaned = repos.filter((r: any) => {
          const lastActivity =
            r.updatedAt || r.lastModifiedAt || r.createdAt || 0;
          return lastActivity > thirtyDaysAgo;
        });

        if (cleaned.length < repos.length) {
          console.log(
            `🧹 [Storage] Cleaned up ${
              repos.length - cleaned.length
            } old repos (older than 30 days)`
          );
          // Try saving cleaned repos
          try {
            localStorage.setItem("gittr_repos", JSON.stringify(cleaned));
            console.log(
              `✅ [Storage] Successfully saved ${cleaned.length} repos after cleanup`
            );
            // Show user-friendly message
            if (typeof window !== "undefined") {
              setTimeout(() => {
                alert(
                  `⚠️ localStorage is getting full. Cleaned up old repos. ${cleaned.length} repos remaining.`
                );
              }, 100);
            }
            return;
          } catch (e2: any) {
            console.error(
              `❌ [Storage] Still quota exceeded after cleanup:`,
              e2
            );
            // Try even more aggressive cleanup - remove repos older than 7 days
            const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
            const aggressiveCleanup = cleaned.filter((r: any) => {
              const lastActivity =
                r.updatedAt || r.lastModifiedAt || r.createdAt || 0;
              return lastActivity > sevenDaysAgo;
            });

            if (aggressiveCleanup.length < cleaned.length) {
              try {
                localStorage.setItem(
                  "gittr_repos",
                  JSON.stringify(aggressiveCleanup)
                );
                console.log(
                  `✅ [Storage] Aggressive cleanup: ${aggressiveCleanup.length} repos remaining`
                );
                if (typeof window !== "undefined") {
                  setTimeout(() => {
                    alert(
                      `⚠️ localStorage is full. Cleaned up repos older than 7 days. ${aggressiveCleanup.length} repos remaining.`
                    );
                  }, 100);
                }
                return;
              } catch (e3: any) {
                console.error(
                  `❌ [Storage] Still quota exceeded after aggressive cleanup:`,
                  e3
                );
                if (typeof window !== "undefined") {
                  setTimeout(() => {
                    alert(
                      `❌ Error: localStorage is full. Please clear browser data or remove some repos manually.`
                    );
                  }, 100);
                }
                return;
              }
            } else {
              return;
            }
          }
        } else {
          // No old repos to clean up, but still quota exceeded
          console.error(
            `❌ [Storage] Quota exceeded but no old repos to clean up`
          );
          if (typeof window !== "undefined") {
            setTimeout(() => {
              alert(
                `❌ Error: localStorage is full. Please clear browser data or remove some repos manually.`
              );
            }, 100);
          }
          return;
        }
      } catch (cleanupError) {
        console.error(`❌ [Storage] Cleanup failed:`, cleanupError);
        return;
      }
    } else {
      console.error("❌ [Storage] Failed to save repos:", error);
      return;
    }
  }
};

export const isGitHostContributor = (
  value: StoredContributor
): value is StoredContributor & { login: string } =>
  typeof value.login === "string";

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

export const saveRepoFiles = (
  entity: string,
  repo: string,
  files: RepoFileEntry[]
): void => {
  if (typeof window === "undefined") return;
  const filesKey = getRepoStorageKey("gittr_files", entity, repo);
  try {
    localStorage.setItem(filesKey, JSON.stringify(files));
  } catch (error: any) {
    if (
      error.name === "QuotaExceededError" ||
      error.message?.includes("quota")
    ) {
      console.error(
        `❌ [Storage] Quota exceeded when saving files for ${entity}/${repo}. Attempting cleanup...`
      );

      // Try to clean up old file storage keys (older than 30 days)
      try {
        const now = Date.now();
        const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
        let cleanedCount = 0;

        // Find all gittr_files keys
        const allKeys: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && key.startsWith("gittr_files__")) {
            allKeys.push(key);
          }
        }

        // Try to get last modified time from repos (if available)
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

        // Remove old file storage keys
        for (const key of allKeys) {
          const lastActivity = repoMap.get(key) || 0;
          if (lastActivity < thirtyDaysAgo) {
            try {
              localStorage.removeItem(key);
              cleanedCount++;
            } catch (e) {
              // Ignore errors during cleanup
            }
          }
        }

        if (cleanedCount > 0) {
          console.log(
            `🧹 [Storage] Cleaned up ${cleanedCount} old file storage keys`
          );
          // Retry saving
          try {
            localStorage.setItem(filesKey, JSON.stringify(files));
            console.log(`✅ [Storage] Successfully saved files after cleanup`);
            return;
          } catch (e2: any) {
            console.error(
              `❌ [Storage] Still quota exceeded after cleanup:`,
              e2
            );
            return;
          }
        } else {
          console.error(
            `❌ [Storage] No old files to clean up - quota still exceeded`
          );
          return;
        }
      } catch (cleanupError) {
        console.error(`❌ [Storage] Cleanup failed:`, cleanupError);
        return;
      }
    } else {
      console.error("❌ [Storage] Failed to save repo files:", error);
      return;
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
): void => {
  if (typeof window === "undefined") return;
  try {
    const overrideKey = getRepoStorageKey("gittr_overrides", entity, repo);
    localStorage.setItem(overrideKey, JSON.stringify(overrides));
  } catch (error) {
    console.error("Failed to save repo overrides:", error);
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
  let normalized = path.trim().replace(/^\/+|\/+$/g, "");
  // If path is empty after normalization, it was just "/" - return empty (invalid)
  if (!normalized) return "";
  return normalized;
}

/**
 * Detect if a file is binary based on extension
 */
function isBinaryFile(path: string, mimeType?: string): boolean {
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

  // Check MIME type first (more reliable)
  if (mimeType) {
    if (
      mimeType.startsWith("image/") ||
      mimeType.startsWith("video/") ||
      mimeType.startsWith("audio/") ||
      mimeType === "application/pdf" ||
      mimeType.startsWith("font/") ||
      mimeType === "application/octet-stream"
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
 * Add files directly to repository (for owners, local repos, or immediate display)
 * This adds files to both repo.files array and separate files storage
 * Also creates a commit with auto-generated commit message
 */
export function addFilesToRepo(
  entity: string,
  repo: string,
  files: Array<{
    path: string;
    content?: string;
    type?: string;
    isBinary?: boolean;
  }>,
  authorPubkey?: string
): boolean {
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

    // Store file content in overrides (so it can be displayed)
    const overrides = loadRepoOverrides(entity, repo);
    validFiles.forEach((file) => {
      if (file.content !== undefined) {
        overrides[file.path] = file.content;
      }
    });
    saveRepoOverrides(entity, repo, overrides);

    // CRITICAL: Remove files from deletedPaths when they're re-added
    // This fixes the issue where uploading a file with the same name as a previously deleted file
    // causes it to be filtered out
    const deletedPaths = loadRepoDeletedPaths(entity, repo);
    if (deletedPaths.length > 0) {
      const updatedDeletedPaths = deletedPaths.filter(
        (path) => !validFiles.some((file) => file.path === path)
      );
      if (updatedDeletedPaths.length !== deletedPaths.length) {
        saveRepoDeletedPaths(entity, repo, updatedDeletedPaths);
        console.log(
          `✅ [addFilesToRepo] Removed ${
            deletedPaths.length - updatedDeletedPaths.length
          } file(s) from deletedPaths (re-added)`
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
