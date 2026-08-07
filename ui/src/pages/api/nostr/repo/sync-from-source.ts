/**
 * Sync the git-nostr bare mirror to an upstream forge tip (exact SHAs).
 * Used by Push to Nostr when the repo has a forge `source` and no local edits,
 * so kind 30618 announces GitHub/GitLab/… commits — not a rewritten bridge tip.
 *
 * POST /api/nostr/repo/sync-from-source
 * Body: { ownerPubkey, repo, sourceUrl, branch? }
 * Auth: same as /api/nostr/repo/push (X-Nostr-Auth-Event / Authorization)
 */
import {
  checkPushPerPubkey,
  rateLimiters,
} from "@/app/api/middleware/rate-limit";
import { handleOptionsRequest, setCorsHeaders } from "@/lib/api/cors";
import { isRateLimitExemptRequest } from "@/lib/api/rate-limit-exempt";
import { isCloneableUpstreamSourceUrl } from "@/lib/utils/detect-git-forge";
import { normalizeGithubSourceUrl } from "@/lib/utils/normalize-github-source-url";
import { resolveBridgeRepoPath } from "@/lib/utils/sanitize-bridge-repo-name";

import { exec } from "child_process";
import { existsSync, readFileSync } from "fs";
import type { NextApiRequest, NextApiResponse } from "next";
import { mkdir, rm } from "fs/promises";
import { dirname } from "path";
import { promisify } from "util";

import { verifyNostrAuth, verifySSHKeyOwnership } from "./push-auth";

const execAsync = promisify(exec);

const shellQuote = (value: string): string =>
  `'${value.replace(/'/g, `'\"'\"'`)}'`;

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

function normalizeCloneUrl(sourceUrl: string): string {
  let url = normalizeGithubSourceUrl(sourceUrl) || sourceUrl.trim();
  const sshMatch = url.match(/^git@([^:]+):(.+)$/);
  if (sshMatch) {
    url = `https://${sshMatch[1]}/${sshMatch[2]}`;
  } else if (url.startsWith("git://")) {
    url = url.replace(/^git:\/\//, "https://");
  }
  if (!url.endsWith(".git")) {
    url = `${url}.git`;
  }
  return url;
}

async function listRefs(
  repoPath: string
): Promise<Array<{ ref: string; commit: string }>> {
  try {
    const { stdout } = await execAsync(
      `git --git-dir=${shellQuote(repoPath)} show-ref --heads --tags`,
      { timeout: 30000 }
    );
    const out: Array<{ ref: string; commit: string }> = [];
    for (const line of stdout.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const [commit, ref] = trimmed.split(/\s+/);
      if (ref && commit && /^[0-9a-f]{40}$/i.test(commit)) {
        out.push({ ref, commit });
      }
    }
    return out;
  } catch {
    return [];
  }
}

async function resolveDefaultBranch(
  repoPath: string,
  preferred?: string
): Promise<string> {
  if (preferred && preferred.trim()) return preferred.trim();
  try {
    const { stdout } = await execAsync(
      `git --git-dir=${shellQuote(repoPath)} symbolic-ref --short HEAD`,
      { timeout: 10000 }
    );
    const b = stdout.trim();
    if (b) return b;
  } catch {
    // fall through
  }
  return "main";
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

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const {
    ownerPubkey: ownerPubkeyInput,
    repo: repoName,
    sourceUrl: sourceUrlInput,
    branch: branchInput,
  } = req.body || {};

  if (!ownerPubkeyInput || typeof ownerPubkeyInput !== "string") {
    return res.status(400).json({ error: "ownerPubkey is required" });
  }
  if (!repoName || typeof repoName !== "string") {
    return res.status(400).json({ error: "repo is required" });
  }
  if (!sourceUrlInput || typeof sourceUrlInput !== "string") {
    return res.status(400).json({ error: "sourceUrl is required" });
  }

  const normalizedSource = normalizeGithubSourceUrl(sourceUrlInput) || sourceUrlInput.trim();
  if (!isCloneableUpstreamSourceUrl(normalizedSource)) {
    return res.status(400).json({
      error: "sourceUrl must be a cloneable forge URL (GitHub/GitLab/Codeberg/Gitea/…)",
    });
  }

  let ownerPubkey = ownerPubkeyInput.trim().toLowerCase();
  if (ownerPubkey.startsWith("npub")) {
    try {
      const { nip19 } = await import("nostr-tools");
      const decoded = nip19.decode(ownerPubkeyInput);
      if (
        decoded.type === "npub" &&
        typeof decoded.data === "string" &&
        /^[0-9a-f]{64}$/i.test(decoded.data)
      ) {
        ownerPubkey = decoded.data.toLowerCase();
      } else {
        return res.status(400).json({ error: "Invalid npub" });
      }
    } catch {
      return res.status(400).json({ error: "Failed to decode npub" });
    }
  } else if (!/^[0-9a-f]{64}$/i.test(ownerPubkey)) {
    return res.status(400).json({ error: "ownerPubkey must be hex or npub" });
  }

  const reposDir = await resolveReposDir();
  const resolvedRepo = resolveBridgeRepoPath(reposDir, ownerPubkey, repoName);
  if (!resolvedRepo) {
    return res.status(400).json({ error: "Invalid repository name" });
  }
  const { repoPath, repoName: safeRepoName } = resolvedRepo;
  const cloneUrl = normalizeCloneUrl(normalizedSource);

  const authResult = await verifyNostrAuth(req, {
    expectedRepo: safeRepoName,
  });
  if (!authResult.authorized) {
    return res.status(401).json({
      error: "Authentication required",
      details: authResult.error,
    });
  }

  const ownershipCheck = await verifySSHKeyOwnership(
    authResult.pubkey!,
    ownerPubkey
  );
  if (!ownershipCheck.authorized) {
    return res.status(403).json({
      error: "Access denied",
      details: ownershipCheck.error,
    });
  }

  const rateLimitExempt = isRateLimitExemptRequest(
    req,
    authResult.pubkey ?? undefined
  );
  if (!rateLimitExempt) {
    const ipLimit = await rateLimiters.push(req as any);
    if (ipLimit) {
      return res.status(429).json(JSON.parse(await ipLimit.text()));
    }
    const pubkeyLimit = checkPushPerPubkey(authResult.pubkey!);
    if (pubkeyLimit.limited && pubkeyLimit.body) {
      res.setHeader("Retry-After", String(pubkeyLimit.body.retry_after));
      return res.status(429).json(pubkeyLimit.body);
    }
  }

  try {
    await mkdir(dirname(repoPath), { recursive: true });

    if (!existsSync(repoPath)) {
      console.log(
        `🔄 [SyncFromSource] Cloning ${cloneUrl} → ${repoPath}`
      );
      await execAsync(
        `git clone --bare ${shellQuote(cloneUrl)} ${shellQuote(repoPath)}`,
        { timeout: 180000, maxBuffer: 20 * 1024 * 1024 }
      );
    } else {
      console.log(
        `🔄 [SyncFromSource] Fetching ${cloneUrl} into existing ${repoPath}`
      );
      // Ensure upstream remote points at forge
      try {
        await execAsync(
          `git --git-dir=${shellQuote(repoPath)} remote set-url upstream ${shellQuote(cloneUrl)}`,
          { timeout: 15000 }
        );
      } catch {
        await execAsync(
          `git --git-dir=${shellQuote(repoPath)} remote add upstream ${shellQuote(cloneUrl)}`,
          { timeout: 15000 }
        );
      }
      // Force-update local heads/tags to match upstream tip (exact forge SHAs)
      await execAsync(
        `git --git-dir=${shellQuote(repoPath)} fetch --prune upstream '+refs/heads/*:refs/heads/*' '+refs/tags/*:refs/tags/*'`,
        { timeout: 180000, maxBuffer: 20 * 1024 * 1024 }
      );
    }

    const branch = await resolveDefaultBranch(
      repoPath,
      typeof branchInput === "string" ? branchInput : undefined
    );
    const branchRef = `refs/heads/${branch}`;
    try {
      await execAsync(
        `git --git-dir=${shellQuote(repoPath)} rev-parse --verify ${shellQuote(branchRef)}`,
        { timeout: 10000 }
      );
      await execAsync(
        `git --git-dir=${shellQuote(repoPath)} symbolic-ref HEAD ${shellQuote(branchRef)}`,
        { timeout: 10000 }
      );
    } catch {
      // keep existing HEAD if preferred branch missing
    }

    try {
      await execAsync(`chown -R git-nostr:git-nostr ${shellQuote(repoPath)}`, {
        timeout: 30000,
      });
    } catch {
      // local/dev may not have git-nostr
    }

    const refs = await listRefs(repoPath);
    const headCommit =
      refs.find((r) => r.ref === `refs/heads/${branch}`)?.commit ||
      refs.find((r) => r.ref.startsWith("refs/heads/"))?.commit ||
      null;

    console.log(
      `✅ [SyncFromSource] ${safeRepoName} tip=${headCommit?.slice(0, 12) || "none"} refs=${refs.length}`
    );

    return res.status(200).json({
      success: true,
      syncedFrom: cloneUrl,
      branch,
      headCommit,
      refs,
      path: repoPath,
    });
  } catch (error: any) {
    console.error(`❌ [SyncFromSource] failed:`, error?.message || error);
    // If a partial clone left a broken dir, remove it so next attempt can retry
    if (existsSync(repoPath)) {
      try {
        const { stdout } = await execAsync(
          `git --git-dir=${shellQuote(repoPath)} rev-parse --is-bare-repository`,
          { timeout: 5000 }
        );
        if (stdout.trim() !== "true") {
          await rm(repoPath, { recursive: true, force: true });
        }
      } catch {
        // ignore cleanup errors
      }
    }
    return res.status(500).json({
      error: "Failed to sync from source",
      details: error?.message || String(error),
    });
  }
}
