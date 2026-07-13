/**
 * Server-side read-access gate for private repositories.
 *
 * Mirrors the ACL that git-nostr-ssh enforces for `git-upload-pack`:
 * a repo is readable when Repository.PublicRead is set (or the repo has no
 * row yet — announcements default to public), otherwise only by the owner
 * or a pubkey with READ/WRITE/ADMIN in RepositoryPermission.
 *
 * Authentication reuses verifyNostrAuth (signed kind 24242/30617 event in
 * X-Nostr-Auth-Event, built client-side by getBridgeAuthHeaders).
 */
import type { NextApiRequest } from "next";
import { exec } from "child_process";
import { promisify } from "util";
import { nip19 } from "nostr-tools";
import { resolveBridgeDbPath } from "@/lib/resolve-bridge-db-path";
import { verifyNostrAuth } from "@/pages/api/nostr/repo/push-auth";

const execAsync = promisify(exec);

export type RepoReadAccess =
  | { ok: true; callerPubkey?: string }
  | { ok: false; status: 401 | 403; error: string };

export type RepoWriteAccess = RepoReadAccess;

export function resolveOwnerHexPubkey(owner: string): string | null {
  const trimmed = (owner || "").trim();
  if (/^[0-9a-f]{64}$/i.test(trimmed)) return trimmed.toLowerCase();
  if (trimmed.startsWith("npub")) {
    try {
      const decoded = nip19.decode(trimmed);
      if (decoded.type === "npub" && typeof decoded.data === "string") {
        return decoded.data.toLowerCase();
      }
    } catch {
      return null;
    }
  }
  return null;
}

export function normalizeRepoName(repoName: string): string {
  return (repoName || "").trim().replace(/\.git$/i, "");
}

function sqlEscape(value: string): string {
  return value.replace(/'/g, "''");
}

async function sqliteQuery(dbPath: string, query: string): Promise<string> {
  // echo-pipe pattern (same as exists.ts) avoids shell quote interpretation
  const escapedQuery = query.replace(/'/g, "'\\''");
  const { stdout } = await execAsync(
    `echo '${escapedQuery}' | sqlite3 "${dbPath}"`,
    { timeout: 5000 }
  );
  return stdout.trim();
}

type RepoVisibility = {
  publicRead: boolean;
  publicWrite: boolean;
  rowKnown: boolean;
};

async function loadRepoVisibility(
  ownerHex: string,
  repoName: string
): Promise<RepoVisibility | null> {
  const dbPath = resolveBridgeDbPath();
  if (!dbPath) return null;

  try {
    const row = await sqliteQuery(
      dbPath,
      `SELECT PublicRead, PublicWrite FROM Repository WHERE OwnerPubKey = '${sqlEscape(
        ownerHex
      )}' AND RepositoryName = '${sqlEscape(repoName)}'`
    );
    if (row === "") {
      return { publicRead: true, publicWrite: false, rowKnown: false };
    }
    const [readRaw, writeRaw] = (row.split("\n")[0] ?? "").split("|");
    return {
      publicRead: (readRaw ?? "").trim() !== "0",
      publicWrite: (writeRaw ?? "").trim() === "1",
      rowKnown: true,
    };
  } catch {
    return null;
  }
}

/** SEO + metadata: bridge DB wins when a row exists; otherwise use Nostr tag hint. */
export async function isRepoPubliclyIndexable(
  ownerHex: string,
  repoName: string,
  nostrPublicRead = true
): Promise<boolean> {
  const visibility = await loadRepoVisibility(
    ownerHex,
    normalizeRepoName(repoName)
  );
  if (visibility?.rowKnown) {
    return visibility.publicRead;
  }
  return nostrPublicRead !== false;
}

async function loadCallerPermission(
  ownerHex: string,
  repoName: string,
  callerHex: string
): Promise<string | null> {
  const dbPath = resolveBridgeDbPath();
  if (!dbPath) return null;

  try {
    const permission = await sqliteQuery(
      dbPath,
      `SELECT Permission FROM RepositoryPermission WHERE OwnerPubKey = '${sqlEscape(
        ownerHex
      )}' AND RepositoryName = '${sqlEscape(
        repoName
      )}' AND TargetPubKey = '${sqlEscape(callerHex)}'`
    );
    const perm = (permission.split("\n")[0] ?? "").trim().toUpperCase();
    return perm || null;
  } catch {
    return null;
  }
}

function isReadAllowed(permission: string | null): boolean {
  return (
    permission === "ADMIN" || permission === "READ" || permission === "WRITE"
  );
}

function isWriteAllowed(permission: string | null): boolean {
  return permission === "ADMIN" || permission === "WRITE";
}

/**
 * Check whether the request may read the given repo.
 * Fails OPEN only when the bridge DB is unavailable AND the repo row is
 * unknown (matches pre-privacy behavior for legacy deployments); a stored
 * PublicRead=0 row always requires authenticated owner/contributor access.
 */
export async function assertRepoReadAccess(
  req: NextApiRequest,
  ownerPubkeyInput: string,
  repoNameInput: string
): Promise<RepoReadAccess> {
  const ownerHex = resolveOwnerHexPubkey(ownerPubkeyInput);
  const repoName = normalizeRepoName(repoNameInput);
  if (!ownerHex || !repoName) {
    // Entity resolution failed upstream; nothing sensible to gate on.
    return { ok: true };
  }

  const visibility = await loadRepoVisibility(ownerHex, repoName);
  if (!visibility) return { ok: true };
  if (visibility.publicRead) return { ok: true };

  const auth = await verifyNostrAuth(req);
  if (!auth.authorized || !auth.pubkey) {
    return {
      ok: false,
      status: 401,
      error:
        "This repository is private. Authenticate with a signed Nostr auth event (X-Nostr-Auth-Event).",
    };
  }

  const callerHex = auth.pubkey.toLowerCase();
  if (callerHex === ownerHex) {
    return { ok: true, callerPubkey: callerHex };
  }

  const permission = await loadCallerPermission(ownerHex, repoName, callerHex);
  if (isReadAllowed(permission)) {
    return { ok: true, callerPubkey: callerHex };
  }

  return {
    ok: false,
    status: 403,
    error: "This repository is private. Ask the owner for access.",
  };
}

/**
 * Mirrors git-nostr-ssh `git-receive-pack` ACL for HTTPS pushes.
 */
export async function assertRepoWriteAccess(
  req: NextApiRequest,
  ownerPubkeyInput: string,
  repoNameInput: string
): Promise<RepoWriteAccess> {
  const ownerHex = resolveOwnerHexPubkey(ownerPubkeyInput);
  const repoName = normalizeRepoName(repoNameInput);
  if (!ownerHex || !repoName) {
    return { ok: true };
  }

  const visibility = await loadRepoVisibility(ownerHex, repoName);
  if (!visibility) return { ok: true };
  if (visibility.publicWrite) return { ok: true };

  const auth = await verifyNostrAuth(req);
  if (!auth.authorized || !auth.pubkey) {
    return {
      ok: false,
      status: 401,
      error:
        "This repository requires authentication to push. Use X-Nostr-Auth-Event or SSH.",
    };
  }

  const callerHex = auth.pubkey.toLowerCase();
  if (callerHex === ownerHex) {
    return { ok: true, callerPubkey: callerHex };
  }

  const permission = await loadCallerPermission(ownerHex, repoName, callerHex);
  if (isWriteAllowed(permission)) {
    return { ok: true, callerPubkey: callerHex };
  }

  return {
    ok: false,
    status: 403,
    error: "You do not have write access to this repository.",
  };
}

export type GitHttpOperation = "read" | "write";

/** Parse `/{owner}/{repo}.git/...` from nginx `X-Original-URI`. */
export function parseGitHttpUri(uri: string): {
  owner: string;
  repo: string;
  operation: GitHttpOperation;
} | null {
  const trimmed = (uri || "").trim();
  const path = trimmed.split("?")[0] ?? trimmed;
  const match = path.match(/^\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/(.*))?$/i);
  if (!match?.[1] || !match[2]) return null;

  const tail = (match[3] || "").toLowerCase();
  const query = trimmed.includes("?") ? trimmed.split("?")[1] : "";
  const params = new URLSearchParams(query);
  const service = (params.get("service") || "").toLowerCase();

  let operation: GitHttpOperation = "read";
  if (
    service === "git-receive-pack" ||
    tail.includes("git-receive-pack")
  ) {
    operation = "write";
  }

  return {
    owner: match[1],
    repo: match[2],
    operation,
  };
}
