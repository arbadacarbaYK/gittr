import { execFile } from "child_process";
import * as fs from "fs";
import { tmpdir } from "os";
import * as path from "path";
import { promisify } from "util";

import { fileBytesLookLikeText } from "./file-bytes-look-like-text";
import {
  buildCloneAttemptUrls,
  normalizeCloneUrl,
} from "./shallow-clone-remote";

const execFileAsync = promisify(execFile);

export const GIT_RANGE_DIFF_MAX_FILES = 40;
export const GIT_RANGE_DIFF_MAX_PATCH_BYTES = 400_000;
const FETCH_TIMEOUT_MS = 90_000;
const DIFF_TIMEOUT_MS = 30_000;

export type RangeDiffFile = {
  path: string;
  status: "added" | "modified" | "deleted";
  before?: string;
  after?: string;
  isBinary?: boolean;
};

export function sanitizeGitObjectId(raw: string | undefined): string | null {
  const s = String(raw || "")
    .trim()
    .toLowerCase();
  if (!/^[0-9a-f]{7,40}$/.test(s)) return null;
  return s;
}

export function sanitizeNostrPrRef(raw: string | undefined): string | null {
  const t = String(raw || "").trim();
  const m = t.match(/^refs\/nostr\/([0-9a-f]{64})$/i);
  if (!m) return null;
  return `refs/nostr/${m[1]!.toLowerCase()}`;
}

export function parseGitNameStatus(stdout: string): Array<{
  path: string;
  status: "added" | "modified" | "deleted";
}> {
  const out: Array<{ path: string; status: "added" | "modified" | "deleted" }> =
    [];
  for (const line of String(stdout || "").split("\n")) {
    const trimmed = line.trimEnd();
    if (!trimmed) continue;
    const parts = trimmed.split("\t");
    const code = (parts[0] || "").trim();
    if (!code) continue;
    const letter = code[0];
    if (letter === "A") {
      const p = parts[1]?.trim();
      if (p) out.push({ path: p, status: "added" });
    } else if (letter === "D") {
      const p = parts[1]?.trim();
      if (p) out.push({ path: p, status: "deleted" });
    } else if (letter === "R" || letter === "C") {
      const p = (parts[2] || parts[1] || "").trim();
      if (p) out.push({ path: p, status: "modified" });
    } else {
      const p = parts[1]?.trim();
      if (p) out.push({ path: p, status: "modified" });
    }
  }
  return out;
}

async function gitAllowDiff(
  dir: string,
  args: string[],
  timeout = DIFF_TIMEOUT_MS
): Promise<string> {
  try {
    const { stdout } = await git(dir, args, timeout);
    return stdout || "";
  } catch (e) {
    const stdout = (e as { stdout?: string }).stdout;
    if (typeof stdout === "string") return stdout;
    throw e;
  }
}

async function git(
  dir: string,
  args: string[],
  timeout = DIFF_TIMEOUT_MS
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync("git", ["-C", dir, "--no-pager", ...args], {
    timeout,
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
      GIT_PAGER: "cat",
    },
    maxBuffer: 8 * 1024 * 1024,
  });
}

async function fetchIntoBare(
  dir: string,
  origin: string,
  spec: string
): Promise<boolean> {
  try {
    await git(
      dir,
      ["fetch", "--no-tags", "--no-filter", origin, spec],
      FETCH_TIMEOUT_MS
    );
    return true;
  } catch {
    try {
      await git(dir, ["fetch", "--no-tags", origin, spec], FETCH_TIMEOUT_MS);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Clone a remote far enough to run `git diff base...head` (NIP-34 PR tips).
 */
export async function gitDiffBetweenCommits(opts: {
  cloneUrl: string;
  head: string;
  base?: string;
  extraRef?: string;
}): Promise<RangeDiffFile[]> {
  const head = sanitizeGitObjectId(opts.head);
  if (!head) return [];
  const base = sanitizeGitObjectId(opts.base) || undefined;
  const extraRef = sanitizeNostrPrRef(opts.extraRef) || undefined;
  const cloneUrl = normalizeCloneUrl(opts.cloneUrl);
  const attemptUrls = [...new Set(buildCloneAttemptUrls(cloneUrl))];

  const tempDir = path.join(
    tmpdir(),
    `gittr-pr-diff-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  );

  try {
    let cloned = false;
    for (const url of attemptUrls) {
      try {
        if (fs.existsSync(tempDir)) {
          fs.rmSync(tempDir, { recursive: true, force: true });
        }
        await execFileAsync(
          "git",
          ["clone", "--bare", "--no-tags", url, tempDir],
          {
            timeout: FETCH_TIMEOUT_MS,
            env: {
              ...process.env,
              GIT_TERMINAL_PROMPT: "0",
              GIT_PAGER: "cat",
            },
          }
        );
        cloned = true;
        break;
      } catch {
        /* try next URL */
      }
    }
    if (!cloned) return [];

    if (extraRef) {
      await fetchIntoBare(tempDir, "origin", `+${extraRef}:${extraRef}`);
    }
    const headOk = await fetchIntoBare(tempDir, "origin", head);
    if (!headOk && extraRef) {
      await fetchIntoBare(tempDir, "origin", `${extraRef}:refs/gittr/pr-head`);
    }
    if (base) {
      await fetchIntoBare(tempDir, "origin", base);
    }

    let resolvedHead = head;
    try {
      const parsed = await git(tempDir, [
        "rev-parse",
        "--verify",
        `${head}^{commit}`,
      ]);
      resolvedHead = parsed.stdout.trim() || head;
    } catch {
      try {
        const parsed = await git(tempDir, [
          "rev-parse",
          "--verify",
          "refs/gittr/pr-head^{commit}",
        ]);
        resolvedHead = parsed.stdout.trim();
      } catch {
        return [];
      }
    }

    let resolvedBase = base;
    if (!resolvedBase || !(await objectExists(tempDir, resolvedBase))) {
      try {
        const parent = await git(tempDir, [
          "rev-parse",
          "--verify",
          `${resolvedHead}^`,
        ]);
        resolvedBase = parent.stdout.trim() || undefined;
      } catch {
        resolvedBase = undefined;
      }
    }

    if (!resolvedBase) {
      const showOut = await gitAllowDiff(tempDir, [
        "show",
        "--format=",
        "--name-status",
        resolvedHead,
      ]);
      const files = parseGitNameStatus(showOut).slice(
        0,
        GIT_RANGE_DIFF_MAX_FILES
      );
      return await patchFiles(tempDir, `${resolvedHead}^`, resolvedHead, files);
    }

    const nsOut = await gitAllowDiff(tempDir, [
      "diff",
      "--name-status",
      resolvedBase,
      resolvedHead,
    ]);
    const files = parseGitNameStatus(nsOut).slice(0, GIT_RANGE_DIFF_MAX_FILES);
    // Must await: `return patchFiles()` would let `finally` delete the clone first.
    return await patchFiles(tempDir, resolvedBase, resolvedHead, files);
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

async function objectExists(dir: string, id: string): Promise<boolean> {
  try {
    await git(dir, ["rev-parse", "--verify", `${id}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

async function gitShowText(
  dir: string,
  rev: string,
  filePath: string
): Promise<string | null> {
  try {
    const { stdout } = await git(dir, ["show", `${rev}:${filePath}`]);
    const buf = Buffer.from(stdout);
    if (!fileBytesLookLikeText(new Uint8Array(buf))) return null;
    if (buf.byteLength > GIT_RANGE_DIFF_MAX_PATCH_BYTES) {
      return stdout.slice(0, GIT_RANGE_DIFF_MAX_PATCH_BYTES) + "\n…truncated";
    }
    return stdout;
  } catch {
    return null;
  }
}

async function patchFiles(
  dir: string,
  base: string,
  head: string,
  files: Array<{ path: string; status: "added" | "modified" | "deleted" }>
): Promise<RangeDiffFile[]> {
  const out: RangeDiffFile[] = [];
  for (const file of files) {
    const before =
      file.status === "added" ? "" : await gitShowText(dir, base, file.path);
    const after =
      file.status === "deleted" ? "" : await gitShowText(dir, head, file.path);
    const showOk =
      (file.status === "added" && after != null) ||
      (file.status === "deleted" && before != null) ||
      (file.status === "modified" && before != null && after != null);
    if (showOk) {
      out.push({
        path: file.path,
        status: file.status,
        before: before ?? "",
        after: after ?? "",
        isBinary: false,
      });
      continue;
    }
    try {
      let patch = await gitAllowDiff(dir, [
        "diff",
        "--no-ext-diff",
        "--no-color",
        "--unified=3",
        base,
        head,
        "--",
        file.path,
      ]);
      if (Buffer.byteLength(patch, "utf8") > GIT_RANGE_DIFF_MAX_PATCH_BYTES) {
        patch = patch.slice(0, GIT_RANGE_DIFF_MAX_PATCH_BYTES) + "\n…truncated";
      }
      out.push({
        path: file.path,
        status: file.status,
        after: patch || undefined,
        isBinary:
          patch.includes("Binary files ") || patch.includes("GIT binary patch"),
      });
    } catch {
      out.push({ path: file.path, status: file.status, isBinary: true });
    }
  }
  return out;
}

export async function gitDiffBetweenCommitsSafe(
  opts: Parameters<typeof gitDiffBetweenCommits>[0]
): Promise<RangeDiffFile[]> {
  try {
    return await gitDiffBetweenCommits(opts);
  } catch (e) {
    console.warn("[git-range-diff] failed:", (e as Error)?.message || e);
    return [];
  }
}
