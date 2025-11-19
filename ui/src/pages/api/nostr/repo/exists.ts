import type { NextApiRequest, NextApiResponse } from "next";
import { setCorsHeaders, handleOptionsRequest } from "@/lib/api/cors";
import { readFileSync, existsSync } from "fs";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

/**
 * API endpoint to check if a repository exists in git-nostr-bridge database
 * 
 * Endpoint: GET /api/nostr/repo/exists?ownerPubkey={pubkey}&repo={repoName}
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

  const { ownerPubkey, repo: repoName } = req.query;

  // Validate inputs
  if (!ownerPubkey || typeof ownerPubkey !== "string") {
    return res.status(400).json({ error: "ownerPubkey is required" });
  }

  if (!repoName || typeof repoName !== "string") {
    return res.status(400).json({ error: "repo is required" });
  }

  // CRITICAL: Validate ownerPubkey is full 64-char hex (not npub, not 8-char prefix)
  if (!/^[0-9a-f]{64}$/i.test(ownerPubkey)) {
    return res.status(400).json({ 
      error: "ownerPubkey must be a full 64-char hex pubkey (not npub or 8-char prefix)",
      received: ownerPubkey.length === 8 ? "8-char prefix" : ownerPubkey.startsWith("npub") ? "npub format" : `invalid format (${ownerPubkey.length} chars)`
    });
  }

  // Get database path from git-nostr-bridge config file
  // Try both root's home and git-nostr user's home
  let dbPath: string | null = null;
  
  const configPaths = [
    process.env.HOME ? `${process.env.HOME}/.config/git-nostr/git-nostr-bridge.json` : null,
    "/home/git-nostr/.config/git-nostr/git-nostr-bridge.json"
  ].filter(Boolean) as string[];
  
  for (const configPath of configPaths) {
    try {
      if (existsSync(configPath)) {
        const configContent = readFileSync(configPath, "utf-8");
        const config = JSON.parse(configContent);
        if (config.DbFile) {
          // Expand ~ to home directory if present
          const homeDir = configPath.includes("/home/git-nostr") ? "/home/git-nostr" : (process.env.HOME || "");
          dbPath = config.DbFile.replace(/^~/, homeDir);
          break;
        }
      }
    } catch (error: any) {
      console.warn(`⚠️ Failed to read git-nostr-bridge config from ${configPath}:`, error.message);
    }
  }
  
  // Fallback to common default location
  if (!dbPath) {
    dbPath = process.env.HOME 
      ? `${process.env.HOME}/.config/git-nostr/git-nostr-db.sqlite`
      : null;
  }

  if (!dbPath || !existsSync(dbPath)) {
    // Return exists: false instead of 500 error - bridge may not be configured
    return res.status(200).json({ 
      exists: false,
      ownerPubkey,
      repositoryName: repoName,
      reason: "Bridge database not found"
    });
  }

  try {
    // Check if sqlite3 command is available
    try {
      await execAsync("which sqlite3", { timeout: 1000 });
    } catch {
      // sqlite3 not available - return exists: false gracefully
      return res.status(200).json({ 
        exists: false,
        ownerPubkey,
        repositoryName: repoName,
        reason: "sqlite3 command not available"
      });
    }

    // Use sqlite3 command to query database
    // Escape single quotes in ownerPubkey and repoName to prevent SQL injection
    const escapedOwnerPubkey = ownerPubkey.replace(/'/g, "''");
    const escapedRepoName = repoName.replace(/'/g, "''");
    const query = `SELECT OwnerPubKey, RepositoryName, UpdatedAt FROM Repository WHERE OwnerPubKey = '${escapedOwnerPubkey}' AND RepositoryName = '${escapedRepoName}'`;
    const command = `sqlite3 "${dbPath}" "${query}"`;
    
    try {
      const { stdout } = await execAsync(command, { timeout: 5000 });
      
      if (stdout.trim()) {
        // Parse result: OwnerPubKey|RepositoryName|UpdatedAt
        const parts = stdout.trim().split('|');
        if (parts.length >= 3 && parts[0] && parts[1] && parts[2]) {
          return res.status(200).json({
            exists: true,
            ownerPubkey: parts[0],
            repositoryName: parts[1],
            updatedAt: parseInt(parts[2], 10),
            updatedAtTime: new Date(parseInt(parts[2], 10) * 1000).toISOString()
          });
        }
      }
      
      // No result - repo doesn't exist in bridge
      return res.status(200).json({
        exists: false,
        ownerPubkey,
        repositoryName: repoName
      });
    } catch (execError: any) {
      // sqlite3 returns non-zero exit code if no rows found, but that's OK
      if (execError.code === 1 && !execError.stdout) {
        // No rows found - repo doesn't exist
        return res.status(200).json({
          exists: false,
          ownerPubkey,
          repositoryName: repoName
        });
      }
      throw execError;
    }
  } catch (error: any) {
    console.error("❌ Error checking bridge database:", error);
    return res.status(500).json({ 
      error: "Failed to check bridge database",
      message: error.message
    });
  }
}

