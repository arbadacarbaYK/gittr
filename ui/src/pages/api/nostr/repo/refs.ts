import type { NextApiRequest, NextApiResponse } from "next";
import { setCorsHeaders, handleOptionsRequest } from "@/lib/api/cors";
import { exec } from "child_process";
import { promisify } from "util";
import { join } from "path";
import { existsSync, readFileSync } from "fs";
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
        // Continue to next config path
      }
    }
  }

  return reposDir || "/home/git-nostr/git-nostr-repositories";
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Handle OPTIONS request for CORS
  if (req.method === "OPTIONS") {
    handleOptionsRequest(res);
    return;
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { ownerPubkey: ownerPubkeyInput, repo: repoName } = req.query;

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

  // Use same directory resolution as push endpoint for consistency
  const reposDir = await resolveReposDir();
  const repoPath = join(reposDir, ownerPubkey, `${repoName}.git`);

  try {
    if (!existsSync(repoPath)) {
      return res.status(404).json({ 
        error: "Repository not found",
        hint: "Repository may not be cloned yet by git-nostr-bridge"
      });
    }

    // Get all refs (branches and tags)
    // Format: refs/heads/main abc123... or refs/tags/v1.0.0 def456...
    const { stdout: refsOutput } = await execAsync(
      `git --git-dir="${repoPath}" for-each-ref --format="%(refname) %(objectname)" refs/heads/ refs/tags/`,
      { timeout: 5000 }
    );

    const refs: Array<{ ref: string; commit: string }> = [];
    
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

    return res.status(200).json({ refs });
  } catch (error: any) {
    console.error("❌ [Refs API] Error:", error);
    return res.status(500).json({ 
      error: "Failed to fetch refs",
      message: error?.message || "Unknown error"
    });
  }
}

