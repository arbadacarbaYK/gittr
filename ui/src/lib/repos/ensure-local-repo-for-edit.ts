/**
 * Owner upload / new-file need a `gittr_repos` row. Browse-from-Nostr can show
 * the tree from the bridge without ever writing that row — then upload fails
 * with a useless "Failed to add files".
 *
 * When there are **no** unpushed local edits, we always refresh the file index
 * from the bridge tip before edit so stale browser trees cannot regress Push.
 * When there **are** unpushed edits, we keep the local working tree (upload
 * merges on top of that intentional draft).
 */

import { findRepoByEntityAndName } from "../utils/repo-finder";
import { fetchBridgeFilesOnce } from "../utils/git-source-fetcher";
import { repoHasUnpushedLocalEdits } from "./unpushed-local-edits";

import {
  type RepoFileEntry,
  type StoredRepo,
  loadRepoFiles,
  loadStoredRepos,
  saveRepoDeletedPaths,
  saveRepoFiles,
  saveRepoOverrides,
  saveStoredRepos,
} from "./storage";
import { clearDeletedRepoTombstones } from "./deleted-repo-tombstones";
import { forgetOverrideBlob, idbDeleteRepoOverrides } from "./overrides-idb";

export type EnsureLocalRepoForEditResult = {
  ok: boolean;
  createdShell: boolean;
  hydratedFromBridge: boolean;
  /** True when we kept an existing unpushed local working tree. */
  keptUnpushedLocal: boolean;
  fileCount: number;
  error?: string;
};

function countLocalFiles(
  entity: string,
  repo: string,
  found?: StoredRepo | null
): number {
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
    const path =
      typeof f.path === "string" ? f.path.replace(/^\//, "").trim() : "";
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
 * Ensure localStorage has a repo row, then align the file index with the
 * published tip unless the owner already has unpushed local edits.
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
      keptUnpushedLocal: false,
      fileCount: 0,
      error: "Missing repository path",
    };
  }
  if (!/^[0-9a-f]{64}$/.test(ownerPubkey)) {
    return {
      ok: false,
      createdShell: false,
      hydratedFromBridge: false,
      keptUnpushedLocal: false,
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
        keptUnpushedLocal: false,
        fileCount: 0,
        error:
          "Could not save repository locally (browser storage full?). Free space or Flush others' repos cache, then try again.",
      };
    }
    found = shell;
    createdShell = true;
  }

  clearDeletedRepoTombstones({
    entity,
    repo,
    ownerPubkey,
  });

  const hasUnpushed = repoHasUnpushedLocalEdits(found);
  let fileCount = countLocalFiles(entity, repo, found);

  // Intentional local draft — upload/new-file merge onto this, do not wipe.
  if (hasUnpushed) {
    return {
      ok: true,
      createdShell,
      hydratedFromBridge: false,
      keptUnpushedLocal: true,
      fileCount,
    };
  }

  // No unpushed edits: always refresh index from bridge tip (even if a stale
  // local tree exists) so Push cannot regress a newer published state.
  try {
    const bridge = await fetchBridgeFilesOnce(ownerPubkey, repo, branch);
    const entries = bridge?.files ? toRepoFileEntries(bridge.files) : [];
    // Replace local index with tip (empty tip = empty index for brand-new repos)
    saveRepoFiles(entity, repo, entries);
    // Stale overrides / delete tombstones must not outlive a clean tip sync
    try {
      saveRepoOverrides(entity, repo, {});
    } catch {
      /* ignore */
    }
    forgetOverrideBlob(entity, repo);
    void idbDeleteRepoOverrides(entity, repo).catch(() => undefined);
    try {
      saveRepoDeletedPaths(entity, repo, []);
    } catch {
      /* ignore */
    }

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
        hasUnpushedEdits: false,
      };
      saveStoredRepos(next, { preferOwnerPubkey: ownerPubkey });
    }
    hydratedFromBridge = true;
    fileCount = entries.length;
  } catch (e) {
    console.warn("[ensureLocalRepoForEdit] Bridge hydrate failed:", e);
    // Fall through with whatever local index exists — better than blocking upload
  }

  return {
    ok: true,
    createdShell,
    hydratedFromBridge,
    keptUnpushedLocal: false,
    fileCount,
  };
}
