import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

/**
 * Prefer the requested tip, then main↔master, then bare HEAD / newest head.
 * Same policy as `/api/nostr/repo/files` so tree-last-commits does not 500 when
 * the UI still says `main` but the mirror only has `master` (e.g. wok).
 */
export async function resolveBareRepoBranch(
  repoPath: string,
  requested?: string | null
): Promise<string | null> {
  const branchStr = (requested || "").trim();
  const candidates = [
    ...(branchStr ? [branchStr] : []),
    ...(branchStr === "main"
      ? ["master"]
      : branchStr === "master"
        ? ["main"]
        : branchStr
          ? ["main", "master"]
          : ["main", "master"]),
  ];
  const detectedDefault = await detectBareRepoDefaultBranch(repoPath);
  if (detectedDefault && !candidates.includes(detectedDefault)) {
    candidates.push(detectedDefault);
  }

  for (const candidate of candidates) {
    try {
      await execAsync(
        `git --git-dir="${repoPath}" rev-parse --verify ${JSON.stringify(
          candidate
        )}^{commit}`,
        { timeout: 5000 }
      );
      return candidate;
    } catch {
      // try next
    }
  }
  return detectedDefault;
}

/** Resolve a branch name that exists on the bare repo (HEAD, first heads/*, etc.). */
export async function detectBareRepoDefaultBranch(
  repoPath: string
): Promise<string | null> {
  try {
    const { stdout } = await execAsync(
      `git --git-dir="${repoPath}" symbolic-ref -q --short HEAD`,
      { timeout: 5000 }
    );
    const b = stdout.trim();
    if (b) return b;
  } catch {
    // detached or invalid HEAD
  }
  try {
    const { stdout } = await execAsync(
      `git --git-dir="${repoPath}" for-each-ref --format="%(refname:short)" --sort=-committerdate refs/heads`,
      { timeout: 5000 }
    );
    const first = stdout
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)[0];
    if (first) return first;
  } catch {
    // ignore
  }
  return null;
}

/** List local head names on a bare repo (capped). */
export async function listBareRepoBranches(
  repoPath: string,
  limit = 40
): Promise<string[]> {
  try {
    const { stdout } = await execAsync(
      `git --git-dir="${repoPath}" for-each-ref --format="%(refname:short)" --sort=-committerdate refs/heads`,
      { timeout: 5000 }
    );
    return stdout
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(0, limit);
  } catch {
    return [];
  }
}
