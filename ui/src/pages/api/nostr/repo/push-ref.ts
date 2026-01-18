import { handleOptionsRequest, setCorsHeaders } from "@/lib/api/cors";

import { exec } from "child_process";
import { existsSync, readFileSync } from "fs";
import type { NextApiRequest, NextApiResponse } from "next";
import { nip05, nip19 } from "nostr-tools";
import { join } from "path";
import { promisify } from "util";

const execAsync = promisify(exec);

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

function normalizeRefName(refName: string): { ref: string; error?: string } {
  const base = refName.startsWith("refs/nostr/")
    ? refName
    : `refs/nostr/${refName}`;
  const suffix = base.replace(/^refs\/nostr\//, "");

  if (!/^[0-9a-f]{64}$/i.test(suffix)) {
    return { ref: "", error: "refName must be a 64-char hex event id" };
  }

  return { ref: `refs/nostr/${suffix}` };
}

function normalizeSourceRef(sourceRef: string): {
  ref: string;
  error?: string;
} {
  const normalized = sourceRef.startsWith("refs/")
    ? sourceRef
    : `refs/heads/${sourceRef}`;

  if (!/^refs\/(heads|tags)\/[A-Za-z0-9._/-]+$/.test(normalized)) {
    return { ref: "", error: "sourceRef must be a branch or tag ref" };
  }

  if (normalized.includes("..") || normalized.includes("//")) {
    return { ref: "", error: "sourceRef contains invalid path segments" };
  }

  return { ref: normalized };
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
    repo,
    refName,
    commitId,
    sourceRef,
  } = req.body || {};

  if (!ownerPubkeyInput || typeof ownerPubkeyInput !== "string") {
    return res.status(400).json({ error: "ownerPubkey is required" });
  }

  if (!repo || typeof repo !== "string") {
    return res.status(400).json({ error: "repo is required" });
  }

  if (!refName || typeof refName !== "string") {
    return res.status(400).json({ error: "refName is required" });
  }

  const normalizedRef = normalizeRefName(refName);
  if (normalizedRef.error) {
    return res.status(400).json({ error: normalizedRef.error });
  }

  const resolved = await resolveOwnerPubkey(ownerPubkeyInput);
  if (resolved.error || !resolved.pubkey) {
    return res.status(400).json({
      error: resolved.error || "Failed to resolve ownerPubkey",
    });
  }

  const reposDir = await resolveReposDir();
  const repoPath = join(reposDir, resolved.pubkey, `${repo}.git`);

  if (!existsSync(repoPath)) {
    return res.status(404).json({
      error: "Repository not found",
      hint: "Repository may not be cloned yet by git-nostr-bridge",
    });
  }

  const commitIdTrimmed = typeof commitId === "string" ? commitId.trim() : "";
  const hasCommitId =
    commitIdTrimmed.length > 0 && /^[0-9a-f]{40,64}$/i.test(commitIdTrimmed);

  let commitToUse = commitIdTrimmed;

  try {
    if (hasCommitId) {
      await execAsync(
        `git --git-dir="${repoPath}" cat-file -e ${commitIdTrimmed}^{commit}`,
        { timeout: 5000 }
      );
    } else if (typeof sourceRef === "string" && sourceRef.trim().length > 0) {
      const normalizedSource = normalizeSourceRef(sourceRef.trim());
      if (normalizedSource.error) {
        return res.status(400).json({ error: normalizedSource.error });
      }
      const { stdout } = await execAsync(
        `git --git-dir="${repoPath}" rev-parse ${normalizedSource.ref}`,
        { timeout: 5000 }
      );
      commitToUse = stdout.trim();
      if (!/^[0-9a-f]{40,64}$/i.test(commitToUse)) {
        return res.status(400).json({
          error: "Resolved commit id is invalid",
        });
      }
    } else {
      return res.status(400).json({
        error: "commitId or sourceRef is required",
      });
    }
  } catch (error: any) {
    return res.status(404).json({
      error: "Commit not found in repo",
      message: error?.message || "Failed to resolve commit",
    });
  }

  try {
    await execAsync(
      `git --git-dir="${repoPath}" update-ref ${normalizedRef.ref} ${commitToUse}`,
      { timeout: 5000 }
    );
  } catch (error: any) {
    return res.status(500).json({
      error: "Failed to update ref",
      message: error?.message || "Unknown error",
    });
  }

  return res.status(200).json({
    success: true,
    refName: normalizedRef.ref,
    commitId: commitToUse,
  });
}
