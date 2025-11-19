import type { NextApiRequest, NextApiResponse } from "next";
import { setCorsHeaders, handleOptionsRequest } from "@/lib/api/cors";
import { exec } from "child_process";
import { promisify } from "util";
import { join } from "path";
import { existsSync } from "fs";

const execAsync = promisify(exec);

/**
 * API endpoint to fetch individual file content from git-nostr-bridge
 * 
 * Endpoint: GET /api/nostr/repo/file-content?ownerPubkey={pubkey}&repo={repoName}&path={filePath}&branch={branch}
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

  const { ownerPubkey, repo: repoName, path: filePath, branch = "main" } = req.query;

  // Validate inputs
  if (!ownerPubkey || typeof ownerPubkey !== "string") {
    return res.status(400).json({ error: "ownerPubkey is required" });
  }

  if (!repoName || typeof repoName !== "string") {
    return res.status(400).json({ error: "repo is required" });
  }

  if (!filePath || typeof filePath !== "string") {
    return res.status(400).json({ error: "path is required" });
  }

  // CRITICAL: Validate ownerPubkey is full 64-char hex
  if (!/^[0-9a-f]{64}$/i.test(ownerPubkey)) {
    return res.status(400).json({ 
      error: "ownerPubkey must be a full 64-char hex pubkey",
    });
  }

  // Get repository directory from environment or git-nostr-bridge config file
  // Priority: env vars > config file > defaults (same as files.ts and clone.ts)
  let reposDir = process.env.GIT_NOSTR_BRIDGE_REPOS_DIR ||
                 process.env.REPOS_DIR ||
                 process.env.GITNOSTR_REPOS_DIR;
  
  // If not set in env, try to read from git-nostr-bridge config file
  // Try both root's home and git-nostr user's home
  if (!reposDir) {
    const { readFileSync } = require("fs");
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

  const repoPath = join(reposDir, ownerPubkey, `${repoName}.git`);

  try {
    // Check if repository exists
    if (!existsSync(repoPath)) {
      return res.status(404).json({ 
        error: "Repository not found",
        path: repoPath,
      });
    }

    // Use git show to get file content
    // CRITICAL: Properly escape file path for git command (handle special characters, spaces, etc.)
    // Git show format: git show <branch>:<filepath>
    // The filepath needs to be properly quoted to handle spaces and special characters
    // We'll use double quotes and escape any existing quotes in the path
    const filePathStr: string = Array.isArray(filePath) ? (filePath[0] || "") : (typeof filePath === "string" ? filePath : "");
    const branchStr: string = Array.isArray(branch) ? (branch[0] || "main") : (typeof branch === "string" ? branch : "main");
    if (!filePathStr) {
      return res.status(400).json({ error: "path is required" });
    }
    const escapedFilePath = filePathStr.replace(/"/g, '\\"');
    const escapedBranch = branchStr.replace(/"/g, '\\"');
    
    // CRITICAL: Use encoding=buffer to get raw buffer to detect binary files
    const { stdout, stderr } = await execAsync(
      `git --git-dir="${repoPath}" show "${escapedBranch}:${escapedFilePath}"`,
      { 
        timeout: 10000, 
        maxBuffer: 10 * 1024 * 1024, // 10MB max
        encoding: 'buffer' as any // Get raw buffer to detect binary files
      }
    );

    if (stderr && !stdout) {
      return res.status(404).json({ 
        error: "File not found",
        path: filePath,
        branch,
      });
    }

    // Detect if file is binary by checking for null bytes or common binary patterns
    const buffer = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout);
    const ext = filePath.split('.').pop()?.toLowerCase() || '';
    const textExts = ['txt', 'md', 'json', 'js', 'ts', 'jsx', 'tsx', 'css', 'html', 'htm', 'xml', 'yml', 'yaml', 'toml', 'ini', 'conf', 'log', 'csv', 'tsv', 'sh', 'bash', 'zsh', 'fish', 'py', 'rb', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'hpp', 'sql', 'r', 'm', 'swift', 'kt', 'scala', 'clj', 'hs', 'elm', 'ex', 'exs', 'erl', 'hrl', 'ml', 'mli', 'fs', 'fsx', 'vb', 'cs', 'dart', 'lua', 'vim', 'vimrc', 'gitignore', 'gitattributes', 'dockerfile', 'makefile', 'cmake', 'gradle', 'maven', 'pom', 'sbt', 'build', 'rakefile', 'gemfile', 'podfile', 'cartfile'];
    const binaryExts = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'pdf', 'woff', 'woff2', 'ttf', 'otf', 'eot', 'mp4', 'mp3', 'wav', 'avi', 'mov', 'zip', 'tar', 'gz', 'bz2', 'xz', '7z', 'rar', 'exe', 'dll', 'so', 'dylib', 'bin'];
    
    // Check for null bytes (indicates binary file)
    const hasNullBytes = buffer.includes(0);
    const isBinaryByExt = binaryExts.includes(ext);
    const isTextByExt = textExts.includes(ext);
    
    // Determine if binary: has null bytes OR is binary extension (but NOT text extension)
    const isBinary = (hasNullBytes || isBinaryByExt) && !isTextByExt;
    
    if (isBinary) {
      // For binary files, encode as base64
      const base64Content = buffer.toString('base64');
      return res.status(200).json({ 
        content: base64Content,
        path: filePath,
        branch,
        isBinary: true,
      });
    } else {
      // For text files, return as UTF-8 string
      // Try to decode as UTF-8, fallback to base64 if it fails
      try {
        const textContent = buffer.toString('utf8');
        // Check if decoded content is valid UTF-8 text (no control characters except common ones)
        if (/[\x00-\x08\x0E-\x1F]/.test(textContent)) {
          // Contains control characters, likely binary - encode as base64
          const base64Content = buffer.toString('base64');
          return res.status(200).json({ 
            content: base64Content,
            path: filePath,
            branch,
            isBinary: true,
          });
        }
        return res.status(200).json({ 
          content: textContent,
          path: filePath,
          branch,
          isBinary: false,
        });
      } catch (e) {
        // UTF-8 decoding failed, encode as base64
        const base64Content = buffer.toString('base64');
        return res.status(200).json({ 
          content: base64Content,
          path: filePath,
          branch,
          isBinary: true,
        });
      }
    }
  } catch (error: any) {
    console.error("Error fetching file content:", error);
    
    if (error.message?.includes("fatal: ambiguous argument")) {
      return res.status(400).json({ 
        error: "Branch not found",
        branch,
      });
    }

    if (error.message?.includes("fatal: Path") || error.message?.includes("does not exist")) {
      return res.status(404).json({ 
        error: "File not found",
        path: filePath,
      });
    }

    return res.status(500).json({ 
      error: "Failed to fetch file content",
      details: error.message,
    });
  }
}

