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

/**
 * Fill last commit for each direct child of `folderPath` ("" = repo root).
 * Stops once every child has a hit or maxCommits is reached.
 */
export async function listBareRepoTreeLastCommits(
  repoPath: string,
  branch: string,
  children: Array<{ type: "file" | "dir"; path: string }>,
  opts?: { maxCommits?: number; timeoutMs?: number; folderPath?: string }
): Promise<TreeLastCommitMap> {
  const maxCommits = opts?.maxCommits ?? 400;
  const timeout = opts?.timeoutMs ?? 25_000;
  const folderPath = (opts?.folderPath || "").replace(/^\/+|\/+$/g, "");

  if (!children.length) return {};

  const needed = new Set(children.map((c) => c.path));
  const result: TreeLastCommitMap = {};

  const pathArg = folderPath ? ` -- ${shellQuote(folderPath)}` : "";
  // %x1f field sep, %x00 record sep between commits; name-only paths follow each header
  const cmd =
    `git --git-dir=${shellQuote(repoPath)} log ` +
    `--format='%H%x1f%s%x1f%an%x1f%at%x00' --name-only ` +
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
    // Partial output is still useful
    stdout = e?.stdout || "";
    if (!stdout) throw e;
  }

  const records = stdout.split("\0").filter((r) => r.trim());
  for (const record of records) {
    if (needed.size === 0) break;
    const lines = record.split("\n").map((l) => l.trim()).filter(Boolean);
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
