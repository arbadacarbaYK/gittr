import { execFile } from "child_process";
import { dirname } from "path";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

/**
 * `stat -c '%U %G %a'` — group-write bit set and owned by the SSH git user.
 * 755 root (or git-nostr without group write) cannot unpack a push.
 */
export function gitDirAllowsGroupWrite(statLine: string): boolean {
  const [user, group, mode] = statLine.trim().split(/\s+/);
  if (user !== "git-nostr" || group !== "git-nostr") return false;
  const parsed = Number.parseInt(mode || "", 8);
  if (!Number.isFinite(parsed)) return false;
  return (parsed & 0o020) !== 0;
}

async function statLine(target: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("stat", ["-c", "%U %G %a", target], {
      timeout: 5000,
    });
    return String(stdout || "");
  } catch {
    return null;
  }
}

async function ensureOwnerDir(ownerDir: string): Promise<void> {
  const line = await statLine(ownerDir);
  if (line && line.trim().startsWith("git-nostr ")) return;
  try {
    await execFileAsync("chown", ["git-nostr:git-nostr", ownerDir], {
      timeout: 10000,
    });
    await execFileAsync("chmod", ["0750", ownerDir], { timeout: 10000 });
  } catch {
    // local dev, or the directory is not ours to change
  }
}

/**
 * SSH (`git-nostr`) and HTTPS (`www-data`, member of group `git-nostr`) both
 * need to create `objects/tmp_objdir-*` during receive-pack.
 * `core.sharedRepository=all` keeps new files group-writable and world-readable
 * so public clones still work.
 */
export async function ensureBridgeRepoWritable(
  repoPath: string,
  opts?: { force?: boolean }
): Promise<void> {
  const current = await statLine(repoPath);
  if (!opts?.force && current && gitDirAllowsGroupWrite(current)) {
    await ensureOwnerDir(dirname(repoPath));
    return;
  }

  try {
    await execFileAsync("chown", ["-R", "git-nostr:git-nostr", repoPath], {
      timeout: 60000,
    });
  } catch {
    try {
      await execFileAsync("chown", ["-R", "www-data:www-data", repoPath], {
        timeout: 60000,
      });
    } catch {
      // no git-nostr/www-data user (local dev)
    }
    return;
  }

  await ensureOwnerDir(dirname(repoPath));

  await execFileAsync(
    "git",
    ["--git-dir", repoPath, "config", "core.sharedRepository", "all"],
    { timeout: 15000 }
  ).catch(() => {});

  await execFileAsync("chmod", ["-R", "u+rwX,g+rwX,o+rX", repoPath], {
    timeout: 60000,
  }).catch(() => {});

  await execFileAsync(
    "find",
    [repoPath, "-type", "d", "-exec", "chmod", "g+s", "{}", "+"],
    { timeout: 60000 }
  ).catch(() => {});
}
