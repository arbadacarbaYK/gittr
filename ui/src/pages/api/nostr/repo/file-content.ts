import { handleOptionsRequest, setCorsHeaders } from "@/lib/api/cors";

import { exec } from "child_process";
import { existsSync } from "fs";
import type { NextApiRequest, NextApiResponse } from "next";
import { nip05, nip19 } from "nostr-tools";
import { join } from "path";
import { promisify } from "util";

const execAsync = promisify(exec);

/** child_process may return stderr/stdout as Buffer — never call .substring on it raw */
function execErrToString(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (Buffer.isBuffer(v)) return v.toString("utf8");
  if (v instanceof Uint8Array) return Buffer.from(v).toString("utf8");
  return String(v);
}

function normalizeStdout(raw: unknown): Buffer {
  if (raw == null) return Buffer.alloc(0);
  if (Buffer.isBuffer(raw)) return raw;
  if (typeof raw === "string") return Buffer.from(raw, "utf8");
  if (raw instanceof Uint8Array) return Buffer.from(raw);
  return Buffer.alloc(0);
}

function hasStdoutBytes(stdout: Buffer | string): boolean {
  if (Buffer.isBuffer(stdout)) return stdout.length > 0;
  return typeof stdout === "string" && stdout.length > 0;
}

/**
 * Resolves an entity (npub, NIP-05, or hex pubkey) to a full 64-char hex pubkey
 * This allows bridge API endpoints to accept NIP-05 format (e.g., geek@primal.net)
 * for compatibility with gitworkshop.dev
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
 * API endpoint to fetch individual file content from git-nostr-bridge
 *
 * Endpoint: GET /api/nostr/repo/file-content?ownerPubkey={pubkey}&repo={repoName}&path={filePath}&branch={branch}
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
    path: filePath,
    branch = "main",
  } = req.query;

  // Validate inputs
  if (!ownerPubkeyInput || typeof ownerPubkeyInput !== "string") {
    return res.status(400).json({ error: "ownerPubkey is required" });
  }

  if (!repoName || typeof repoName !== "string") {
    return res.status(400).json({ error: "repo is required" });
  }

  if (!filePath || typeof filePath !== "string") {
    return res.status(400).json({ error: "path is required" });
  }

  // CRITICAL: Explicitly decode file path from URL encoding to handle non-ASCII characters (Cyrillic, Chinese, etc.)
  // Next.js auto-decodes query params, but we ensure proper UTF-8 handling
  const decodedFilePath = decodeURIComponent(filePath);

  // CRITICAL: Resolve ownerPubkey (supports hex, npub, or NIP-05 format)
  // This allows gitworkshop.dev to use NIP-05 format (e.g., geek@primal.net)
  const resolved = await resolveOwnerPubkey(ownerPubkeyInput);
  if (resolved.error || !resolved.pubkey) {
    return res.status(400).json({
      error: resolved.error || "Failed to resolve ownerPubkey",
    });
  }

  const ownerPubkey = resolved.pubkey;

  // Get repository directory from environment or git-nostr-bridge config file
  // Priority: env vars > config file > defaults (same as files.ts and clone.ts)
  let reposDir =
    process.env.GIT_NOSTR_BRIDGE_REPOS_DIR ||
    process.env.REPOS_DIR ||
    process.env.GITNOSTR_REPOS_DIR;

  // If not set in env, try to read from git-nostr-bridge config file
  // Try both root's home and git-nostr user's home
  if (!reposDir) {
    const { readFileSync } = require("fs");
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

  const repoPath = join(reposDir, ownerPubkey, `${repoName}.git`);

  try {
    // Check if repository exists
    if (!existsSync(repoPath)) {
      return res.status(404).json({
        error: "Repository not found",
        path: repoPath,
        hint: "This host has no bare clone yet. Files in the UI may come from Nostr events only; push via gittr or git to populate the bridge.",
      });
    }

    // Empty bare repo (bridge created dir but no commits) — avoid git show + Buffer/stderr bugs
    try {
      await execAsync(`git --git-dir="${repoPath}" rev-parse --verify HEAD`, {
        timeout: 5000,
      });
    } catch {
      return res.status(404).json({
        error: "Repository exists but has no commits on this server",
        path: repoPath,
        hint: "Use Push to Nostr from gittr or push over git so the bridge has objects; the file tree may still show from relay metadata.",
      });
    }

    // Use git show to get file content
    // CRITICAL: Properly escape file path for git command (handle special characters, spaces, etc.)
    // Git show format: git show <branch>:<filepath>
    // The filepath needs to be properly quoted to handle spaces and special characters
    // We'll use double quotes and escape any existing quotes in the path
    // CRITICAL: Use decoded file path to ensure non-ASCII characters (Cyrillic, Chinese, etc.) are handled correctly
    const filePathStr: string = decodedFilePath;
    const branchStr: string = Array.isArray(branch)
      ? branch[0] || "main"
      : typeof branch === "string"
      ? branch
      : "main";
    if (!filePathStr) {
      return res.status(400).json({ error: "path is required" });
    }
    // CRITICAL: Properly escape file path for git command - handle quotes, but preserve UTF-8 characters
    // Git commands handle UTF-8 correctly when properly quoted
    const escapedFilePath = filePathStr.replace(/"/g, '\\"');

    // CRITICAL: Try branch fallback if initial branch fails (main -> master)
    let stdout: Buffer | string = Buffer.alloc(0),
      stderr = "";
    let actualBranch = branchStr;
    let branchNotFound = false;

    try {
      const escapedBranch = branchStr.replace(/"/g, '\\"');
      // CRITICAL: Use buffer encoding to get raw bytes (for binary detection), but ensure UTF-8 for file paths
      // The file path is already properly escaped, and git handles UTF-8 paths correctly
      const result = await execAsync(
        `git --git-dir="${repoPath}" show "${escapedBranch}:${escapedFilePath}"`,
        {
          timeout: 10000,
          maxBuffer: 10 * 1024 * 1024, // 10MB max
          encoding: "buffer" as any, // Get raw buffer to detect binary files (file path is already UTF-8)
        }
      );
      stdout = normalizeStdout(result.stdout);
      stderr = execErrToString(result.stderr);
    } catch (error: any) {
      // execAsync throws when command fails - extract stderr from error
      stderr = execErrToString(error.stderr ?? error.message ?? error);
      stdout = normalizeStdout(error.stdout);

      // CRITICAL: Check if stdout exists in error - git sometimes outputs to stderr even on success
      // If we have stdout content, treat it as success
      if (hasStdoutBytes(stdout)) {
        // We have content, treat as success (git might have warnings in stderr)
        branchNotFound = false;
        console.log(
          `✅ Got file content from '${branchStr}' branch (${
            Buffer.isBuffer(stdout) ? stdout.length : stdout.length
          } bytes, had error but stdout exists)`
        );
      } else if (
        stderr.includes("fatal: not a valid object name") ||
        stderr.includes("fatal: Not a valid object name") ||
        stderr.includes("fatal: invalid object name") ||
        stderr.includes("fatal: Invalid object name") ||
        stderr.includes("fatal: ambiguous argument")
      ) {
        // This is a "branch not found" error (git uses different error message formats)
        branchNotFound = true;
      } else {
        // Other error - might be file not found
        if (stderr && !hasStdoutBytes(stdout)) {
          return res.status(404).json({
            error: "File not found",
            path: filePath,
            branch: branchStr,
          });
        }
        // Re-throw if it's not a branch issue and no stdout
        throw error;
      }
    }

    // If branch not found, try fallback branches
    if (branchNotFound) {
      console.warn(
        `⚠️ Branch ${branchStr} not found, trying fallback branches...`
      );
      const fallbackBranches =
        branchStr === "main"
          ? ["master"]
          : branchStr === "master"
          ? ["main"]
          : ["main", "master"];

      for (const fallbackBranch of fallbackBranches) {
        try {
          console.log(
            `🔍 Trying fallback branch: ${fallbackBranch} for file: ${filePathStr}`
          );
          const escapedFallbackBranch = fallbackBranch.replace(/"/g, '\\"');
          // CRITICAL: Use buffer encoding to get raw bytes (for binary detection), but ensure UTF-8 for file paths
          const result = await execAsync(
            `git --git-dir="${repoPath}" show "${escapedFallbackBranch}:${escapedFilePath}"`,
            {
              timeout: 10000,
              maxBuffer: 10 * 1024 * 1024,
              encoding: "buffer" as any, // Get raw buffer to detect binary files (file path is already UTF-8)
            }
          );
          stdout = normalizeStdout(result.stdout);
          stderr = execErrToString(result.stderr);

          // Check if we actually got content (not just an empty buffer)
          // Note: stdout is always Buffer when encoding is 'buffer', but type is Buffer | string for compatibility
          const stdoutLength = Buffer.isBuffer(stdout)
            ? stdout.length
            : (stdout as string).length || 0;
          if (stdoutLength > 0) {
            actualBranch = fallbackBranch;
            branchNotFound = false; // Reset flag - we found the file
            console.log(
              `✅ Found file in '${fallbackBranch}' branch (${stdoutLength} bytes)`
            );
            break; // Success - exit loop
          } else {
            console.warn(
              `⚠️ Fallback branch '${fallbackBranch}' returned empty content`
            );
            // Continue to next fallback
          }
        } catch (fallbackError: any) {
          const fallbackStderr = execErrToString(
            fallbackError.stderr ??
              fallbackError.message ??
              fallbackError
          );
          const fallbackStdout = normalizeStdout(fallbackError.stdout);
          console.warn(
            `⚠️ Failed to fetch from '${fallbackBranch}' branch:`,
            fallbackStderr.slice(0, 200)
          );

          // If the error has stdout, it might still be valid (some git commands output to stderr even on success)
          // Also check if the error message indicates branch not found (we should try next fallback)
          const isBranchError =
            fallbackStderr.includes("fatal: not a valid object name") ||
            fallbackStderr.includes("fatal: Not a valid object name") ||
            fallbackStderr.includes("fatal: invalid object name") ||
            fallbackStderr.includes("fatal: Invalid object name") ||
            fallbackStderr.includes("fatal: ambiguous argument");

          if (hasStdoutBytes(fallbackStdout)) {
            stdout = fallbackStdout;
            actualBranch = fallbackBranch;
            branchNotFound = false;
            console.log(
              `✅ Found file in '${fallbackBranch}' branch (from error stdout, ${
                Buffer.isBuffer(fallbackStdout)
                  ? fallbackStdout.length
                  : fallbackStdout.length
              } bytes)`
            );
            break;
          } else if (!isBranchError) {
            // Not a branch error and no stdout - file doesn't exist in this branch
            console.warn(
              `⚠️ File not found in '${fallbackBranch}' branch (not a branch error)`
            );
          }
          // Continue to next fallback
        }
      }

      // If all branches failed
      if (
        branchNotFound &&
        (!hasStdoutBytes(stdout) || (stderr && stderr.includes("fatal")))
      ) {
        return res.status(404).json({
          error: "File not found in any branch",
          path: filePath,
          branch: branchStr,
          triedBranches: [branchStr, ...fallbackBranches],
        });
      }
    }

    if (stderr && !hasStdoutBytes(stdout)) {
      return res.status(404).json({
        error: "File not found",
        path: filePath,
        branch: actualBranch,
      });
    }

    // Detect if file is binary by checking for null bytes or common binary patterns
    const buffer = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout);
    const ext = filePath.split(".").pop()?.toLowerCase() || "";
    const textExts = [
      "txt",
      "md",
      "json",
      "js",
      "ts",
      "jsx",
      "tsx",
      "css",
      "html",
      "htm",
      "xml",
      "yml",
      "yaml",
      "toml",
      "ini",
      "conf",
      "log",
      "csv",
      "tsv",
      "sh",
      "bash",
      "zsh",
      "fish",
      "py",
      "rb",
      "go",
      "rs",
      "java",
      "c",
      "cpp",
      "h",
      "hpp",
      "sql",
      "r",
      "m",
      "swift",
      "kt",
      "scala",
      "clj",
      "hs",
      "elm",
      "ex",
      "exs",
      "erl",
      "hrl",
      "ml",
      "mli",
      "fs",
      "fsx",
      "vb",
      "cs",
      "dart",
      "lua",
      "vim",
      "vimrc",
      "gitignore",
      "gitattributes",
      "dockerfile",
      "makefile",
      "cmake",
      "gradle",
      "maven",
      "pom",
      "sbt",
      "build",
      "rakefile",
      "gemfile",
      "podfile",
      "cartfile",
    ];
    const binaryExts = [
      "png",
      "jpg",
      "jpeg",
      "gif",
      "webp",
      "svg",
      "ico",
      "pdf",
      "woff",
      "woff2",
      "ttf",
      "otf",
      "eot",
      "mp4",
      "mp3",
      "wav",
      "avi",
      "mov",
      "zip",
      "tar",
      "gz",
      "bz2",
      "xz",
      "7z",
      "rar",
      "exe",
      "dll",
      "so",
      "dylib",
      "bin",
    ];

    // Check for null bytes (indicates binary file)
    const hasNullBytes = buffer.includes(0);
    const isBinaryByExt = binaryExts.includes(ext);
    const isTextByExt = textExts.includes(ext);

    // Determine if binary: has null bytes OR is binary extension (but NOT text extension)
    const isBinary = (hasNullBytes || isBinaryByExt) && !isTextByExt;

    if (isBinary) {
      // For binary files, encode as base64
      const base64Content = buffer.toString("base64");
      return res.status(200).json({
        content: base64Content,
        path: filePath,
        branch: actualBranch, // Return actual branch used
        isBinary: true,
      });
    } else {
      // For text files, return as UTF-8 string
      // Try to decode as UTF-8, fallback to base64 if it fails
      try {
        const textContent = buffer.toString("utf8");
        // Check if decoded content is valid UTF-8 text (no control characters except common ones)
        if (/[\x00-\x08\x0E-\x1F]/.test(textContent)) {
          // Contains control characters, likely binary - encode as base64
          const base64Content = buffer.toString("base64");
          return res.status(200).json({
            content: base64Content,
            path: filePath,
            branch: actualBranch, // Return actual branch used
            isBinary: true,
          });
        }
        return res.status(200).json({
          content: textContent,
          path: filePath,
          branch: actualBranch, // Return actual branch used
          isBinary: false,
        });
      } catch (e) {
        // UTF-8 decoding failed, encode as base64
        const base64Content = buffer.toString("base64");
        return res.status(200).json({
          content: base64Content,
          path: filePath,
          branch: actualBranch, // Return actual branch used
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

    if (
      error.message?.includes("fatal: Path") ||
      error.message?.includes("does not exist")
    ) {
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
