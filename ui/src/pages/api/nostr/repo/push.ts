import type { NextApiRequest, NextApiResponse } from "next";
import { setCorsHeaders, handleOptionsRequest } from "@/lib/api/cors";
import { rateLimiters } from "@/app/api/middleware/rate-limit";
import { promisify } from "util";
import { exec } from "child_process";
import { existsSync, readFileSync } from "fs";
import { mkdtemp, writeFile, mkdir, rm } from "fs/promises";
import { dirname, join, normalize } from "path";
import os from "os";

const execAsync = promisify(exec);

interface IncomingFile {
  path: string;
  content?: string;
  isBinary?: boolean;
}

const sanitizePath = (input: string): string => {
  const normalized = normalize(input).replace(/\\/g, "/");
  const trimmed = normalized.replace(/^(\.\/)+/, "");
  const parts = trimmed.split("/").filter((part) => part && part !== "." && part !== "..");
  return parts.join("/");
};

async function resolveReposDir(): Promise<string> {
  let reposDir =
    process.env.GIT_NOSTR_BRIDGE_REPOS_DIR ||
    process.env.REPOS_DIR ||
    process.env.GITNOSTR_REPOS_DIR;

  if (!reposDir) {
    const configPaths = [
      process.env.HOME ? `${process.env.HOME}/.config/git-nostr/git-nostr-bridge.json` : null,
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
        console.warn(`⚠️ Failed to read git-nostr config from ${configPath}:`, error);
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

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === "OPTIONS") {
    handleOptionsRequest(res);
    return;
  }

  setCorsHeaders(res);

  const rateLimitResult = await rateLimiters.api(req as any);
  if (rateLimitResult) {
    return res.status(429).json(JSON.parse(await rateLimitResult.text()));
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { ownerPubkey: ownerPubkeyInput, repo: repoName, branch = "main", files, commitDate } = req.body || {};

  // CRITICAL: Support both hex pubkey (64-char) and npub format (NIP-19)
  // The bridge stores repos by hex pubkey in filesystem, so we decode npub if needed
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
      if (decoded.type === "npub" && typeof decoded.data === "string" && decoded.data.length === 64) {
        ownerPubkey = decoded.data.toLowerCase();
      } else {
        return res.status(400).json({ error: "Invalid npub format" });
      }
    } catch (error: any) {
      return res.status(400).json({ error: `Failed to decode npub: ${error?.message || "invalid format"}` });
    }
  } else {
    return res.status(400).json({ 
      error: "ownerPubkey must be a 64-char hex string or npub (NIP-19 format)",
      received: ownerPubkeyInput.length === 8 ? "8-char prefix" : ownerPubkeyInput.startsWith("npub") ? "npub (decoding failed)" : `invalid format (${ownerPubkeyInput.length} chars)`
    });
  }

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
  const commitTimestamp = commitDate && typeof commitDate === "number" && commitDate > 0
    ? commitDate
    : Math.floor(Date.now() / 1000);

  const reposDir = await resolveReposDir();
  const repoPath = join(reposDir, ownerPubkey, `${repoName}.git`);

  // CRITICAL: Log bridge push parameters for debugging
  console.log(`📤 [Bridge Push] Starting push:`, {
    ownerPubkey: ownerPubkey ? `${ownerPubkey.substring(0, 8)}...` : 'none',
    repoName,
    branch,
    filesCount: files.length,
    commitTimestamp,
    reposDir,
    repoPath,
    filesWithContent: files.filter((f: any) => f.content && f.content.length > 0).length,
    filesWithoutContent: files.filter((f: any) => !f.content || f.content.length === 0).length,
  });

  let tempDir: string | null = null;
  const missingFiles: string[] = [];

  try {
    await execAsync(`mkdir -p "${join(reposDir, ownerPubkey)}"`);
    if (!existsSync(repoPath)) {
      await execAsync(`git init --bare "${repoPath}"`);
      // CRITICAL: Set HEAD to the branch we'll push (usually "main")
      // This ensures git log and other commands work immediately
      await execAsync(`git --git-dir="${repoPath}" symbolic-ref HEAD refs/heads/${branch}`);
      
      // CRITICAL: Set ownership to www-data:www-data so fcgiwrap (git-http-backend) can access it
      // This is required for HTTPS git clones to work via git.gittr.space
      // On local dev, this might fail if www-data doesn't exist, which is fine
      try {
        await execAsync(`chown -R www-data:www-data "${repoPath}"`);
        console.log(`✅ Set ownership to www-data:www-data for ${repoPath}`);
      } catch (chownError: any) {
        // On local dev, www-data might not exist - that's okay
        console.warn(`⚠️ Failed to set ownership to www-data (this is OK for local dev):`, chownError?.message);
      }
    }

    tempDir = await mkdtemp(join(os.tmpdir(), "gittr-push-"));
    await execAsync(`git init "${tempDir}"`);
    await execAsync(`git -C "${tempDir}" config user.name "gittr push"`);
    await execAsync(`git -C "${tempDir}" config user.email "push@gittr.space"`);

    // CRITICAL: If no files provided but repo exists, copy existing files from repo
    // This ensures empty commits preserve the previous state (gitworkshop.dev needs files to display)
    if (files.length === 0 && existsSync(repoPath)) {
      console.log(`📋 [Bridge Push] No files provided, copying existing files from repo to preserve state...`);
      try {
        // Clone the bare repo to get all files into working tree
        const cloneTempDir = await mkdtemp(join(os.tmpdir(), "gittr-clone-"));
        await execAsync(`git clone "${repoPath}" "${cloneTempDir}"`);
        // Copy all files (except .git) from cloned repo to temp dir
        await execAsync(`rsync -a --exclude='.git' "${cloneTempDir}/" "${tempDir}/"`);
        // Clean up clone temp dir
        await execAsync(`rm -rf "${cloneTempDir}"`);
        console.log(`✅ [Bridge Push] Copied existing files from repo`);
      } catch (cloneError: any) {
        console.warn(`⚠️ [Bridge Push] Failed to copy existing files, will create empty commit:`, cloneError?.message);
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
      await mkdir(dirname(targetPath), { recursive: true });

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
        }
      }
    );
    await execAsync(`git -C "${tempDir}" branch -M ${branch}`);
    await execAsync(`git -C "${tempDir}" remote add origin "${repoPath}"`);
    
    // CRITICAL: Add the bare repo to git's safe.directory before pushing
    // This prevents "dubious ownership" errors when pushing from temp dir to www-data-owned repo
    try {
      await execAsync(`git config --system --add safe.directory "${repoPath}"`);
      console.log(`✅ Added ${repoPath} to git safe.directory`);
    } catch (safeDirError: any) {
      // If system config fails, try global for the current user
      console.warn(`⚠️ Failed to add to system safe.directory, trying global:`, safeDirError?.message);
      try {
        await execAsync(`git config --global --add safe.directory "${repoPath}"`);
        console.log(`✅ Added ${repoPath} to git global safe.directory`);
      } catch (globalError: any) {
        console.warn(`⚠️ Failed to add to global safe.directory (may cause push errors):`, globalError?.message);
      }
    }
    
    await execAsync(`git -C "${tempDir}" push --force origin ${branch}`);
    
    // CRITICAL: Update HEAD in bare repo to point to the branch we just pushed
    // This ensures git log and other commands work correctly
    await execAsync(`git --git-dir="${repoPath}" symbolic-ref HEAD refs/heads/${branch}`);
    
    // CRITICAL: Ensure ownership is correct after push (in case repo already existed)
    // Set ownership to www-data:www-data so fcgiwrap (git-http-backend) can access it
    // This is required for HTTPS git clones to work via git.gittr.space
    // On local dev, this might fail if www-data doesn't exist, which is fine
    try {
      await execAsync(`chown -R www-data:www-data "${repoPath}"`);
      console.log(`✅ Set ownership to www-data:www-data for ${repoPath} (after push)`);
    } catch (chownError: any) {
      // On local dev, www-data might not exist - that's okay
      console.warn(`⚠️ Failed to set ownership to www-data (this is OK for local dev):`, chownError?.message);
    }

    // CRITICAL: Get commit SHAs immediately after push (no need to wait for bridge)
    // This allows us to publish state event immediately with real commit SHAs
    // Format: refs/heads/main abc123... or refs/tags/v1.0.0 def456...
    let refs: Array<{ ref: string; commit: string }> = [];
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
      console.log(`✅ [Bridge Push] Got ${refs.length} refs with commit SHAs immediately after push`);
    } catch (refsError: any) {
      console.warn(`⚠️ [Bridge Push] Failed to get refs after push (non-critical):`, refsError?.message);
      // Non-critical - we can still return success, client can query refs later
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
    return res.status(500).json({
      error: error?.message || "Bridge push failed",
      missingFiles,
    });
  } finally {
    if (tempDir) {
      try {
        await rm(tempDir, { recursive: true, force: true });
      } catch (cleanupError) {
        console.warn("Failed to clean temp directory:", cleanupError);
      }
    }
  }
}

