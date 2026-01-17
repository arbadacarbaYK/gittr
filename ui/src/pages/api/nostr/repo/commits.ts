import { handleOptionsRequest, setCorsHeaders } from "@/lib/api/cors";

import { exec } from "child_process";
import { existsSync } from "fs";
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
          const { readFileSync } = await import("fs");
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
        // Continue to next config path
      }
    }
  }

  return reposDir || "/home/git-nostr/git-nostr-repositories";
}

interface Commit {
  id: string; // commit hash
  message: string;
  author: string; // author name/email (from git config)
  authorEmail?: string;
  timestamp: number; // Unix timestamp
  branch?: string;
  parentIds?: string[];
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Handle OPTIONS request for CORS
  if (req.method === "OPTIONS") {
    handleOptionsRequest(res, req);
    return;
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const {
    ownerPubkey: ownerPubkeyInput,
    repo: repoName,
    branch,
    limit,
  } = req.query;

  if (!ownerPubkeyInput || typeof ownerPubkeyInput !== "string") {
    return res.status(400).json({ error: "ownerPubkey is required" });
  }

  // CRITICAL: Resolve ownerPubkey (supports hex, npub, or NIP-05 format)
  // This allows gitworkshop.dev to use NIP-05 format (e.g., geek@primal.net)
  const resolved = await resolveOwnerPubkey(ownerPubkeyInput);
  if (resolved.error || !resolved.pubkey) {
    return res.status(400).json({
      error: resolved.error || "Failed to resolve ownerPubkey",
    });
  }

  const ownerPubkey = resolved.pubkey;

  if (!repoName || typeof repoName !== "string") {
    return res.status(400).json({ error: "Invalid repo name" });
  }

  const branchName =
    (typeof branch === "string" ? branch : "main").trim() || "main";
  const commitLimit = limit ? parseInt(limit as string, 10) : 100;
  const safeLimit = Math.min(Math.max(commitLimit, 1), 500); // Between 1 and 500

  // Use same directory resolution as other endpoints
  const reposDir = await resolveReposDir();
  const repoPath = join(reposDir, ownerPubkey, `${repoName}.git`);

  try {
    if (!existsSync(repoPath)) {
      return res.status(404).json({
        error: "Repository not found",
        hint: "Repository may not be cloned yet by git-nostr-bridge",
      });
    }

    // Get commits using git log
    // Format: %H = full hash, %s = subject, %an = author name, %ae = author email, %at = author timestamp, %P = parent hashes
    const gitLogCommand = `git --git-dir="${repoPath}" log --format="%H|%s|%an|%ae|%at|%P" --max-count=${safeLimit} ${branchName}`;

    let stdout: string;
    try {
      const result = await execAsync(gitLogCommand, { timeout: 10000 });
      stdout = result.stdout;
    } catch (error: any) {
      // If branch doesn't exist, try main/master
      if (branchName !== "main" && branchName !== "master") {
        try {
          const fallbackCommand = `git --git-dir="${repoPath}" log --format="%H|%s|%an|%ae|%at|%P" --max-count=${safeLimit} main`;
          const fallbackResult = await execAsync(fallbackCommand, {
            timeout: 10000,
          });
          stdout = fallbackResult.stdout;
        } catch (fallbackError) {
          // Try master as last resort
          const masterCommand = `git --git-dir="${repoPath}" log --format="%H|%s|%an|%ae|%at|%P" --max-count=${safeLimit} master`;
          const masterResult = await execAsync(masterCommand, {
            timeout: 10000,
          });
          stdout = masterResult.stdout;
        }
      } else {
        throw error;
      }
    }

    const commits: Commit[] = [];

    if (stdout.trim()) {
      const lines = stdout.trim().split("\n");
      for (const line of lines) {
        const parts = line.split("|");
        if (parts.length >= 5) {
          const [
            hash,
            message,
            authorName,
            authorEmail,
            timestampStr,
            ...parentHashes
          ] = parts;

          if (hash && message && timestampStr) {
            const timestamp = parseInt(timestampStr, 10) * 1000; // Convert to milliseconds
            const parentIds =
              parentHashes.length > 0 && parentHashes[0]
                ? parentHashes[0]
                    .trim()
                    .split(/\s+/)
                    .filter((p) => p.length > 0)
                : [];

            commits.push({
              id: hash.trim(),
              message: message.trim(),
              author: authorName?.trim() || authorEmail?.trim() || "unknown",
              authorEmail: authorEmail?.trim(),
              timestamp,
              branch: branchName,
              parentIds: parentIds.length > 0 ? parentIds : undefined,
            });
          }
        }
      }
    }

    return res.status(200).json({ commits });
  } catch (error: any) {
    console.error("❌ [Commits API] Error:", error);
    return res.status(500).json({
      error: "Failed to fetch commits",
      message: error?.message || "Unknown error",
    });
  }
}
