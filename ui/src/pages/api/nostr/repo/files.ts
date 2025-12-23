import type { NextApiRequest, NextApiResponse } from "next";
import { setCorsHeaders, handleOptionsRequest } from "@/lib/api/cors";
import { exec } from "child_process";
import { promisify } from "util";
import { join } from "path";
import { existsSync, readdirSync, statSync, readFileSync } from "fs";
import { nip19, nip05 } from "nostr-tools";

const execAsync = promisify(exec);

/**
 * Resolves an entity (npub, NIP-05, or hex pubkey) to a full 64-char hex pubkey
 * This allows bridge API endpoints to accept NIP-05 format (e.g., geek@primal.net)
 * for compatibility with gitworkshop.dev
 */
async function resolveOwnerPubkey(ownerPubkeyInput: string): Promise<{ pubkey: string; error?: string }> {
  // If already a full hex pubkey, return it
  if (/^[0-9a-f]{64}$/i.test(ownerPubkeyInput)) {
    return { pubkey: ownerPubkeyInput.toLowerCase() };
  }
  
  // If npub, decode it
  if (ownerPubkeyInput.startsWith("npub")) {
    try {
      const decoded = nip19.decode(ownerPubkeyInput);
      if (decoded.type === "npub" && typeof decoded.data === "string" && decoded.data.length === 64) {
        return { pubkey: decoded.data.toLowerCase() };
      }
      return { pubkey: "", error: "Invalid npub format" };
    } catch (error: any) {
      return { pubkey: "", error: `Failed to decode npub: ${error?.message || "invalid format"}` };
    }
  }
  
  // If NIP-05 format (contains @), resolve it
  if (ownerPubkeyInput.includes("@")) {
    try {
      const profile = await nip05.queryProfile(ownerPubkeyInput);
      if (profile?.pubkey && /^[0-9a-f]{64}$/i.test(profile.pubkey)) {
        console.log(`✅ [Bridge API] Resolved NIP-05 ${ownerPubkeyInput} to pubkey: ${profile.pubkey.slice(0, 8)}...`);
        return { pubkey: profile.pubkey.toLowerCase() };
      }
      return { pubkey: "", error: `NIP-05 ${ownerPubkeyInput} did not return a valid pubkey` };
    } catch (error: any) {
      return { pubkey: "", error: `Failed to resolve NIP-05 ${ownerPubkeyInput}: ${error?.message || "unknown error"}` };
    }
  }
  
  return { pubkey: "", error: `Invalid ownerPubkey format: must be 64-char hex, npub, or NIP-05 (received: ${ownerPubkeyInput.length} chars)` };
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
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Handle OPTIONS request for CORS
  if (req.method === "OPTIONS") {
    handleOptionsRequest(res);
    return;
  }

  // Set CORS headers
  setCorsHeaders(res);

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { ownerPubkey: ownerPubkeyInput, repo: repoName, branch = "main" } = req.query;

  // Validate inputs
  if (!ownerPubkeyInput || typeof ownerPubkeyInput !== "string") {
    return res.status(400).json({ error: "ownerPubkey is required" });
  }

  if (!repoName || typeof repoName !== "string") {
    return res.status(400).json({ error: "repo is required" });
  }

  // CRITICAL: Resolve ownerPubkey (supports hex, npub, or NIP-05 format)
  // This allows gitworkshop.dev to use NIP-05 format (e.g., geek@primal.net)
  const resolved = await resolveOwnerPubkey(ownerPubkeyInput);
  if (resolved.error || !resolved.pubkey) {
    return res.status(400).json({ 
      error: resolved.error || "Failed to resolve ownerPubkey",
      received: ownerPubkeyInput.length === 8 ? "8-char prefix" : ownerPubkeyInput.startsWith("npub") ? "npub format" : ownerPubkeyInput.includes("@") ? "NIP-05 format" : `invalid format (${ownerPubkeyInput.length} chars)`
    });
  }
  
  const ownerPubkey = resolved.pubkey;

      // Get repository directory from environment or git-nostr-bridge config file
      // Priority: env vars > config file > defaults
      let reposDir = process.env.GIT_NOSTR_BRIDGE_REPOS_DIR ||
                     process.env.REPOS_DIR ||
                     process.env.GITNOSTR_REPOS_DIR;
      
      // If not set in env, try to read from git-nostr-bridge config file
      // Try both root's home and git-nostr user's home
      if (!reposDir) {
        const configPaths = [
          process.env.HOME ? `${process.env.HOME}/.config/git-nostr/git-nostr-bridge.json` : null,
          "/home/git-nostr/.config/git-nostr/git-nostr-bridge.json"
        ].filter(Boolean) as string[];
        
        for (const configPath of configPaths) {
          try {
            if (existsSync(configPath)) {
              const configContent = readFileSync(configPath, "utf-8");
              const config = JSON.parse(configContent);
              if (config.repositoryDir) {
                // Expand ~ to home directory if present
                const homeDir = configPath.includes("/home/git-nostr") ? "/home/git-nostr" : (process.env.HOME || "");
                reposDir = config.repositoryDir.replace(/^~/, homeDir);
                console.log("📁 Using repositoryDir from config:", reposDir);
                break;
              }
            }
          } catch (error: any) {
            console.warn(`⚠️ Failed to read git-nostr-bridge config from ${configPath}:`, error.message);
          }
        }
      }
      
      // Fallback to common default locations
      if (!reposDir) {
        reposDir = process.env.HOME 
          ? `${process.env.HOME}/git-nostr-repositories`  // Most common default
          : "/tmp/gitnostr/repos";
      }
  
  // Repository path: reposDir/{ownerPubkey}/{repoName}.git
  const repoPath = join(reposDir, ownerPubkey, `${repoName}.git`);

  try {
    console.log("🔍 Checking repository path:", repoPath);
    console.log("🔍 Repository directory exists:", existsSync(reposDir));
    console.log("🔍 Owner directory exists:", existsSync(join(reposDir, ownerPubkey)));
    
    // Check if repository exists
    if (!existsSync(repoPath)) {
      console.error("❌ Repository not found at path:", repoPath);
      return res.status(404).json({ 
        error: "Repository not found",
        path: repoPath,
        reposDir,
        ownerPubkey: ownerPubkey.slice(0, 8),
        hint: "Repository may not be cloned yet by git-nostr-bridge. The bridge creates repos when it sees repository events on Nostr."
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
          message: "Repository exists but is empty (no commits yet)"
        });
      }
      
      console.log("✅ Repository has branches:", refs.trim().split("\n").length);
    } catch (refError: any) {
      console.warn("⚠️ Could not check refs:", refError.message);
      // Continue anyway - might still have files
    }

    // Use git ls-tree to get file tree (respects deletions - only shows current files)
    // This gets the actual files in the repository, not from Nostr events
    console.log(`🔍 Fetching file tree for branch: ${branch}`);
    let stdout: string, stderr: string;
    let branchNotFound = false;
    let actualBranch = branch; // Track which branch was actually used
    
    try {
      const result = await execAsync(
        `git --git-dir="${repoPath}" ls-tree -r --name-only ${branch}`,
        { timeout: 10000 }
      );
      stdout = result.stdout;
      stderr = result.stderr || "";
    } catch (error: any) {
      // execAsync throws when command fails - extract stderr from error
      stderr = error.stderr || error.message || String(error);
      stdout = error.stdout || "";
      
      // Check if this is a "branch not found" error
      if (stderr.includes("fatal: not a valid object name") || stderr.includes("fatal: Not a valid object name")) {
        branchNotFound = true;
      } else {
        // Other error - return 500
        console.error("Git ls-tree error:", stderr);
        return res.status(500).json({ error: "Failed to read repository", details: stderr });
      }
    }

    if (stderr && !stderr.includes("warning") && !stderr.includes("fatal")) {
      console.error("Git ls-tree error:", stderr);
      return res.status(500).json({ error: "Failed to read repository", details: stderr });
    }
    
    // Check if branch doesn't exist - try common branch names
    if (branchNotFound || (stderr && stderr.includes("fatal: not a valid object name"))) {
      console.warn(`⚠️ Branch ${branch} not found, trying fallback branches...`);
      
      // Try common branch names: main, master
      const fallbackBranches = branch === "main" ? ["master"] : branch === "master" ? ["main"] : ["main", "master"];
      
      for (const fallbackBranch of fallbackBranches) {
        try {
          console.log(`🔍 Trying fallback branch: ${fallbackBranch}`);
          const { stdout: fallbackStdout, stderr: fallbackStderr } = await execAsync(
            `git --git-dir="${repoPath}" ls-tree -r --name-only ${fallbackBranch}`,
            { timeout: 10000 }
          );
          
          if (!fallbackStderr || fallbackStderr.includes("warning") || !fallbackStderr.includes("fatal")) {
            const filePaths = fallbackStdout.trim().split("\n").filter(Boolean);
            console.log(`✅ Found ${filePaths.length} files in '${fallbackBranch}' branch`);
            
            // Build full file tree with directories
            const files: Array<{ type: string; path: string; size?: number }> = [];
            const dirs = new Set<string>();
            
            for (const filePath of filePaths) {
              // Add all parent directories
              const parts = filePath.split("/");
              for (let i = 1; i < parts.length; i++) {
                dirs.add(parts.slice(0, i).join("/"));
              }
              
              // Get file size
              try {
                const { stdout: sizeOutput } = await execAsync(
                  `git --git-dir="${repoPath}" cat-file -s ${fallbackBranch}:${filePath}`,
                  { timeout: 5000 }
                );
                const size = parseInt(sizeOutput.trim(), 10);
                files.push({ type: "file", path: filePath, size: isNaN(size) ? undefined : size });
              } catch {
                files.push({ type: "file", path: filePath });
              }
            }
            
            // Add directories
            for (const dirPath of Array.from(dirs).sort()) {
              files.push({ type: "dir", path: dirPath });
            }
            
            // Sort: directories first, then files
            files.sort((a, b) => {
              if (a.type !== b.type) {
                return a.type === "dir" ? -1 : 1;
              }
              return a.path.localeCompare(b.path);
            });
            
            return res.status(200).json({ files, branch: fallbackBranch });
          }
        } catch (fallbackError: any) {
          console.warn(`⚠️ Failed to fetch from '${fallbackBranch}' branch:`, fallbackError.message);
          // Continue to next fallback
        }
      }
      
      // All branches failed - return 404
      console.error("❌ All branch attempts failed");
      return res.status(404).json({ 
        error: "Branch not found",
        branch,
        triedBranches: [branch, ...fallbackBranches],
        hint: "Repository may be empty or branch doesn't exist"
      });
    }
    
    console.log("✅ Git ls-tree succeeded, parsing files...");

    // Parse file list and build tree structure
    const filePaths = stdout.trim().split("\n").filter(Boolean);
    const files: Array<{ type: string; path: string; size?: number }> = [];
    const dirs = new Set<string>();

    for (const filePath of filePaths) {
      // Add all parent directories
      const parts = filePath.split("/");
      for (let i = 1; i < parts.length; i++) {
        dirs.add(parts.slice(0, i).join("/"));
      }

      // Get file size using git cat-file
      try {
        const { stdout: sizeOutput } = await execAsync(
          `git --git-dir="${repoPath}" cat-file -s ${branch}:${filePath}`,
          { timeout: 5000 }
        );
        const size = parseInt(sizeOutput.trim(), 10);
        files.push({ type: "file", path: filePath, size: isNaN(size) ? undefined : size });
      } catch {
        // If size fetch fails, still include the file
        files.push({ type: "file", path: filePath });
      }
    }

    // Add directories
    for (const dirPath of Array.from(dirs).sort()) {
      files.push({ type: "dir", path: dirPath });
    }

    // Sort: directories first, then files
    files.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === "dir" ? -1 : 1;
      }
      return a.path.localeCompare(b.path);
    });
    
    // CRITICAL: Always return the branch used (may be different from requested branch due to fallback)
    return res.status(200).json({ files, branch: actualBranch || branch });
  } catch (error: any) {
    console.error("Error fetching repository files:", error);
    
    // Handle specific git errors
    if (error.code === "ENOENT") {
      return res.status(404).json({ 
        error: "Repository not found",
        path: repoPath
      });
    }

    if (error.message?.includes("not a git repository")) {
      return res.status(400).json({ 
        error: "Invalid git repository",
        path: repoPath
      });
    }

    if (error.message?.includes("fatal: ambiguous argument")) {
      return res.status(400).json({ 
        error: "Branch not found",
        branch,
        hint: "Try 'main' or 'master'"
      });
    }

    return res.status(500).json({ 
      error: "Failed to fetch repository files",
      details: error.message
    });
  }
}

