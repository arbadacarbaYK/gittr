/**
 * Owner upload / new-file need a `gittr_repos` row. Browse-from-Nostr can show
 * the tree from the bridge without ever writing that row — then upload fails
 * with a useless "Failed to add files". This helper creates a shell and, when
 * the bridge already has objects, copies the file index so Push can fetch
 * bodies later and merge new uploads on top.
 */

import { findRepoByEntityAndName } from "../utils/repo-finder";
import { fetchBridgeFilesOnce } from "../utils/git-source-fetcher";

import {
  type RepoFileEntry,
  type StoredRepo,
  loadRepoFiles,
  loadStoredRepos,
  saveRepoFiles,
  saveStoredRepos,
} from "./storage";

export type EnsureLocalRepoForEditResult = {
  ok: boolean;
  createdShell: boolean;
  hydratedFromBridge: boolean;
  fileCount: number;
  error?: string;
};

function countLocalFiles(entity: string, repo: string, found?: StoredRepo | null): number {
  const indexed = loadRepoFiles(entity, repo);
  if (indexed.length > 0) return indexed.length;
  if (found?.files && Array.isArray(found.files)) return found.files.length;
  return typeof found?.fileCount === "number" ? found.fileCount : 0;
}

function toRepoFileEntries(
  files: Array<{ type?: string; path?: string; size?: number }>
): RepoFileEntry[] {
  const out: RepoFileEntry[] = [];
  for (const f of files) {
    const path = typeof f.path === "string" ? f.path.replace(/^\//, "").trim() : "";
    if (!path) continue;
    const type = f.type === "dir" || f.type === "tree" ? "dir" : "file";
    out.push({
      path,
      type,
      ...(typeof f.size === "number" ? { size: f.size } : {}),
    });
  }
  return out;
}

/**
 * Ensure localStorage has a repo row (and optionally a bridge file index)
 * before owner edits. Safe to call repeatedly; does not wipe unpushed edits.
 */
export async function ensureLocalRepoForEdit(opts: {
  entity: string;
  repo: string;
  ownerPubkey: string;
  defaultBranch?: string;
}): Promise<EnsureLocalRepoForEditResult> {
  const entity = opts.entity?.trim();
  const repo = opts.repo?.trim();
  const ownerPubkey = opts.ownerPubkey?.trim().toLowerCase();
  const branch = (opts.defaultBranch || "main").trim() || "main";

  if (!entity || !repo) {
    return {
      ok: false,
      createdShell: false,
      hydratedFromBridge: false,
      fileCount: 0,
      error: "Missing repository path",
    };
  }
  if (!/^[0-9a-f]{64}$/.test(ownerPubkey)) {
    return {
      ok: false,
      createdShell: false,
      hydratedFromBridge: false,
      fileCount: 0,
      error: "Could not determine repository owner",
    };
  }

  const repos = loadStoredRepos();
  let found = findRepoByEntityAndName<StoredRepo>(repos, entity, repo);
  let createdShell = false;
  let hydratedFromBridge = false;

  if (!found) {
    const shell: StoredRepo = {
      slug: repo,
      entity,
      repo,
      repositoryName: repo,
      name: repo,
      ownerPubkey,
      files: [],
      fileCount: 0,
      clone: [],
      relays: [],
      defaultBranch: branch,
      publicRead: true,
      publicWrite: false,
      syncedFromNostr: true,
      hasUnpushedEdits: false,
      createdAt: Date.now(),
    };
    repos.push(shell);
    if (!saveStoredRepos(repos, { preferOwnerPubkey: ownerPubkey })) {
      return {
        ok: false,
        createdShell: false,
        hydratedFromBridge: false,
        fileCount: 0,
        error:
          "Could not save repository locally (browser storage full?). Free space or Flush others' repos cache, then try again.",
      };
    }
    found = shell;
    createdShell = true;
  }

  const hasUnpushed = found.hasUnpushedEdits === true;
  let fileCount = countLocalFiles(entity, repo, found);

  // Already editable locally — don't replace unpushed work with a bridge snapshot.
  if (hasUnpushed || fileCount > 0) {
    return {
      ok: true,
      createdShell,
      hydratedFromBridge: false,
      fileCount,
    };
  }

  try {
    const bridge = await fetchBridgeFilesOnce(ownerPubkey, repo, branch);
    const entries = bridge?.files ? toRepoFileEntries(bridge.files) : [];
    if (entries.length > 0) {
      saveRepoFiles(entity, repo, entries);
      const next = loadStoredRepos();
      const matched = findRepoByEntityAndName<StoredRepo>(next, entity, repo);
      const idx = matched ? next.indexOf(matched) : -1;
      if (idx >= 0 && next[idx]) {
        const prev = next[idx];
        next[idx] = {
          ...prev,
          entity: prev.entity || entity,
          fileCount: entries.length,
          files: undefined,
          ownerPubkey: prev.ownerPubkey || ownerPubkey,
          defaultBranch:
            (typeof bridge?.branch === "string" && bridge.branch.trim()) ||
            prev.defaultBranch ||
            branch,
          syncedFromNostr: true,
        };
        saveStoredRepos(next, { preferOwnerPubkey: ownerPubkey });
      }
      hydratedFromBridge = true;
      fileCount = entries.length;
    }
  } catch (e) {
    console.warn("[ensureLocalRepoForEdit] Bridge hydrate failed:", e);
  }

  // Empty bridge is fine for brand-new repos — shell is enough to upload into.
  return {
    ok: true,
    createdShell,
    hydratedFromBridge,
    fileCount,
  };
}
