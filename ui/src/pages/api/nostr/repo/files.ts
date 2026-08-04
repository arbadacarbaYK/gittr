import { handleOptionsRequest, setCorsHeaders } from "@/lib/api/cors";
import {
  detectBareRepoDefaultBranch,
  listBareRepoBranches,
} from "@/lib/git/bare-repo-default-branch";
import {
  buildFlatTreeFromPaths,
  listBareRepoRecursivePaths,
  listBareRepoShallow,
  sanitizeRepoTreePath,
} from "@/lib/git/bare-repo-ls-tree";
import { assertRepoReadAccess } from "@/lib/repo-read-access";
import {
  REPO_FILE_TREE_SHALLOW_THRESHOLD,
  capRepoFileTreeForDisplay,
  fileTreeListFromScrub,
  filterGraspMirrorPollutionFromFileTree,
} from "@/lib/utils/filter-grasp-mirror-pollution";
import {
  resolveBridgeRepoPath,
  sanitizeBridgeRepoName,
} from "@/lib/utils/sanitize-bridge-repo-name";

import { exec } from "child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import type { NextApiRequest, NextApiResponse } from "next";
import { nip05, nip19 } from "nostr-tools";
import { promisify } from "util";

const execAsync = promisify(exec);

const filesCache = new Map<
  string,
  {
    timestamp: number;
    payload: {
      files: any[];
      branch: string;
      truncated?: boolean;
      listing?: "full" | "shallow";
      totalFileCount?: number;
    };
  }
>();
const CACHE_TTL_MS = 30_000;

const shouldIncludeSizes = (raw: string | string[] | undefined) => {
  // Default off: per-file `git cat-file -s` on large mirrors (10k+ paths) melts CPU.
  // Callers that need sizes must pass includeSizes=1 explicitly.
  if (raw === undefined) {
    return false;
  }
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return false;
  return !["0", "false", "no"].includes(value.toLowerCase());
};

/**
 * Resolves an entity (npub, NIP-05, or hex pubkey) to a full 64-char hex pubkey
 * This allows bridge API endpoints to accept NIP-05 format (e.g., user@example.com)
 * for compatibility with other Nostr git clients
 */
async function resolveOwnerPubkey(
  ownerPubkeyInput: string
): Promise<{ pubkey: string; error?: string }> {
  // If already a full hex pubkey, return it
  if (/^[0-9a-f]{64}$/i.test(ownerPubkeyInput)) {
    return { pubkey: ownerPubkeyInput.toLowerCase() };
  }

  // If npub, decode it
  if (ownerPubkeyInput.startsWith("npub")) {
    try {
      const decoded = nip19.decode(ownerPubkeyInput);
      if (
        decoded.type === "npub" &&
        typeof decoded.data === "string" &&
        decoded.data.length === 64
      ) {
        return { pubkey: decoded.data.toLowerCase() };
      }
      return { pubkey: "", error: "Invalid npub format" };
    } catch (error: any) {
      return {
        pubkey: "",
        error: `Failed to decode npub: ${error?.message || "invalid format"}`,
      };
    }
  }

  // If NIP-05 format (contains @), resolve it
  if (ownerPubkeyInput.includes("@")) {
    try {
      const profile = await nip05.queryProfile(ownerPubkeyInput);
      if (profile?.pubkey && /^[0-9a-f]{64}$/i.test(profile.pubkey)) {
        console.log(
          `✅ [Bridge API] Resolved NIP-05 ${ownerPubkeyInput} to pubkey: ${profile.pubkey.slice(
            0,
            8
          )}...`
        );
        return { pubkey: profile.pubkey.toLowerCase() };
      }
      return {
        pubkey: "",
        error: `NIP-05 ${ownerPubkeyInput} did not return a valid pubkey`,
      };
    } catch (error: any) {
      return {
        pubkey: "",
        error: `Failed to resolve NIP-05 ${ownerPubkeyInput}: ${
          error?.message || "unknown error"
        }`,
      };
    }
  }

  return {
    pubkey: "",
    error: `Invalid ownerPubkey format: must be 64-char hex, npub, or NIP-05 (received: ${ownerPubkeyInput.length} chars)`,
  };
}

/**
 * API endpoint to fetch repository files from git-nostr-bridge
 *
 * Endpoint: GET /api/nostr/repo/files?ownerPubkey={pubkey}&repo={repoName}&branch={branch}
 *
 * This endpoint reads files directly from the git repository on disk
 * (managed by git-nostr-bridge) and returns the file tree.
 *
 * CRITICAL: ownerPubkey must be the FULL 64-char hex pubkey (not npub, not 8-char prefix)
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Handle OPTIONS request for CORS
  if (req.method === "OPTIONS") {
    handleOptionsRequest(res, req);
    return;
  }

  // Set CORS headers
  setCorsHeaders(res, req);

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const {
    ownerPubkey: ownerPubkeyInput,
    repo: repoName,
    branch = "main",
    includeSizes: includeSizesRaw,
    path: pathRaw,
  } = req.query;

  // Validate inputs
  if (!ownerPubkeyInput || typeof ownerPubkeyInput !== "string") {
    return res.status(400).json({ error: "ownerPubkey is required" });
  }

  if (!repoName || typeof repoName !== "string") {
    return res.status(400).json({ error: "repo is required" });
  }

  const repoSanitized = sanitizeBridgeRepoName(repoName);
  if (!repoSanitized) {
    return res.status(400).json({
      error: "Invalid repository name",
      details:
        "Repo names must match the bridge rules (no spaces, slashes, or dots).",
    });
  }

  // CRITICAL: Resolve ownerPubkey (supports hex, npub, or NIP-05 format)
  // This allows other Nostr git clients to use NIP-05 format (e.g., user@example.com)
  const resolved = await resolveOwnerPubkey(ownerPubkeyInput);
  if (resolved.error || !resolved.pubkey) {
    return res.status(400).json({
      error: resolved.error || "Failed to resolve ownerPubkey",
      received:
        ownerPubkeyInput.length === 8
          ? "8-char prefix"
          : ownerPubkeyInput.startsWith("npub")
          ? "npub format"
          : ownerPubkeyInput.includes("@")
          ? "NIP-05 format"
          : `invalid format (${ownerPubkeyInput.length} chars)`,
    });
  }

  const ownerPubkey = resolved.pubkey;
  const includeSizes = shouldIncludeSizes(includeSizesRaw);
  const treePath = sanitizeRepoTreePath(pathRaw);
  if (treePath === null) {
    return res.status(400).json({
      error: "Invalid path",
      hint: "path must be a relative repo path without '..'",
    });
  }

  // Get repository directory from environment or git-nostr-bridge config file
  // Priority: env vars > config file > defaults
  let reposDir =
    process.env.GIT_NOSTR_BRIDGE_REPOS_DIR ||
    process.env.REPOS_DIR ||
    process.env.GITNOSTR_REPOS_DIR;

  // If not set in env, try to read from git-nostr-bridge config file
  // Try both root's home and git-nostr user's home
  if (!reposDir) {
    // Prefer the dedicated bridge user's config first: production Next.js often runs as
    // root or another user, so $HOME/.config/... can exist but point at the wrong tree or
    // omit repositoryDir; the bridge always uses /home/git-nostr/... when deployed per docs.
    const configPaths = [
      "/home/git-nostr/.config/git-nostr/git-nostr-bridge.json",
      process.env.HOME
        ? `${process.env.HOME}/.config/git-nostr/git-nostr-bridge.json`
        : null,
    ].filter(Boolean) as string[];

    for (const configPath of configPaths) {
      try {
        if (existsSync(configPath)) {
          const configContent = readFileSync(configPath, "utf-8");
          const config = JSON.parse(configContent);
          if (config.repositoryDir) {
            // Expand ~ to home directory if present
            const homeDir = configPath.includes("/home/git-nostr")
              ? "/home/git-nostr"
              : process.env.HOME || "";
            reposDir = config.repositoryDir.replace(/^~/, homeDir);
            console.log("📁 Using repositoryDir from config:", reposDir);
            break;
          }
        }
      } catch (error: any) {
        console.warn(
          `⚠️ Failed to read git-nostr-bridge config from ${configPath}:`,
          error.message
        );
      }
    }
  }

  // Fallback to common default locations
  if (!reposDir) {
    reposDir = process.env.HOME
      ? `${process.env.HOME}/git-nostr-repositories` // Most common default
      : "/tmp/gitnostr/repos";
  }

  // Repository path: reposDir/{ownerPubkey}/{repoName}.git
  const resolvedPath = resolveBridgeRepoPath(
    reposDir,
    ownerPubkey,
    repoSanitized
  );
  if (!resolvedPath) {
    return res.status(400).json({ error: "Invalid repository path" });
  }
  const repoPath = resolvedPath.repoPath;

  // Private repos: only owner/contributors may read (same ACL as SSH).
  const access = await assertRepoReadAccess(req, ownerPubkey, repoSanitized);
  if (!access.ok) {
    return res.status(access.status).json({ error: access.error });
  }

  try {
    console.log("🔍 Checking repository path:", repoPath);
    console.log("🔍 Repository directory exists:", existsSync(reposDir));
    console.log(
      "🔍 Owner directory exists:",
      existsSync(resolvedPath.ownerDir)
    );

    // Check if repository exists
    if (!existsSync(repoPath)) {
      console.error("❌ Repository not found at path:", repoPath);
      return res.status(404).json({
        error: "Repository not found",
        path: repoPath,
        reposDir,
        ownerPubkey: ownerPubkey.slice(0, 8),
        hint: "Repository may not be cloned yet by git-nostr-bridge. The bridge creates repos when it sees repository events on Nostr.",
      });
    }

    console.log("✅ Repository found, checking if it has commits...");

    // First check if repo has any commits (bare repos start empty)
    try {
      const { stdout: refs } = await execAsync(
        `git --git-dir="${repoPath}" for-each-ref --format="%(refname)" refs/heads/`,
        { timeout: 5000 }
      );

      if (!refs.trim()) {
        console.log("⚠️ Repository exists but has no branches (empty repo)");
        return res.status(200).json({
          files: [],
          message: "Repository exists but is empty (no commits yet)",
        });
      }

      console.log(
        "✅ Repository has branches:",
        refs.trim().split("\n").length
      );
    } catch (refError: any) {
      console.warn("⚠️ Could not check refs:", refError.message);
      // Continue anyway - might still have files
    }

    const branchStr: string = Array.isArray(branch)
      ? branch[0] || "main"
      : typeof branch === "string"
      ? branch
      : "main";
    const cacheKey = `${repoPath}:${branchStr}:path=${treePath}:sizes=${includeSizes}`;
    const cached = filesCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return res.status(200).json(cached.payload);
    }

    // Resolve a branch that actually exists (main/master → HEAD for foreign mirrors)
    const branchCandidates = [
      branchStr,
      ...(branchStr === "main"
        ? ["master"]
        : branchStr === "master"
        ? ["main"]
        : ["main", "master"]),
    ];
    const detectedDefault = await detectBareRepoDefaultBranch(repoPath);
    if (detectedDefault && !branchCandidates.includes(detectedDefault)) {
      branchCandidates.push(detectedDefault);
    }

    let resolvedBranch: string | null = null;
    for (const candidate of branchCandidates) {
      try {
        await execAsync(
          `git --git-dir="${repoPath}" rev-parse --verify ${JSON.stringify(
            candidate
          )}^{commit}`,
          { timeout: 5000 }
        );
        resolvedBranch = candidate;
        break;
      } catch {
        // try next
      }
    }

    if (!resolvedBranch) {
      const availableBranches = await listBareRepoBranches(repoPath);
      return res.status(404).json({
        error: "Branch not found",
        branch: branchStr,
        triedBranches: branchCandidates,
        defaultBranch: detectedDefault || availableBranches[0] || null,
        availableBranches,
        hint: "Repository may be empty or branch doesn't exist",
      });
    }

    console.log(
      `🔍 Fetching file tree for branch: ${resolvedBranch}` +
        (treePath ? ` path=${treePath}` : "")
    );

    const respondWithTree = (payload: {
      files: Array<{ type: string; path: string; size?: number }>;
      branch: string;
      truncated?: boolean;
      listing?: "full" | "shallow";
      totalFileCount?: number;
    }) => {
      const scrubbed = filterGraspMirrorPollutionFromFileTree(payload.files, {
        ownerPubkeyHex: ownerPubkey,
      });
      const finalPayload = {
        ...payload,
        files: scrubbed,
      };
      filesCache.set(cacheKey, {
        timestamp: Date.now(),
        payload: finalPayload,
      });
      return res.status(200).json(finalPayload);
    };

    // Folder browse: one-level listing (never hollow from soft-cap)
    if (treePath) {
      try {
        const entries = await listBareRepoShallow(
          repoPath,
          resolvedBranch,
          treePath,
          { includeSizes }
        );
        return respondWithTree({
          files: entries,
          branch: resolvedBranch,
          truncated: false,
          listing: "shallow",
        });
      } catch (err: any) {
        const msg = err?.stderr || err?.message || String(err);
        if (
          String(msg).includes("not a valid object name") ||
          String(msg).includes("does not exist")
        ) {
          return res.status(404).json({
            error: "Path not found",
            path: treePath,
            branch: resolvedBranch,
          });
        }
        throw err;
      }
    }

    // Root: recursive when small; shallow when huge (Trezor-scale mirrors)
    let filePaths: string[];
    try {
      filePaths = await listBareRepoRecursivePaths(repoPath, resolvedBranch);
    } catch (err: any) {
      console.error("Git ls-tree error:", err?.stderr || err?.message);
      return res.status(500).json({
        error: "Failed to read repository",
        details: err?.stderr || err?.message || String(err),
      });
    }

    console.log(`✅ Found ${filePaths.length} files in '${resolvedBranch}'`);

    if (filePaths.length > REPO_FILE_TREE_SHALLOW_THRESHOLD) {
      const entries = await listBareRepoShallow(
        repoPath,
        resolvedBranch,
        "",
        { includeSizes }
      );
      console.log(
        `ℹ️ Large tree (${filePaths.length} files) — returning shallow root (${entries.length} entries)`
      );
      return respondWithTree({
        files: entries,
        branch: resolvedBranch,
        truncated: true,
        listing: "shallow",
        totalFileCount: filePaths.length,
      });
    }

    const flat = buildFlatTreeFromPaths(filePaths);
    const capped = capRepoFileTreeForDisplay(
      filterGraspMirrorPollutionFromFileTree(flat, {
        ownerPubkeyHex: ownerPubkey,
      })
    );
    return respondWithTree({
      files: fileTreeListFromScrub(capped),
      branch: resolvedBranch,
      truncated: capped.truncated,
      listing: "full",
      totalFileCount: filePaths.length,
    });
  } catch (error: any) {
    console.error("Error fetching repository files:", error);

    // Handle specific git errors
    if (error.code === "ENOENT") {
      return res.status(404).json({
        error: "Repository not found",
        path: repoPath,
      });
    }

    if (error.message?.includes("not a git repository")) {
      return res.status(400).json({
        error: "Invalid git repository",
        path: repoPath,
      });
    }

    if (error.message?.includes("fatal: ambiguous argument")) {
      return res.status(400).json({
        error: "Branch not found",
        branch,
        hint: "Try 'main' or 'master'",
      });
    }

    return res.status(500).json({
      error: "Failed to fetch repository files",
      details: error.message,
    });
  }
}
