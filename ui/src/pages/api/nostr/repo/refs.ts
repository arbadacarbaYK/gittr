import type { NextApiRequest, NextApiResponse } from "next";
import { setCorsHeaders, handleOptionsRequest } from "@/lib/api/cors";
import { exec } from "child_process";
import { promisify } from "util";
import { join } from "path";
import { existsSync, readFileSync } from "fs";

const execAsync = promisify(exec);

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

  const { ownerPubkey, repo: repoName } = req.query;

  if (!ownerPubkey || typeof ownerPubkey !== "string" || !/^[0-9a-f]{64}$/i.test(ownerPubkey)) {
    return res.status(400).json({ error: "Invalid ownerPubkey (must be 64-char hex)" });
  }

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

