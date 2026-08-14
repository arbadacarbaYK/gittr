/**
 * Batch last-commit-per-path for the current folder on the selected tip/branch.
 * GET /api/nostr/repo/tree-last-commits?ownerPubkey&repo&branch&path=
 */
import { handleOptionsRequest, setCorsHeaders } from "@/lib/api/cors";
import { detectBareRepoDefaultBranch } from "@/lib/git/bare-repo-default-branch";
import {
  listBareRepoShallow,
  sanitizeRepoTreePath,
} from "@/lib/git/bare-repo-ls-tree";
import {
  type TreeLastCommitMap,
  listBareRepoTreeLastCommits,
} from "@/lib/git/bare-repo-tree-last-commits";
import { assertRepoReadAccess } from "@/lib/repo-read-access";
import { resolveBridgeRepoPath } from "@/lib/utils/sanitize-bridge-repo-name";

import { BoundedTtlCache } from "@/lib/utils/bounded-ttl-cache";

import { existsSync, readFileSync } from "fs";
import type { NextApiRequest, NextApiResponse } from "next";
import { nip05, nip19 } from "nostr-tools";

const cache = new BoundedTtlCache<{
  commits: TreeLastCommitMap;
  branch: string;
  path: string;
}>(30_000, 250);

async function resolveOwnerPubkey(
  ownerPubkeyInput: string
): Promise<{ pubkey: string; error?: string }> {
  if (/^[0-9a-f]{64}$/i.test(ownerPubkeyInput)) {
    return { pubkey: ownerPubkeyInput.toLowerCase() };
  }
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
  if (ownerPubkeyInput.includes("@")) {
    try {
      const profile = await nip05.queryProfile(ownerPubkeyInput);
      if (profile?.pubkey && /^[0-9a-f]{64}$/i.test(profile.pubkey)) {
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
    error: `Invalid ownerPubkey format`,
  };
}

async function resolveReposDir(): Promise<string> {
  let reposDir =
    process.env.GIT_NOSTR_BRIDGE_REPOS_DIR ||
    process.env.REPOS_DIR ||
    process.env.GITNOSTR_REPOS_DIR;

  if (!reposDir) {
    const configPaths = [
      "/home/git-nostr/.config/git-nostr/git-nostr-bridge.json",
      process.env.HOME
        ? `${process.env.HOME}/.config/git-nostr/git-nostr-bridge.json`
        : null,
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
      } catch {
        // continue
      }
    }
  }

  return reposDir || "/home/git-nostr/git-nostr-repositories";
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method === "OPTIONS") {
    handleOptionsRequest(res, req);
    return;
  }
  setCorsHeaders(res, req);

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const ownerPubkeyInput = String(req.query.ownerPubkey || "").trim();
  const repoName = String(req.query.repo || "").trim();
  const branchInput = String(req.query.branch || "").trim();
  const pathRaw = req.query.path;

  if (!ownerPubkeyInput || !repoName) {
    return res.status(400).json({ error: "ownerPubkey and repo are required" });
  }

  const folderPath = sanitizeRepoTreePath(pathRaw);
  if (folderPath === null) {
    return res.status(400).json({
      error: "Invalid path",
      hint: "path must be a relative repo path without '..'",
    });
  }

  const resolved = await resolveOwnerPubkey(ownerPubkeyInput);
  if (resolved.error || !resolved.pubkey) {
    return res.status(400).json({ error: resolved.error || "Invalid owner" });
  }
  const ownerPubkey = resolved.pubkey;

  const access = await assertRepoReadAccess(req, ownerPubkey, repoName);
  if (!access.ok) {
    return res.status(access.status).json({ error: access.error });
  }

  const reposDir = await resolveReposDir();
  const resolvedRepo = resolveBridgeRepoPath(reposDir, ownerPubkey, repoName);
  if (!resolvedRepo) {
    return res.status(400).json({ error: "Invalid repository name" });
  }
  const { repoPath } = resolvedRepo;
  if (!existsSync(repoPath)) {
    return res.status(404).json({ error: "Repository not found on bridge" });
  }

  let branch = branchInput || (await detectBareRepoDefaultBranch(repoPath));
  if (!branch) branch = "main";

  const cacheKey = `${ownerPubkey}:${resolvedRepo.repoName}:${branch}:${folderPath}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    return res.status(200).json(cached);
  }

  try {
    const children = await listBareRepoShallow(repoPath, branch, folderPath, {
      includeSizes: false,
      timeoutMs: 15_000,
    });
    const commits = await listBareRepoTreeLastCommits(
      repoPath,
      branch,
      children,
      { folderPath, maxCommits: 500, timeoutMs: 25_000 }
    );
    const payload = { commits, branch, path: folderPath };
    cache.set(cacheKey, payload);
    return res.status(200).json(payload);
  } catch (error: any) {
    console.error("❌ [tree-last-commits]", error?.message || error);
    return res.status(500).json({
      error: "Failed to load last commits for tree",
      details: error?.message || String(error),
    });
  }
}
