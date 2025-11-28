import { getRepoStorageKey } from "@/lib/utils/entity-normalizer";
import { findRepoByEntityAndName } from "@/lib/utils/repo-finder";
import { markRepoAsEdited } from "@/lib/utils/repo-status";

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

type RepoFileContentFields = {
  content?: string;
  data?: string;
  body?: string;
  text?: string;
  fileContent?: string;
  file_content?: string;
};

export interface RepoFileEntry extends RepoFileContentFields {
  path: string;
  type: string;
  size?: number;
  sha?: string;
  url?: string;
  isBinary?: boolean; // Flag to indicate binary files (images, PDFs, etc.)
  binary?: boolean;
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
  repositoryName?: string;
  ownerPubkey?: string;
  fileCount?: number;
  logoUrl?: string | null;
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
  lastNostrEventCreatedAt?: number;
  fromNostr?: boolean;
  deleted?: boolean;
  hasUnpushedEdits?: boolean;
  lastPushAttempt?: number;
  bridgeProcessed?: boolean;
  successfulSources?: Array<{
    source: string;
    status: "pending" | "fetching" | "success" | "failed";
    error?: string;
  }>;
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
  const ext = path.split('.').pop()?.toLowerCase() || '';
  const textExts = ['txt', 'md', 'json', 'js', 'ts', 'jsx', 'tsx', 'css', 'html', 'htm', 'xml', 'yml', 'yaml', 'toml', 'ini', 'conf', 'log', 'csv', 'tsv', 'sh', 'bash', 'zsh', 'fish', 'py', 'rb', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'hpp', 'sql', 'r', 'm', 'swift', 'kt', 'scala', 'clj', 'hs', 'elm', 'ex', 'exs', 'erl', 'hrl', 'ml', 'mli', 'fs', 'fsx', 'vb', 'cs', 'dart', 'lua', 'vim', 'vimrc', 'gitignore', 'gitattributes', 'dockerfile', 'makefile', 'cmake', 'gradle', 'maven', 'pom', 'sbt', 'build', 'rakefile', 'gemfile', 'podfile', 'cartfile'];
  const binaryExts = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'pdf', 'woff', 'woff2', 'ttf', 'otf', 'eot', 'mp4', 'mp3', 'wav', 'avi', 'mov', 'zip', 'tar', 'gz', 'bz2', 'xz', '7z', 'rar', 'exe', 'dll', 'so', 'dylib', 'bin'];
  
  // Check MIME type first (more reliable)
  if (mimeType) {
    if (mimeType.startsWith('image/') || mimeType.startsWith('video/') || mimeType.startsWith('audio/') || 
        mimeType === 'application/pdf' || mimeType.startsWith('font/') || mimeType === 'application/octet-stream') {
      return true;
    }
    if (mimeType.startsWith('text/') || mimeType === 'application/json' || mimeType === 'application/xml') {
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
  files: Array<{ path: string; content?: string; type?: string; isBinary?: boolean }>,
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
      .map(f => ({
        ...f,
        path: normalizeFilePath(f.path),
      }))
      .filter(f => f.path && f.path.length > 0); // Remove invalid paths
    
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
    existingFiles.forEach(f => {
      if (f.path) {
        existingFileMap.set(f.path, f);
      }
    });
    
    // Add or update files
    validFiles.forEach(file => {
      const normalizedPath = file.path;
      const isBinary = file.isBinary !== undefined ? file.isBinary : isBinaryFile(normalizedPath, file.type);
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
    
    // Update repo.files
    repoData.files = updatedFiles;
    repos[repoIndex] = repoData;
    saveStoredRepos(repos);
    
    // Also save to separate files storage (for optimized storage)
    saveRepoFiles(entity, repo, updatedFiles);
    
    // Store file content in overrides (so it can be displayed)
    const overrides = loadRepoOverrides(entity, repo);
    validFiles.forEach(file => {
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
      const updatedDeletedPaths = deletedPaths.filter(path => 
        !validFiles.some(file => file.path === path)
      );
      if (updatedDeletedPaths.length !== deletedPaths.length) {
        saveRepoDeletedPaths(entity, repo, updatedDeletedPaths);
        console.log(`✅ [addFilesToRepo] Removed ${deletedPaths.length - updatedDeletedPaths.length} file(s) from deletedPaths (re-added)`);
      }
    }
    
    // CRITICAL: Mark repo as edited so "Push to Nostr" button appears
    markRepoAsEdited(repo, entity);
    console.log(`📝 [addFilesToRepo] Marked repo as having unpushed edits after adding ${validFiles.length} file(s)`);
    
    // Create a commit with auto-generated commit message
    if (authorPubkey && validFiles.length > 0) {
      try {
        const commitId = `commit-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        
        // Auto-generate commit message based on filenames
        let commitMessage: string;
        if (validFiles.length === 1 && validFiles[0]) {
          const fileName = validFiles[0].path.split("/").pop() || validFiles[0].path;
          commitMessage = `Add ${fileName}`;
        } else if (validFiles.length <= 3) {
          const fileNames = validFiles.map(f => f?.path?.split("/").pop() || f?.path || "file").join(", ");
          commitMessage = `Add ${fileNames}`;
        } else {
          const fileCount = validFiles.length;
          const firstFile = validFiles[0]?.path?.split("/").pop() || validFiles[0]?.path || "file";
          commitMessage = `Add ${firstFile} and ${fileCount - 1} more file${fileCount - 1 > 1 ? 's' : ''}`;
        }
        
        // Determine which files were added vs modified
        const addedFiles = validFiles.filter(f => !existingFileMap.has(f.path));
        const modifiedFiles = validFiles.filter(f => existingFileMap.has(f.path));
        
        const commit: any = {
          id: commitId,
          message: commitMessage,
          author: authorPubkey,
          timestamp: Date.now(),
          branch: repoData.defaultBranch || "main",
          filesChanged: validFiles.length,
          insertions: validFiles.length, // Approximate - we don't count lines here
          deletions: 0,
          changedFiles: validFiles.map(f => ({ 
            path: f.path, 
            status: addedFiles.includes(f) ? "added" : "modified"
          })),
        };
        
        const commitsKey = getRepoStorageKey("gittr_commits", entity, repo);
        const commits = JSON.parse(localStorage.getItem(commitsKey) || "[]");
        commits.unshift(commit);
        localStorage.setItem(commitsKey, JSON.stringify(commits));
        
        console.log(`✅ [addFilesToRepo] Created commit: ${commitMessage}`);
        
        // Dispatch event to refresh commits page
        window.dispatchEvent(new CustomEvent("gittr:commit-created", { detail: commit }));
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

