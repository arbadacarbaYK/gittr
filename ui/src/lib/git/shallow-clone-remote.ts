import { sanitizeRepoTreePath } from "./bare-repo-ls-tree";
import { httpBodyIsBinary } from "./file-bytes-look-like-text";

import { exec } from "child_process";
import * as fs from "fs";
import { tmpdir } from "os";
import * as path from "path";
import { promisify } from "util";

const execAsync = promisify(exec);

const CLONE_TIMEOUT_MS = 90_000;
const SHOW_TIMEOUT_MS = 30_000;
const MAX_FILE_BYTES = 8 * 1024 * 1024;

/** user@host:path/to/repo — git accepts it; not the same as git@ only */
export function isSshStyleGitRemote(url: string): boolean {
  const t = url.trim();
  if (!t || t.includes("://")) return false;
  return /^[^@\s]+@[^:]+:.+$/.test(t);
}

/** Many hosts require an explicit `.git` suffix; try it if the first clone fails. */
export function buildCloneAttemptUrls(cloneUrl: string): string[] {
  const out: string[] = [cloneUrl];
  if (cloneUrl.startsWith("https://") || cloneUrl.startsWith("http://")) {
    const trimmed = cloneUrl.replace(/\/+$/, "");
    if (!trimmed.endsWith(".git")) {
      out.push(`${trimmed}.git`);
    }
  } else if (
    (cloneUrl.startsWith("git@") || isSshStyleGitRemote(cloneUrl)) &&
    !cloneUrl.endsWith(".git")
  ) {
    out.push(`${cloneUrl}.git`);
  }
  return out;
}

export function normalizeCloneUrl(sourceUrl: string): string {
  const cloneUrl = sourceUrl.trim();
  if (cloneUrl.startsWith("git@")) {
    return cloneUrl;
  }
  if (isSshStyleGitRemote(cloneUrl)) {
    return cloneUrl;
  }
  if (cloneUrl.startsWith("git://")) {
    return cloneUrl.replace(/^git:\/\//, "https://");
  }
  if (!cloneUrl.startsWith("http://") && !cloneUrl.startsWith("https://")) {
    return `https://${cloneUrl}`;
  }
  return cloneUrl;
}

export function sanitizeGitBranch(branch: string | undefined): string {
  const b = (branch || "main").trim();
  if (!b || b.length > 256) return "main";
  if (!/^[\w./-]+$/.test(b)) return "main";
  return b;
}

async function cloneShallowToTempDir(
  sourceUrl: string,
  branch: string
): Promise<string | null> {
  const tempDir = path.join(
    tmpdir(),
    `gittr-clone-${Date.now()}-${Math.random().toString(36).substring(7)}`
  );

  const cloneUrl = normalizeCloneUrl(sourceUrl);
  const attemptUrls = [...new Set(buildCloneAttemptUrls(cloneUrl))];
  let cloneOk = false;
  let lastErr: unknown = null;

  const tryClone = async (cmd: string) => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    fs.mkdirSync(tempDir, { recursive: true });
    await execAsync(cmd, { timeout: CLONE_TIMEOUT_MS });
  };

  const safeBr = sanitizeGitBranch(branch);

  for (const attempt of attemptUrls) {
    const withBranch = `git clone --depth 1 --branch ${JSON.stringify(
      safeBr
    )} ${JSON.stringify(attempt)} ${JSON.stringify(tempDir)}`;
    const noBranch = `git clone --depth 1 ${JSON.stringify(
      attempt
    )} ${JSON.stringify(tempDir)}`;
    for (const cmd of [withBranch, noBranch]) {
      try {
        await tryClone(cmd);
        cloneOk = true;
        break;
      } catch (err) {
        lastErr = err;
        try {
          if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
          }
        } catch {
          /* ignore */
        }
      }
    }
    if (cloneOk) break;
  }

  if (!cloneOk) {
    console.error("[shallow-clone] clone failed:", attemptUrls, lastErr);
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch {
      /* ignore */
    }
    return null;
  }

  return tempDir;
}

export type ListedRemoteFile = {
  type: string;
  path: string;
  size?: number;
};

export async function cloneShallowAndListFiles(
  sourceUrl: string,
  branch: string
): Promise<{ files: ListedRemoteFile[]; defaultBranch: string } | null> {
  const tempDir = await cloneShallowToTempDir(sourceUrl, branch);
  if (!tempDir) return null;

  try {
    let defaultBranch = "main";
    try {
      const { stdout: branchOutput } = await execAsync(
        `git -C ${JSON.stringify(tempDir)} rev-parse --abbrev-ref HEAD`,
        { timeout: 5000 }
      );
      defaultBranch = branchOutput.trim() || "main";
    } catch {
      /* keep default */
    }

    const { stdout: lsOut } = await execAsync(
      `git -C ${JSON.stringify(tempDir)} ls-tree -r -l HEAD`,
      { timeout: 60000 }
    );

    const files: ListedRemoteFile[] = [];
    for (const line of lsOut.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const tab = trimmed.lastIndexOf("\t");
      if (tab === -1) continue;
      const metaPart = trimmed.slice(0, tab);
      const filePath = trimmed.slice(tab + 1);
      const meta = metaPart.split(/\s+/);
      if (meta.length < 4 || !filePath) continue;
      const objType = meta[1];
      const sizeStr = meta[3];
      if (objType !== "blob") continue;
      const size =
        sizeStr && sizeStr !== "-" ? parseInt(sizeStr, 10) : undefined;
      files.push({
        type: "file",
        path: filePath,
        size: Number.isFinite(size) ? size : undefined,
      });
    }

    const dirSet = new Set<string>();
    for (const f of files) {
      let d = path.posix.dirname(f.path);
      while (d && d !== ".") {
        dirSet.add(d);
        d = path.posix.dirname(d);
      }
    }
    const dirEntries = [...dirSet].map((p) => ({
      type: "dir" as const,
      path: p,
    }));
    const merged = [...dirEntries, ...files].sort((a, b) =>
      a.path.localeCompare(b.path)
    );

    fs.rmSync(tempDir, { recursive: true, force: true });
    return { files: merged, defaultBranch };
  } catch (e) {
    console.error("[shallow-clone] ls-tree failed:", e);
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    return null;
  }
}

export async function cloneShallowAndReadFile(
  sourceUrl: string,
  branch: string,
  filePath: string
): Promise<{ content: string; isBinary: boolean } | null> {
  const safePath = sanitizeRepoTreePath(filePath);
  if (safePath === null || safePath === "") return null;

  const tempDir = await cloneShallowToTempDir(sourceUrl, branch);
  if (!tempDir) return null;

  try {
    const spec = `HEAD:${safePath}`;
    const { stdout } = await execAsync(
      `git -C ${JSON.stringify(tempDir)} show ${JSON.stringify(spec)}`,
      {
        timeout: SHOW_TIMEOUT_MS,
        maxBuffer: MAX_FILE_BYTES + 1024,
        encoding: "latin1",
      }
    );
    const bytes = Buffer.from(stdout, "latin1");
    if (bytes.length > MAX_FILE_BYTES) {
      fs.rmSync(tempDir, { recursive: true, force: true });
      return null;
    }
    const isBinary = httpBodyIsBinary(null, bytes);
    fs.rmSync(tempDir, { recursive: true, force: true });
    return {
      content: isBinary
        ? Buffer.from(bytes).toString("base64")
        : Buffer.from(bytes).toString("utf8"),
      isBinary,
    };
  } catch (e) {
    console.error("[shallow-clone] git show failed:", e);
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    return null;
  }
}
