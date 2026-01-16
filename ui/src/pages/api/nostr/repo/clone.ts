import { rateLimiters } from "@/app/api/middleware/rate-limit";
import { handleOptionsRequest, setCorsHeaders } from "@/lib/api/cors";

import { exec } from "child_process";
import { existsSync, readFileSync } from "fs";
import type { NextApiRequest, NextApiResponse } from "next";
import { nip05, nip19 } from "nostr-tools";
import { join } from "path";
import { promisify } from "util";

const execAsync = promisify(exec);

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
 * API endpoint to trigger git clone from GRASP server
 *
 * Endpoint: POST /api/nostr/repo/clone
 * Body: { cloneUrl: string, ownerPubkey: string, repo: string }
 *
 * This endpoint clones a repository from a GRASP server (HTTPS) into the git-nostr-bridge repos directory.
 * CRITICAL: ownerPubkey must be the FULL 64-char hex pubkey (not npub, not 8-char prefix)
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Handle OPTIONS request for CORS
  if (req.method === "OPTIONS") {
    handleOptionsRequest(res);
    return;
  }

  // Set CORS headers
  setCorsHeaders(res);

  // Rate limiting for API endpoints
  const rateLimitResult = await rateLimiters.api(req as any);
  if (rateLimitResult) {
    return res.status(429).json(JSON.parse(await rateLimitResult.text()));
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { cloneUrl, ownerPubkey: ownerPubkeyInput, repo: repoName } = req.body;

  // Validate inputs
  if (!cloneUrl || typeof cloneUrl !== "string") {
    return res.status(400).json({ error: "cloneUrl is required" });
  }

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

  // CRITICAL: Convert SSH URLs (git@host:owner/repo) to https:// for git clone
  // SSH format: git@github.com:owner/repo or git@github.com:owner/repo.git
  // We'll convert it to https:// for git clone
  let normalizedCloneUrl = cloneUrl;
  const sshMatch = cloneUrl.match(/^git@([^:]+):(.+)$/);
  if (sshMatch) {
    const [, host, path] = sshMatch;
    normalizedCloneUrl = `https://${host}/${path}`;
    console.log(
      `🔄 [Clone API] Converting SSH URL to HTTPS: ${normalizedCloneUrl}`
    );
  } else if (cloneUrl.startsWith("git://")) {
    // CRITICAL: Convert git:// URLs to https:// for git clone
    // git:// protocol is used by some git servers (e.g., git://jb55.com/damus)
    // Git clone command can handle both, but we normalize to https:// for consistency
    normalizedCloneUrl = cloneUrl.replace(/^git:\/\//, "https://");
    console.log(
      `🔄 [Clone API] Converting git:// to https://: ${normalizedCloneUrl}`
    );
  }

  // Validate cloneUrl is HTTPS or HTTP (after normalization)
  // GRASP servers typically use HTTPS, but some custom git servers may use HTTP
  if (
    !normalizedCloneUrl.startsWith("https://") &&
    !normalizedCloneUrl.startsWith("http://")
  ) {
    return res.status(400).json({
      error:
        "cloneUrl must be HTTPS, HTTP, git://, or SSH format (git@host:path) - will be converted to https://",
      received: cloneUrl.substring(0, 20),
    });
  }

  // Get repository directory from environment or git-nostr-bridge config file
  let reposDir =
    process.env.GIT_NOSTR_BRIDGE_REPOS_DIR ||
    process.env.REPOS_DIR ||
    process.env.GITNOSTR_REPOS_DIR;

  // If not set in env, try to read from git-nostr-bridge config file
  // Try both root's home and git-nostr user's home
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
  const repoPath = join(reposDir, ownerPubkey, `${repoName}.git`);

  try {
    // Check if repository already exists
    if (existsSync(repoPath)) {
      console.log("✅ Repository already exists at:", repoPath);
      return res.status(200).json({
        success: true,
        message: "Repository already exists",
        path: repoPath,
      });
    }

    // Ensure parent directory exists
    const parentDir = join(reposDir, ownerPubkey);
    if (!existsSync(parentDir)) {
      const { exec: execSync } = require("child_process");
      execSync(`mkdir -p "${parentDir}"`, { stdio: "inherit" });
    }

    console.log(`🔍 Cloning repository from ${cloneUrl} to ${repoPath}`);

    // Clone repository using git clone --bare (for bare repos like git-nostr-bridge uses)
    // Use normalized URL (https:// or http://) - git clone supports both
    // Note: git:// URLs have been converted to https:// above
    const { stdout, stderr } = await execAsync(
      `git clone --bare "${normalizedCloneUrl}" "${repoPath}"`,
      {
        timeout: 60000, // 60 second timeout
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer
      }
    );

    if (
      stderr &&
      !stderr.includes("Cloning into") &&
      !stderr.includes("warning")
    ) {
      console.error("Git clone stderr:", stderr);
      // Don't fail on warnings, but log them
    }

    console.log("✅ Repository cloned successfully");
    console.log("Git output:", stdout);

    // Verify repository was cloned
    if (!existsSync(repoPath)) {
      return res.status(500).json({
        error: "Clone completed but repository not found at expected path",
        path: repoPath,
      });
    }

    return res.status(200).json({
      success: true,
      message: "Repository cloned successfully",
      path: repoPath,
      cloneUrl,
    });
  } catch (error: any) {
    console.error("❌ Error cloning repository:", error);

    // Handle specific git errors
    if (
      error.message?.includes("fatal: repository") ||
      error.message?.includes("not found")
    ) {
      return res.status(404).json({
        error: "Repository not found on GRASP server",
        cloneUrl,
        details: error.message,
      });
    }

    if (error.message?.includes("timeout")) {
      return res.status(504).json({
        error: "Clone operation timed out",
        cloneUrl,
        hint: "Repository may be large or server may be slow",
      });
    }

    if (error.code === "ENOENT") {
      return res.status(500).json({
        error: "Git command not found",
        hint: "Ensure git is installed and in PATH",
      });
    }

    return res.status(500).json({
      error: "Failed to clone repository",
      cloneUrl,
      details: error.message,
    });
  }
}
