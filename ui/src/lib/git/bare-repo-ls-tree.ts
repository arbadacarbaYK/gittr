import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export type BareTreeEntry = {
  type: "file" | "dir";
  path: string;
  size?: number;
};

/** Reject path traversal; return "" for repo root. null = invalid. */
export function sanitizeRepoTreePath(
  raw: string | string[] | undefined
): string | null {
  if (raw === undefined) return "";
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string") return "";
  const trimmed = value.trim().replace(/^\/+/, "").replace(/\/+$/, "");
  if (!trimmed) return "";
  if (
    trimmed.includes("\0") ||
    trimmed.split("/").some((seg) => !seg || seg === "." || seg === "..")
  ) {
    return null;
  }
  return trimmed;
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * Non-recursive listing of one directory (GitHub-style folder view).
 * path="" → repo root.
 */
export async function listBareRepoShallow(
  repoPath: string,
  branch: string,
  path = "",
  opts?: { includeSizes?: boolean; timeoutMs?: number }
): Promise<BareTreeEntry[]> {
  const timeout = opts?.timeoutMs ?? 15_000;
  const includeSizes = !!opts?.includeSizes;
  const spec = path ? `${branch}:${path}` : branch;
  const { stdout } = await execAsync(
    `git --git-dir=${shellQuote(repoPath)} ls-tree ${shellQuote(spec)}`,
    { timeout, encoding: "utf8", maxBuffer: 20 * 1024 * 1024 }
  );

  const entries: BareTreeEntry[] = [];
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    // 100644 blob <hash>\tname   OR  040000 tree <hash>\tname
    const tab = line.indexOf("\t");
    if (tab < 0) continue;
    const meta = line.slice(0, tab);
    const name = line.slice(tab + 1);
    if (!name || name.includes("\0")) continue;
    const parts = meta.split(/\s+/);
    const objType = parts[1];
    const fullPath = path ? `${path}/${name}` : name;
    const isDir = objType === "tree";
    const entry: BareTreeEntry = {
      type: isDir ? "dir" : "file",
      path: fullPath,
    };
    if (!isDir && includeSizes && parts[2]) {
      try {
        const { stdout: sizeOut } = await execAsync(
          `git --git-dir=${shellQuote(repoPath)} cat-file -s ${shellQuote(
            parts[2]
          )}`,
          { timeout: 3000, encoding: "utf8" }
        );
        const size = parseInt(sizeOut.trim(), 10);
        if (!Number.isNaN(size)) entry.size = size;
      } catch {
        // ignore size failures
      }
    }
    entries.push(entry);
  }

  entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    return a.path.localeCompare(b.path);
  });
  return entries;
}

/** Recursive path list (name-only). */
export async function listBareRepoRecursivePaths(
  repoPath: string,
  branch: string,
  opts?: { timeoutMs?: number }
): Promise<string[]> {
  const timeout = opts?.timeoutMs ?? 20_000;
  const { stdout } = await execAsync(
    `git --git-dir=${shellQuote(repoPath)} ls-tree -r --name-only ${shellQuote(
      branch
    )}`,
    { timeout, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
  );
  return stdout
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

/**
 * Build flat file+dir entries from recursive paths (dirs synthesized).
 */
export function buildFlatTreeFromPaths(
  filePaths: string[],
  opts?: { includeSizes?: never }
): BareTreeEntry[] {
  void opts;
  const files: BareTreeEntry[] = [];
  const dirs = new Set<string>();
  for (const filePath of filePaths) {
    const parts = filePath.split("/");
    for (let i = 1; i < parts.length; i++) {
      dirs.add(parts.slice(0, i).join("/"));
    }
    files.push({ type: "file", path: filePath });
  }
  const entries: BareTreeEntry[] = [
    ...Array.from(dirs)
      .sort()
      .map((path) => ({ type: "dir" as const, path })),
    ...files.sort((a, b) => a.path.localeCompare(b.path)),
  ];
  entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    return a.path.localeCompare(b.path);
  });
  return entries;
}
