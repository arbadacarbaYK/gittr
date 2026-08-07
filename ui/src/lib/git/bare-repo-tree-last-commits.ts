/**
 * Batch last-commit metadata for one folder level of a bare repo tip/branch.
 * One `git log --name-only` walk — not N× `git log -1 -- path`.
 */
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

export type TreeLastCommit = {
  id: string;
  message: string;
  author: string;
  /** Unix seconds */
  timestamp: number;
};

export type TreeLastCommitMap = Record<string, TreeLastCommit>;

export type TreeChild = { type: "file" | "dir"; path: string };

/** Marker prefix used in `git log --format` (must stay in sync with listBareRepoTreeLastCommits). */
export const TREE_LAST_COMMIT_MARKER = ">>>COMMIT<<<";

/**
 * Parse `git log --format='>>>COMMIT<<<%H%x1f%s%x1f%an%x1f%at' --name-only` stdout.
 *
 * Regression: do NOT use `%x00` as a record separator with `--name-only` — NUL ends
 * the pretty line and leaves path lines as orphan records (empty timestamps in UI).
 */
export function parseTreeLastCommitLog(
  stdout: string,
  children: TreeChild[]
): TreeLastCommitMap {
  if (!children.length) return {};

  const needed = new Set(children.map((c) => c.path));
  const result: TreeLastCommitMap = {};

  const records = String(stdout || "")
    .split(TREE_LAST_COMMIT_MARKER)
    .filter((r) => r.trim());

  for (const record of records) {
    if (needed.size === 0) break;
    const lines = record
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    if (!lines.length) continue;
    const header = lines[0]!;
    const parts = header.split("\x1f");
    const id = parts[0] || "";
    const message = parts[1] || "";
    const author = parts[2] || "";
    const atRaw = parts[3] || "";
    const timestamp = parseInt(atRaw, 10);
    if (!id || !/^[0-9a-f]{40}$/i.test(id) || !Number.isFinite(timestamp)) {
      continue;
    }
    const meta: TreeLastCommit = {
      id,
      message: message.trim() || "(no message)",
      author: author.trim() || "unknown",
      timestamp,
    };
    for (let i = 1; i < lines.length; i++) {
      const touched = lines[i];
      if (!touched) continue;
      for (const child of children) {
        if (!needed.has(child.path)) continue;
        if (child.type === "file") {
          if (touched === child.path) {
            result[child.path] = meta;
            needed.delete(child.path);
          }
        } else {
          const prefix = `${child.path}/`;
          if (touched === child.path || touched.startsWith(prefix)) {
            result[child.path] = meta;
            needed.delete(child.path);
          }
        }
      }
      if (needed.size === 0) break;
    }
  }

  return result;
}

/**
 * Fill last commit for each direct child of `folderPath` ("" = repo root).
 * Stops once every child has a hit or maxCommits is reached.
 */
export async function listBareRepoTreeLastCommits(
  repoPath: string,
  branch: string,
  children: TreeChild[],
  opts?: { maxCommits?: number; timeoutMs?: number; folderPath?: string }
): Promise<TreeLastCommitMap> {
  const maxCommits = opts?.maxCommits ?? 400;
  const timeout = opts?.timeoutMs ?? 25_000;
  const folderPath = (opts?.folderPath || "").replace(/^\/+|\/+$/g, "");

  if (!children.length) return {};

  const pathArg = folderPath ? ` -- ${shellQuote(folderPath)}` : "";
  // Marker-based records: do NOT use %x00 with --name-only (NUL ends the
  // pretty line and leaves path lines as orphan "records").
  const cmd =
    `git --git-dir=${shellQuote(repoPath)} log ` +
    `--format='${TREE_LAST_COMMIT_MARKER}%H%x1f%s%x1f%an%x1f%at' --name-only ` +
    `-n ${maxCommits} ${shellQuote(branch)}${pathArg}`;

  let stdout = "";
  try {
    const out = await execAsync(cmd, {
      timeout,
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
    });
    stdout = out.stdout || "";
  } catch (e: any) {
    stdout = e?.stdout || "";
    if (!stdout) throw e;
  }

  return parseTreeLastCommitLog(stdout, children);
}
