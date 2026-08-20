import { handleOptionsRequest, setCorsHeaders } from "@/lib/api/cors";
import {
  detectBareRepoDefaultBranch,
  listBareRepoBranches,
} from "@/lib/git/bare-repo-default-branch";
import { fileBytesLookLikeText } from "@/lib/git/file-bytes-look-like-text";
import { assertRepoReadAccess } from "@/lib/repo-read-access";
import { isAbsurdRepoPath } from "@/lib/repos/repo-path-sanity";
import { resolveBridgeRepoPath } from "@/lib/utils/sanitize-bridge-repo-name";

import { exec } from "child_process";
import { existsSync } from "fs";
import type { NextApiRequest, NextApiResponse } from "next";
import { nip05, nip19 } from "nostr-tools";
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

  if (isAbsurdRepoPath(decodedFilePath)) {
    return res.status(400).json({
      error: "Invalid path",
      details: "Path is too deep or looks like a nested link loop",
    });
  }

  // CRITICAL: Resolve ownerPubkey (supports hex, npub, or NIP-05 format)
  // This allows other Nostr git clients to use NIP-05 format (e.g., user@example.com)
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

  const resolvedPath = resolveBridgeRepoPath(reposDir, ownerPubkey, repoName);
  if (!resolvedPath) {
    return res.status(400).json({
      error: "Invalid repository name",
      details:
        "Repo names must match the bridge rules (no spaces, slashes, or traversal).",
    });
  }
  const repoPath = resolvedPath.repoPath;

  // Private repos: only owner/contributors may read (same ACL as SSH).
  const access = await assertRepoReadAccess(
    req,
    ownerPubkey,
    resolvedPath.repoName
  );
  if (!access.ok) {
    return res.status(access.status).json({ error: access.error });
  }

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

    // Match /api/nostr/repo/files: remap missing main/master to bare HEAD / heads
    // (foreign mirrors often have only feature branches like docs/asphazel).
    const detectedDefault = await detectBareRepoDefaultBranch(repoPath);
    const availableBranches = await listBareRepoBranches(repoPath);
    const branchCandidates = [
      branchStr,
      ...(branchStr === "main"
        ? ["master"]
        : branchStr === "master"
        ? ["main"]
        : ["main", "master"]),
      detectedDefault,
      ...availableBranches,
    ]
      .map((b) => (typeof b === "string" ? b.trim() : ""))
      .filter((b): b is string => !!b)
      .filter((b, i, arr) => arr.indexOf(b) === i);

    let stdout: Buffer | string = Buffer.alloc(0);
    let stderr = "";
    let actualBranch = branchStr;
    let found = false;

    for (const candidate of branchCandidates) {
      try {
        await execAsync(
          `git --git-dir="${repoPath}" rev-parse --verify ${JSON.stringify(
            candidate
          )}^{commit}`,
          { timeout: 5000 }
        );
      } catch {
        continue;
      }

      try {
        const escapedBranch = candidate.replace(/"/g, '\\"');
        const result = await execAsync(
          `git --git-dir="${repoPath}" show "${escapedBranch}:${escapedFilePath}"`,
          {
            timeout: 10000,
            maxBuffer: 10 * 1024 * 1024,
            encoding: "buffer" as any,
          }
        );
        stdout = normalizeStdout(result.stdout);
        stderr = execErrToString(result.stderr);
        if (hasStdoutBytes(stdout)) {
          actualBranch = candidate;
          found = true;
          if (candidate !== branchStr) {
            console.log(
              `✅ file-content: '${filePathStr}' via branch '${candidate}' (requested '${branchStr}')`
            );
          }
          break;
        }
      } catch (error: any) {
        stderr = execErrToString(error.stderr ?? error.message ?? error);
        stdout = normalizeStdout(error.stdout);
        if (hasStdoutBytes(stdout)) {
          actualBranch = candidate;
          found = true;
          console.log(
            `✅ file-content: '${filePathStr}' via '${candidate}' (stdout despite stderr)`
          );
          break;
        }
        // Branch exists but path missing — try next candidate (e.g. main empty, tip elsewhere)
      }
    }

    if (!found || !hasStdoutBytes(stdout)) {
      return res.status(404).json({
        error: "File not found in any branch",
        path: filePath,
        branch: branchStr,
        triedBranches: branchCandidates,
        defaultBranch: detectedDefault || availableBranches[0] || null,
        availableBranches,
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
    const looksText = fileBytesLookLikeText(new Uint8Array(buffer));
    const isBinary =
      (hasNullBytes || isBinaryByExt || !looksText) && !isTextByExt;

    if (isBinary) {
      const base64Content = buffer.toString("base64");
      return res.status(200).json({
        content: base64Content,
        path: filePath,
        branch: actualBranch,
        isBinary: true,
      });
    }
    return res.status(200).json({
      content: buffer.toString("utf8"),
      path: filePath,
      branch: actualBranch,
      isBinary: false,
    });
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
