import { basename, resolve, sep } from "path";

/**
 * Normalize + validate repo name for git-nostr-bridge on-disk paths.
 * Aligns with Go bridge IsValidRepoName (no space, `/`, or `.`) and blocks
 * path traversal / absolute segments that would escape ownerPubkey/.
 *
 * Query/body may still carry URL encoding (e.g. my%2Drepo).
 */
export function sanitizeBridgeRepoName(raw: string): string {
  let s = String(raw ?? "").trim();
  if (!s) return "";
  try {
    s = decodeURIComponent(s);
  } catch {
    /* keep as-is */
  }
  s = s.trim();
  if (!s) return "";

  // Clients sometimes send "repo.git"
  if (s.toLowerCase().endsWith(".git")) {
    s = s.slice(0, -4).trim();
  }
  if (!s) return "";

  // Reject path separators, traversal, controls, NUL, and Go-invalid chars.
  if (
    /[\0\x01-\x1f\\/]/.test(s) ||
    s.includes("..") ||
    s.includes(" ") ||
    s.includes(".") ||
    basename(s) !== s
  ) {
    return "";
  }

  // Keep names reasonably short for filesystem + SQLite keys
  if (s.length > 200) return "";

  return s;
}

/**
 * Build reposDir/{ownerHex}/{repo}.git and prove it stays under the owner dir.
 * Returns null when name/owner are invalid or the resolved path escapes.
 */
export function resolveBridgeRepoPath(
  reposDir: string,
  ownerPubkey: string,
  repoNameRaw: string
): { repoName: string; repoPath: string; ownerDir: string } | null {
  const owner = String(ownerPubkey || "")
    .trim()
    .toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(owner)) return null;

  const repoName = sanitizeBridgeRepoName(repoNameRaw);
  if (!repoName) return null;

  const ownerDir = resolve(reposDir, owner);
  const repoPath = resolve(ownerDir, `${repoName}.git`);
  const ownerPrefix = ownerDir.endsWith(sep) ? ownerDir : ownerDir + sep;

  if (repoPath !== ownerDir && !repoPath.startsWith(ownerPrefix)) {
    return null;
  }

  return { repoName, repoPath, ownerDir };
}

/** Join helper for temp partial dirs that must stay under the owner folder. */
export function resolveBridgeOwnerTempPath(
  ownerDir: string,
  repoName: string,
  suffix: string
): string | null {
  const safeName = sanitizeBridgeRepoName(repoName);
  if (!safeName) return null;
  const tempPath = resolve(ownerDir, `.${safeName}.${suffix}`);
  const ownerPrefix = ownerDir.endsWith(sep) ? ownerDir : ownerDir + sep;
  if (!tempPath.startsWith(ownerPrefix)) return null;
  return tempPath;
}
