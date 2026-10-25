import { rateLimiters } from "@/app/api/middleware/rate-limit";
import { handleOptionsRequest, setCorsHeaders } from "@/lib/api/cors";
import { readBareCommitDiff } from "@/lib/git/commit-patch";
import { assertRepoReadAccess } from "@/lib/repo-read-access";
import { resolveBridgeRepoPath } from "@/lib/utils/sanitize-bridge-repo-name";

import { existsSync } from "fs";
import type { NextApiRequest, NextApiResponse } from "next";
import { nip05, nip19 } from "nostr-tools";

/**
 * File diff for one commit on the requested branch.
 *
 * GET /api/nostr/repo/commit-diff?ownerPubkey=&repo=&sha=&branch=
 *
 * The SHA must be reachable from refs/heads/<branch>. A missing branch does
 * not fall back to master — that was painting another line of history as if
 * it were the branch the viewer picked.
 */
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
      } catch {
        /* next config path */
      }
    }
  }

  return reposDir || "/home/git-nostr/git-nostr-repositories";
}

function queryString(q: string | string[] | undefined): string {
  if (typeof q === "string") return q;
  if (Array.isArray(q) && q[0]) return q[0];
  return "";
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

  const rateLimitResult = await rateLimiters.api(req as any);
  if (rateLimitResult) {
    return res.status(429).json(JSON.parse(await rateLimitResult.text()));
  }

  const ownerPubkeyInput = queryString(req.query.ownerPubkey);
  const repoName = queryString(req.query.repo);
  const sha = queryString(req.query.sha);
  const branch = queryString(req.query.branch);

  if (!ownerPubkeyInput) {
    return res.status(400).json({ error: "ownerPubkey is required" });
  }
  if (!repoName) {
    return res.status(400).json({ error: "Invalid repo name" });
  }
  if (!sha) {
    return res.status(400).json({ error: "sha is required", code: "bad_sha" });
  }

  const resolved = await resolveOwnerPubkey(ownerPubkeyInput);
  if (resolved.error || !resolved.pubkey) {
    return res.status(400).json({
      error: resolved.error || "Failed to resolve ownerPubkey",
    });
  }

  const reposDir = await resolveReposDir();
  const resolvedPath = resolveBridgeRepoPath(
    reposDir,
    resolved.pubkey,
    repoName
  );
  if (!resolvedPath) {
    return res.status(400).json({
      error: "Invalid repository name",
    });
  }

  const access = await assertRepoReadAccess(
    req,
    resolved.pubkey,
    resolvedPath.repoName
  );
  if (!access.ok) {
    return res.status(access.status).json({ error: access.error });
  }

  if (!existsSync(resolvedPath.repoPath)) {
    return res.status(404).json({
      ok: false,
      code: "missing_commit",
      error: "Repository not found",
    });
  }

  const diff = await readBareCommitDiff({
    repoPath: resolvedPath.repoPath,
    sha,
    branch,
  });

  if (!diff.ok) {
    const status =
      diff.code === "bad_sha" || diff.code === "bad_branch"
        ? 400
        : diff.code === "too_large"
        ? 413
        : diff.code === "git_error"
        ? 500
        : 404;
    return res.status(status).json({
      ok: false,
      code: diff.code,
      error: diff.message,
    });
  }

  return res.status(200).json({
    ok: true,
    sha: diff.sha,
    branch: diff.branch,
    files: diff.files,
  });
}
