import { getRepoStorageKey } from "@/lib/utils/entity-normalizer";

type JsonRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null;

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
  files?: RepoFileEntry[];
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
  deleted?: boolean;
  hasUnpushedEdits?: boolean;
  status?: string;
  syncedFromNostr?: boolean;
}

const isRepoFileEntry = (value: unknown): value is RepoFileEntry => {
  if (!isRecord(value)) return false;
  return typeof value.path === "string" && typeof value.type === "string";
};

const isStoredContributor = (value: unknown): value is StoredContributor => {
  if (!isRecord(value)) return false;
  return (
    (typeof value.pubkey === "undefined" || typeof value.pubkey === "string") &&
    (typeof value.name === "undefined" || typeof value.name === "string") &&
    (typeof value.picture === "undefined" || typeof value.picture === "string") &&
    (typeof value.weight === "undefined" || typeof value.weight === "number") &&
    (typeof value.githubLogin === "undefined" || typeof value.githubLogin === "string") &&
    (typeof value.role === "undefined" ||
      value.role === "owner" ||
      value.role === "maintainer" ||
      value.role === "contributor") &&
    (typeof value.login === "undefined" || typeof value.login === "string") &&
    (typeof value.avatar_url === "undefined" || typeof value.avatar_url === "string") &&
    (typeof value.contributions === "undefined" || typeof value.contributions === "number")
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
    if (!Array.isArray(value.contributors) || !value.contributors.every(isStoredContributor)) {
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
  return parseJsonArray(localStorage.getItem("gittr_deleted_repos"), (value): value is {
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
  });
};

export const saveStoredRepos = (repos: StoredRepo[]): void => {
  if (typeof window === "undefined") return;
  localStorage.setItem("gittr_repos", JSON.stringify(repos));
};

export const isGitHostContributor = (
  value: StoredContributor
): value is StoredContributor & { login: string } => typeof value.login === "string";

// File storage helpers (for optimized storage when files are large)
export const loadRepoFiles = (entity: string, repo: string): RepoFileEntry[] => {
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

export const saveRepoFiles = (entity: string, repo: string, files: RepoFileEntry[]): void => {
  if (typeof window === "undefined") return;
  try {
    const filesKey = getRepoStorageKey("gittr_files", entity, repo);
    localStorage.setItem(filesKey, JSON.stringify(files));
  } catch (error) {
    console.error("Failed to save repo files:", error);
  }
};

// Overrides storage (file content overrides)
export const loadRepoOverrides = (entity: string, repo: string): Record<string, string> => {
  if (typeof window === "undefined") return {};
  try {
    const keyBase = `${entity}__${repo}`;
    const overrideKey = getRepoStorageKey("gittr_overrides", entity, repo);
    const legacyKey = `gittr_repo_overrides__${keyBase}`;
    const stored = localStorage.getItem(overrideKey) || localStorage.getItem(legacyKey);
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

export const saveRepoOverrides = (entity: string, repo: string, overrides: Record<string, string>): void => {
  if (typeof window === "undefined") return;
  try {
    const overrideKey = getRepoStorageKey("gittr_overrides", entity, repo);
    localStorage.setItem(overrideKey, JSON.stringify(overrides));
  } catch (error) {
    console.error("Failed to save repo overrides:", error);
  }
};

// Deleted paths storage
export const loadRepoDeletedPaths = (entity: string, repo: string): string[] => {
  if (typeof window === "undefined") return [];
  try {
    const { getRepoStorageKey } = require("@/lib/utils/entity-normalizer");
    const keyBase = `${entity}__${repo}`;
    const deletedKey = `gittr_repo_deleted__${keyBase}`;
    const stored = localStorage.getItem(deletedKey);
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) {
      return parsed;
    }
    return [];
  } catch {
    return [];
  }
};

export const saveRepoDeletedPaths = (entity: string, repo: string, deletedPaths: string[]): void => {
  if (typeof window === "undefined") return;
  try {
    const keyBase = `${entity}__${repo}`;
    const deletedKey = `gittr_repo_deleted__${keyBase}`;
    localStorage.setItem(deletedKey, JSON.stringify(deletedPaths));
  } catch (error) {
    console.error("Failed to save repo deleted paths:", error);
  }
};

