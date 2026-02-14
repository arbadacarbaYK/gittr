import { rateLimiters } from "@/app/api/middleware/rate-limit";
import { handleOptionsRequest, setCorsHeaders } from "@/lib/api/cors";
import { verifyNostrAuth, verifySSHKeyOwnership } from "./push-auth";

import { exec } from "child_process";
import { existsSync, readFileSync, statSync } from "fs";
import type { NextApiRequest, NextApiResponse } from "next";
import os from "os";
import { dirname, join, normalize } from "path";
import { promisify } from "util";

import { mkdir, mkdtemp, rm, stat, writeFile } from "fs/promises";

const execAsync = promisify(exec);

interface IncomingFile {
  path: string;
  content?: string;
  isBinary?: boolean;
}

const sanitizePath = (input: string): string => {
  const normalized = normalize(input).replace(/\\/g, "/");
  const trimmed = normalized.replace(/^(\.\/)+/, "");
  const parts = trimmed
    .split("/")
    .filter((part) => part && part !== "." && part !== "..");
  return parts.join("/");
};

async function resolveReposDir(): Promise<string> {
  let reposDir =
    process.env.GIT_NOSTR_BRIDGE_REPOS_DIR ||
    process.env.REPOS_DIR ||
    process.env.GITNOSTR_REPOS_DIR;

  if (!reposDir) {
    const configPaths = [
      process.env.HOME
        ? `${process.env.HOME}/.config/git-nostr/git-nostr-bridge.json`
        : null,
      "/home/git-nostr/.config/git-nostr/git-nostr-bridge.json",
    ].filter(Boolean) as string[];

    for (const configPath of configPaths) {
      try {
        if (existsSync(configPath)) {
          const configContent = readFileSync(configPath, "utf-8");
          const config = JSON.parse(configContent);
          if (config.repositoryDir) {
            const homeDir = configPath.includes("/home/git-nostr")
              ? "/home/git-nostr"
              : process.env.HOME || "";
            reposDir = config.repositoryDir.replace(/^~/, homeDir);
            break;
          }
        }
      } catch (error) {
        console.warn(
          `⚠️ Failed to read git-nostr config from ${configPath}:`,
          error
        );
      }
    }
  }

  if (!reposDir) {
    reposDir = process.env.HOME
      ? `${process.env.HOME}/git-nostr-repositories`
      : "/tmp/gitnostr/repos";
  }

  return reposDir;
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "25mb",
    },
  },
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method === "OPTIONS") {
    handleOptionsRequest(res, req);
    return;
  }

  setCorsHeaders(res, req);

  const rateLimitResult = await rateLimiters.push(req as any);
  if (rateLimitResult) {
    return res.status(429).json(JSON.parse(await rateLimitResult.text()));
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const {
    ownerPubkey: ownerPubkeyInput,
    repo: repoName,
    branch = "main",
    files,
    commitDate,
    createCommit = true,
    chunkIndex,
    totalChunks,
    pushSessionId,
  } = req.body || {};

  // CRITICAL: Support hex pubkey (64-char), npub format (NIP-19), and NIP-05
  // The bridge stores repos by hex pubkey in filesystem, so we resolve to hex
  let ownerPubkey: string;
  if (!ownerPubkeyInput || typeof ownerPubkeyInput !== "string") {
    return res.status(400).json({ error: "ownerPubkey is required" });
  }

  // Check if it's already hex format (64-char)
  if (/^[0-9a-f]{64}$/i.test(ownerPubkeyInput)) {
    ownerPubkey = ownerPubkeyInput.toLowerCase();
  } else if (ownerPubkeyInput.startsWith("npub")) {
    // Decode npub to hex
    try {
      const { nip19 } = await import("nostr-tools");
      const decoded = nip19.decode(ownerPubkeyInput);
      if (
        decoded.type === "npub" &&
        typeof decoded.data === "string" &&
        decoded.data.length === 64
      ) {
        ownerPubkey = decoded.data.toLowerCase();
      } else {
        return res.status(400).json({ error: "Invalid npub format" });
      }
    } catch (error: any) {
      return res.status(400).json({
        error: `Failed to decode npub: ${error?.message || "invalid format"}`,
      });
    }
  } else if (ownerPubkeyInput.includes("@")) {
    // Resolve NIP-05 to hex pubkey
    try {
      const { nip05 } = await import("nostr-tools");
      const profile = await nip05.queryProfile(ownerPubkeyInput);
      if (profile?.pubkey && /^[0-9a-f]{64}$/i.test(profile.pubkey)) {
        console.log(
          `✅ [Push API] Resolved NIP-05 ${ownerPubkeyInput} to pubkey: ${profile.pubkey.slice(
            0,
            8
          )}...`
        );
        ownerPubkey = profile.pubkey.toLowerCase();
      } else {
        return res.status(400).json({
          error: `NIP-05 ${ownerPubkeyInput} did not return a valid pubkey`,
        });
      }
    } catch (error: any) {
      return res.status(400).json({
        error: `Failed to resolve NIP-05 ${ownerPubkeyInput}: ${
          error?.message || "unknown error"
        }`,
      });
    }
  } else {
    return res.status(400).json({
      error:
        "ownerPubkey must be a 64-char hex string, npub (NIP-19 format), or NIP-05 (e.g., user@domain.com)",
      received:
        ownerPubkeyInput.length === 8
          ? "8-char prefix"
          : ownerPubkeyInput.startsWith("npub")
          ? "npub (decoding failed)"
          : `invalid format (${ownerPubkeyInput.length} chars)`,
    });
  }

  // CRITICAL: Verify Nostr authentication before processing push
  const authResult = await verifyNostrAuth(req);
  if (!authResult.authorized) {
    console.warn(`🚫 [Bridge Push] Unauthorized push attempt: ${authResult.error}`);
    return res.status(401).json({
      error: "Authentication required",
      details: authResult.error,
      auth_methods: [
        "Authorization: Nostr <base64-signed-challenge> (NIP-98)",
        "X-Nostr-Pubkey + X-Nostr-Signature headers",
      ],
    });
  }

  // Verify the authenticated user can push to this repo
  const ownershipCheck = await verifySSHKeyOwnership(authResult.pubkey!, ownerPubkey);
  if (!ownershipCheck.authorized) {
    console.warn(
      `🚫 [Bridge Push] Push denied: ${ownershipCheck.error} (auth=${authResult.pubkey?.slice(0, 8)}..., owner=${ownerPubkey.slice(0, 8)}...)`
    );
    return res.status(403).json({
      error: "Access denied",
      details: ownershipCheck.error,
    });
  }

  console.log(
    `✅ [Bridge Push] Authenticated push: pubkey=${authResult.pubkey?.slice(0, 8)}..., owner=${ownerPubkey.slice(0, 8)}..., repo=${repoName}`
  );

  if (!repoName || typeof repoName !== "string") {
    return res.status(400).json({ error: "repo is required" });
  }

  if (!Array.isArray(files)) {
    return res.status(400).json({ error: "files array is required" });
  }

  // Allow empty files array - we'll still create a commit with --allow-empty
  // This ensures every push creates a new commit with the current timestamp

  // Use provided commitDate (Unix timestamp in seconds) or current time
  // commitDate should be from lastNostrEventCreatedAt to preserve push history
  const commitTimestamp =
    commitDate && typeof commitDate === "number" && commitDate > 0
      ? commitDate
      : Math.floor(Date.now() / 1000);

  const reposDir = await resolveReposDir();
  const repoPath = join(reposDir, ownerPubkey, `${repoName}.git`);

  // CRITICAL: Log bridge push parameters for debugging
  console.log(`📤 [Bridge Push] Starting push:`, {
    ownerPubkey: ownerPubkey ? `${ownerPubkey.substring(0, 8)}...` : "none",
    repoName,
    branch,
    filesCount: files.length,
    commitTimestamp,
    reposDir,
    repoPath,
    filesWithContent: files.filter(
      (f: any) => f.content && f.content.length > 0
    ).length,
    filesWithoutContent: files.filter(
      (f: any) => !f.content || f.content.length === 0
    ).length,
  });

  let tempDir: string | null = null;
  const missingFiles: string[] = [];
  const isChunked = totalChunks && totalChunks > 1;

  try {
    await execAsync(`mkdir -p "${join(reposDir, ownerPubkey)}"`);
    if (!existsSync(repoPath)) {
      await execAsync(`git init --bare "${repoPath}"`);
      // CRITICAL: Set HEAD to the branch we'll push (usually "main")
      // This ensures git log and other commands work immediately
      await execAsync(
        `git --git-dir="${repoPath}" symbolic-ref HEAD refs/heads/${branch}`
      );

      // CRITICAL: Set ownership to git-nostr:git-nostr so bridge can write refs
      // git-http-backend (fcgiwrap) can read with proper permissions (755)
      // On local dev, this might fail if git-nostr doesn't exist, which is fine
      try {
        await execAsync(`chown -R git-nostr:git-nostr "${repoPath}"`);
        await execAsync(`chmod -R u+rwX,g+rX,o+rX "${repoPath}"`);
        console.log(
          `✅ Set ownership to git-nostr:git-nostr for ${repoPath} (bridge can write, http-backend can read)`
        );
      } catch (chownError: any) {
        // Fallback: try www-data if git-nostr doesn't exist (local dev)
        console.warn(
          `⚠️ Failed to set ownership to git-nostr, trying www-data:`,
          chownError?.message
        );
        try {
          await execAsync(`chown -R www-data:www-data "${repoPath}"`);
          console.log(
            `✅ Set ownership to www-data:www-data for ${repoPath} (fallback)`
          );
        } catch (fallbackError: any) {
          console.warn(
            `⚠️ Failed to set ownership (this is OK for local dev):`,
            fallbackError?.message
          );
        }
      }
    }

    // CRITICAL: Use shared working directory for chunked pushes to avoid slow clones
    // For chunked pushes with pushSessionId, reuse the same working directory
    // This avoids cloning the repo for each chunk (which gets slower as repo grows)
    const isFirstChunk = !chunkIndex || chunkIndex === 0;

    if (isChunked && pushSessionId) {
      // Use a predictable path based on push session ID
      tempDir = join(os.tmpdir(), `gittr-push-${pushSessionId}`);
      const tempDirExists = existsSync(tempDir);

      if (isFirstChunk) {
        // Chunk 1: Create new working directory, clone existing repo if it exists
        if (tempDirExists) {
          // Clean up any leftover directory from a previous failed push
          console.log(
            `🧹 [Bridge Push] Cleaning up leftover working directory from previous push...`
          );
          await rm(tempDir, { recursive: true, force: true });
        }
        await mkdir(tempDir, { recursive: true });
        await execAsync(`git init "${tempDir}"`);
        await execAsync(`git -C "${tempDir}" config user.name "gittr push"`);
        await execAsync(
          `git -C "${tempDir}" config user.email "push@gittr.space"`
        );

        // If repo exists, clone it to get existing files
        if (existsSync(repoPath)) {
          console.log(
            `📋 [Bridge Push] Chunk 1/${totalChunks}: Cloning existing repo to get files...`
          );
          try {
            const cloneTempDir = await mkdtemp(
              join(os.tmpdir(), "gittr-clone-")
            );
            await execAsync(`git clone "${repoPath}" "${cloneTempDir}"`, {
              timeout: 120000,
            }); // 2 min timeout
            await execAsync(
              `rsync -a --exclude='.git' "${cloneTempDir}/" "${tempDir}/"`
            );
            await rm(cloneTempDir, { recursive: true, force: true });
            console.log(`✅ [Bridge Push] Cloned existing repo`);
          } catch (cloneError: any) {
            console.warn(
              `⚠️ [Bridge Push] Failed to clone existing repo:`,
              cloneError?.message
            );
            // Continue anyway - we'll start fresh
          }
        }
      } else {
        // Chunks 2+: Reuse existing working directory
        if (!tempDirExists) {
          return res.status(400).json({
            error: `Working directory not found for chunk ${
              chunkIndex + 1
            }. Chunk 1 must be processed first.`,
            pushSessionId,
          });
        }
        console.log(
          `📋 [Bridge Push] Chunk ${
            chunkIndex + 1
          }/${totalChunks}: Reusing working directory (no clone needed)`
        );
        // Working directory already has files from previous chunks - just add new files
      }
    } else {
      // Non-chunked push: Use temporary directory as before
      tempDir = await mkdtemp(join(os.tmpdir(), "gittr-push-"));
      await execAsync(`git init "${tempDir}"`);
      await execAsync(`git -C "${tempDir}" config user.name "gittr push"`);
      await execAsync(
        `git -C "${tempDir}" config user.email "push@gittr.space"`
      );

      // For non-chunked pushes with no files, clone existing repo to preserve state
      if (files.length === 0 && existsSync(repoPath)) {
        console.log(
          `📋 [Bridge Push] No files provided, copying existing files from repo to preserve state...`
        );
        try {
          const cloneTempDir = await mkdtemp(join(os.tmpdir(), "gittr-clone-"));
          await execAsync(`git clone "${repoPath}" "${cloneTempDir}"`, {
            timeout: 120000,
          });
          await execAsync(
            `rsync -a --exclude='.git' "${cloneTempDir}/" "${tempDir}/"`
          );
          await rm(cloneTempDir, { recursive: true, force: true });
          console.log(`✅ [Bridge Push] Copied existing files from repo`);
        } catch (cloneError: any) {
          console.warn(
            `⚠️ [Bridge Push] Failed to copy existing files, will create empty commit:`,
            cloneError?.message
          );
        }
      }
    }

    let writtenFiles = 0;
    for (const file of files as IncomingFile[]) {
      if (!file || typeof file.path !== "string") continue;
      const safePath = sanitizePath(file.path);
      if (!safePath) continue;

      if (!file.content) {
        missingFiles.push(safePath);
        continue;
      }

      const targetPath = join(tempDir, safePath);

      // CRITICAL: Check if target path already exists as a directory
      // If it does, skip writing (directories are created automatically by git)
      // This prevents EISDIR errors when trying to write to a directory path
      try {
        const stats = await stat(targetPath).catch(() => null);
        if (stats && stats.isDirectory()) {
          console.warn(
            `⚠️ [Bridge Push] Skipping ${safePath} - path exists as directory (not a file)`
          );
          continue;
        }
      } catch (statError) {
        // Path doesn't exist yet, which is fine - we'll create it
      }

      // CRITICAL: Validate all parent directories before creating them
      // In chunked pushes, a parent path might be a file from a previous chunk
      // (e.g., chunk 1 creates file "foo", chunk 2 tries to create "foo/bar")
      // This would cause mkdir to fail with ENOTDIR
      const parentDir = dirname(targetPath);
      const pathParts = parentDir
        .replace(tempDir, "")
        .split("/")
        .filter(Boolean);
      let currentPath = tempDir;

      for (const part of pathParts) {
        currentPath = join(currentPath, part);
        try {
          const parentStats = await stat(currentPath).catch(() => null);
          if (parentStats) {
            if (parentStats.isFile()) {
              // Parent path is a file, not a directory - this is a conflict
              console.error(
                `❌ [Bridge Push] Cannot create ${safePath} - parent path ${part} exists as a file (not a directory)`
              );
              missingFiles.push(safePath);
              break; // Exit path checking loop - we've already determined we can't create this file
            }
            // Parent exists and is a directory - continue checking remaining path parts
          } else {
            // Parent doesn't exist - mkdir will create it
          }
        } catch (checkError) {
          // Error checking - assume it's safe to create
        }
      }

      // Only proceed if we didn't skip due to parent path conflict
      if (missingFiles.includes(safePath)) {
        continue;
      }

      await mkdir(parentDir, { recursive: true });

      const buffer = file.isBinary
        ? Buffer.from(file.content, "base64")
        : Buffer.from(file.content, "utf8");

      await writeFile(targetPath, buffer as unknown as Uint8Array);
      writtenFiles++;
    }

    // Allow empty commits - we'll use --allow-empty to create a commit even if no files changed
    // This ensures every push creates a new commit with the current timestamp
    if (writtenFiles === 0 && files.length > 0) {
      // Only error if files were provided but none had content
      return res.status(400).json({
        error: "No file content provided for bridge push",
        missingFiles,
      });
    }

    // CRITICAL: For chunked pushes, only add/commit on the final chunk
    // Intermediate chunks just write files - git add/commit happens once at the end
    // This avoids slow git add operations on progressively larger directories
    const shouldCommit = createCommit !== false; // Default to true, only skip if explicitly false

    if (shouldCommit) {
      // CRITICAL: Only run git add on the final chunk (or non-chunked pushes)
      // git add -A on a directory with hundreds of files (from previous chunks) is VERY slow
      // By deferring git add until the final chunk, we only do it once with all files
      await execAsync(`git -C "${tempDir}" add -A`);
      // CRITICAL: Use --allow-empty to always create a new commit, even if files are unchanged
      // This ensures each push to Nostr creates a new commit with the correct date, which gitworkshop.dev will show
      // Without this, if files are identical, git won't create a commit and state event will point to old commit
      // CRITICAL: Set commit date using GIT_AUTHOR_DATE and GIT_COMMITTER_DATE environment variables
      // This ensures the commit date matches when the repo was pushed, not when the commit is created
      const commitDateISO = new Date(commitTimestamp * 1000).toISOString();
      const commitDateRFC2822 = new Date(commitTimestamp * 1000).toUTCString();
      await execAsync(
        `git -C "${tempDir}" commit --allow-empty -m "Push from gittr (${commitDateISO})"`,
        {
          env: {
            ...process.env,
            GIT_AUTHOR_DATE: commitDateRFC2822,
            GIT_COMMITTER_DATE: commitDateRFC2822,
          },
        }
      );
      await execAsync(`git -C "${tempDir}" branch -M ${branch}`);
      await execAsync(`git -C "${tempDir}" remote add origin "${repoPath}"`);

      // CRITICAL: Add the bare repo to git's safe.directory before pushing
      // This prevents "dubious ownership" errors when pushing from temp dir to www-data-owned repo
      try {
        await execAsync(
          `git config --system --add safe.directory "${repoPath}"`
        );
        console.log(`✅ Added ${repoPath} to git safe.directory`);
      } catch (safeDirError: any) {
        // If system config fails, try global for the current user
        console.warn(
          `⚠️ Failed to add to system safe.directory, trying global:`,
          safeDirError?.message
        );
        try {
          await execAsync(
            `git config --global --add safe.directory "${repoPath}"`
          );
          console.log(`✅ Added ${repoPath} to git global safe.directory`);
        } catch (globalError: any) {
          console.warn(
            `⚠️ Failed to add to global safe.directory (may cause push errors):`,
            globalError?.message
          );
        }
      }

      await execAsync(`git -C "${tempDir}" push --force origin ${branch}`, {
        timeout: 120000,
      }); // 2 min timeout

      // CRITICAL: Update HEAD in bare repo to point to the branch we just pushed
      // This ensures git log and other commands work correctly
      await execAsync(
        `git --git-dir="${repoPath}" symbolic-ref HEAD refs/heads/${branch}`
      );

      // CRITICAL: Ensure ownership is correct after push
      // The bridge runs as git-nostr user and needs write access to update refs
      // git-http-backend (fcgiwrap) runs as www-data but can read with proper permissions
      // Solution: Set ownership to git-nostr:git-nostr, then add www-data to git-nostr group OR use 755 permissions
      // For now, use git-nostr ownership (bridge can write, http-backend can read with 755 perms)
      try {
        await execAsync(`chown -R git-nostr:git-nostr "${repoPath}"`);
        // Set permissions so www-data (git-http-backend) can read but git-nostr can write
        await execAsync(`chmod -R u+rwX,g+rX,o+rX "${repoPath}"`);
        console.log(
          `✅ Set ownership to git-nostr:git-nostr for ${repoPath} (bridge can write, http-backend can read)`
        );
      } catch (chownError: any) {
        // Fallback: try www-data if git-nostr doesn't exist (local dev)
        console.warn(
          `⚠️ Failed to set ownership to git-nostr, trying www-data:`,
          chownError?.message
        );
        try {
          await execAsync(`chown -R www-data:www-data "${repoPath}"`);
          console.log(
            `✅ Set ownership to www-data:www-data for ${repoPath} (fallback)`
          );
        } catch (fallbackError: any) {
          console.warn(
            `⚠️ Failed to set ownership (this is OK for local dev):`,
            fallbackError?.message
          );
        }
      }
    } else {
      // For intermediate chunks, just write files but don't commit/push
      // The files will be included when the last chunk commits
      console.log(
        `📝 [Bridge Push] Chunk ${(chunkIndex || 0) + 1}/${
          totalChunks || 1
        }: Wrote ${writtenFiles} files (will commit on last chunk)`
      );
    }

    // CRITICAL: Only retrieve refs if we actually committed and pushed
    // Intermediate chunks don't commit, so their refs would be stale (from before this push)
    // Only the final chunk should return refs after successfully committing all accumulated files
    let refs: Array<{ ref: string; commit: string }> = [];
    if (shouldCommit) {
      // CRITICAL: Get commit SHAs immediately after push (no need to wait for bridge)
      // This allows us to publish state event immediately with real commit SHAs
      // Format: refs/heads/main abc123... or refs/tags/v1.0.0 def456...
      try {
        const { stdout: refsOutput } = await execAsync(
          `git --git-dir="${repoPath}" for-each-ref --format="%(refname) %(objectname)" refs/heads/ refs/tags/`,
          { timeout: 5000 }
        );

        if (refsOutput.trim()) {
          const lines = refsOutput.trim().split("\n");
          for (const line of lines) {
            const parts = line.trim().split(/\s+/);
            if (parts.length >= 2 && parts[0] && parts[1]) {
              refs.push({
                ref: parts[0],
                commit: parts[1],
              });
            }
          }
        }
        console.log(
          `✅ [Bridge Push] Got ${refs.length} refs with commit SHAs immediately after push`
        );
      } catch (refsError: any) {
        console.warn(
          `⚠️ [Bridge Push] Failed to get refs after push (non-critical):`,
          refsError?.message
        );
        // Non-critical - we can still return success, client can query refs later
      }
    } else {
      // Intermediate chunk: Don't retrieve refs - they would be stale (from before this push)
      // The final chunk will retrieve refs after committing all accumulated files
      console.log(
        `📝 [Bridge Push] Chunk ${(chunkIndex || 0) + 1}/${
          totalChunks || 1
        }: Skipping refs retrieval (intermediate chunk, not committed yet)`
      );
    }

    // CRITICAL: Clean up shared working directory ONLY after last chunk completes
    // DO NOT clean up after intermediate chunks - they need the directory for subsequent chunks
    if (isChunked && pushSessionId && chunkIndex === totalChunks - 1) {
      // Only clean up after the final chunk (last chunk index = totalChunks - 1)
      try {
        if (tempDir && existsSync(tempDir)) {
          await rm(tempDir, { recursive: true, force: true });
          console.log(
            `🧹 [Bridge Push] Cleaned up shared working directory after final chunk ${
              chunkIndex + 1
            }/${totalChunks}`
          );
        }
      } catch (cleanupError: any) {
        console.warn(
          `⚠️ [Bridge Push] Failed to clean up working directory:`,
          cleanupError?.message
        );
        // Non-critical - temp directory will be cleaned up by OS eventually
      }
    }

    return res.status(200).json({
      success: true,
      message: "Bridge push completed",
      missingFiles,
      pushedFiles: writtenFiles,
      refs, // Return commit SHAs immediately - no need to wait for bridge or query relays
    });
  } catch (error: any) {
    console.error("❌ Bridge push failed:", error);

    // CRITICAL: Clean up shared working directory on error ONLY for:
    // 1. Non-chunked pushes (single push, no retry needed)
    // 2. Last chunk of chunked push (push is done, failed or not)
    // DO NOT clean up for intermediate chunks - they might be retried or subsequent chunks need the directory
    const isLastChunk =
      isChunked &&
      chunkIndex !== undefined &&
      totalChunks !== undefined &&
      chunkIndex === totalChunks - 1;
    const shouldCleanupOnError = !isChunked || isLastChunk;

    if (
      shouldCleanupOnError &&
      pushSessionId &&
      tempDir &&
      existsSync(tempDir)
    ) {
      try {
        await rm(tempDir, { recursive: true, force: true });
        const chunkInfo = isChunked
          ? ` (chunk ${(chunkIndex || 0) + 1}/${totalChunks || 1})`
          : "";
        console.log(
          `🧹 [Bridge Push] Cleaned up working directory after error${chunkInfo}`
        );
      } catch (cleanupError: any) {
        console.warn(
          `⚠️ [Bridge Push] Failed to clean up working directory after error:`,
          cleanupError?.message
        );
      }
    } else if (isChunked && !isLastChunk) {
      // Intermediate chunk error - don't clean up, allow retry or subsequent chunks
      console.log(
        `📝 [Bridge Push] Intermediate chunk error - keeping working directory for retry/subsequent chunks`
      );
    }

    return res.status(500).json({
      error: error?.message || "Bridge push failed",
      missingFiles,
    });
  } finally {
    // CRITICAL: Only clean up temp directory if it's NOT a shared working directory for chunked pushes
    // Shared working directories are cleaned up after the last chunk or on error
    if (tempDir && !(isChunked && pushSessionId)) {
      try {
        await rm(tempDir, { recursive: true, force: true });
      } catch (cleanupError) {
        console.warn("Failed to clean temp directory:", cleanupError);
      }
    }
  }
}
