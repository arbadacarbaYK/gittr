import {
  type RepoFileEntry,
  loadRepoFiles,
  normalizeFilePath,
  saveRepoFiles,
} from "../repos/storage";

/** True for root README.md (case-insensitive), including nested paths ending in /readme.md */
export function isRepoReadmePath(path: string): boolean {
  const n = normalizeFilePath(path || "").toLowerCase();
  if (!n) return false;
  return n === "readme.md" || n.endsWith("/readme.md");
}

/** Returns README.md body from separate file storage, or null if missing / empty */
export function readReadmeTextFromRepoFiles(
  entity: string,
  repoName: string
): string | null {
  if (typeof window === "undefined") return null;
  const files = loadRepoFiles(entity, repoName);
  for (const f of files) {
    if (!isRepoReadmePath(f.path || "")) continue;
    const c = (f as RepoFileEntry & { content?: string }).content;
    if (typeof c === "string" && c.trim().length > 0) return c;
  }
  return null;
}

/**
 * Writes `readmeText` into the first README.md entry in separate file storage so
 * push/bridge and the file editor match `repo.readme` after gittr Pages sidebar updates.
 */
export function syncReadmeTextIntoRepoFiles(
  entity: string,
  repoName: string,
  readmeText: string
): { updated: boolean; path?: string } {
  if (typeof window === "undefined") return { updated: false };
  let files = loadRepoFiles(entity, repoName);
  if (!files.length) {
    const entry = {
      path: "README.md",
      type: "file",
      content: readmeText,
      isBinary: false,
    } as RepoFileEntry & { content?: string };
    saveRepoFiles(entity, repoName, [entry as RepoFileEntry]);
    try {
      window.dispatchEvent(new Event("gittr:repo-updated"));
    } catch {
      /* ignore */
    }
    return { updated: true, path: "README.md" };
  }

  let idx = -1;
  for (let i = 0; i < files.length; i++) {
    const row = files[i];
    if (!row) continue;
    if (isRepoReadmePath(row.path || "")) {
      idx = i;
      break;
    }
  }
  if (idx < 0) {
    const entry = {
      path: "README.md",
      type: "file",
      content: readmeText,
      isBinary: false,
    } as RepoFileEntry & { content?: string };
    const nextFiles = [...files, entry as RepoFileEntry];
    saveRepoFiles(entity, repoName, nextFiles);
    try {
      window.dispatchEvent(new Event("gittr:repo-updated"));
    } catch {
      /* ignore */
    }
    return { updated: true, path: "README.md" };
  }

  const prev = files[idx]!;
  const nextEntry = {
    ...prev,
    content: readmeText,
    isBinary: false,
    type: prev.type || "file",
  } as RepoFileEntry & { content?: string };

  const nextFiles = [...files];
  nextFiles[idx] = nextEntry as RepoFileEntry;
  saveRepoFiles(entity, repoName, nextFiles);
  try {
    window.dispatchEvent(new Event("gittr:repo-updated"));
  } catch {
    /* ignore */
  }
  return { updated: true, path: prev.path };
}
