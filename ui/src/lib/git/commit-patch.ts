/**
 * Patch for one commit on a bare mirror, limited to a named branch tip.
 * `git show` is the commit's own diff. The branch check refuses a SHA that
 * is not reachable from `refs/heads/<branch>` — no silent fallthrough to
 * master/main.
 */
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const GIT_TIMEOUT_MS = 20_000;
const MAX_BUFFER = 8 * 1024 * 1024;
export const COMMIT_PATCH_MAX_FILES = 80;
export const COMMIT_PATCH_MAX_CHARS = 100_000;

export type CommitPatchFile = {
  path: string;
  status: "added" | "modified" | "deleted";
  additions: number;
  deletions: number;
  patch?: string;
  isBinary?: boolean;
  truncated?: boolean;
};

export type BareCommitDiffResult =
  | {
      ok: true;
      sha: string;
      branch?: string;
      files: CommitPatchFile[];
    }
  | {
      ok: false;
      code:
        | "bad_sha"
        | "bad_branch"
        | "missing_commit"
        | "missing_branch"
        | "not_on_branch"
        | "too_large"
        | "git_error";
      message: string;
    };

/** 7–40 hex. Short SHAs are expanded with rev-parse, not guessed across branches. */
export function sanitizeCommitSha(
  raw: string | undefined | null
): string | null {
  const s = String(raw || "")
    .trim()
    .toLowerCase();
  if (!/^[0-9a-f]{7,40}$/.test(s)) return null;
  return s;
}

/** Branch name safe to append to `refs/heads/`. Rejects revisions like `main..dev`. */
export function sanitizeCommitBranchName(
  raw: string | undefined | null
): string | null {
  const b = String(raw || "").trim();
  if (!b || b.length > 256) return null;
  if (b.startsWith("-") || b.startsWith("/") || b.endsWith("/")) return null;
  if (b.startsWith("refs/")) return null;
  if (b.includes("..") || b.includes("@{") || b.includes("//")) return null;
  if (!/^[A-Za-z0-9_./+-]+$/.test(b)) return null;
  return b;
}

function decodeGitPathToken(token: string): string {
  let s = token.trim();
  if (s.startsWith('"') && s.endsWith('"') && s.length >= 2) {
    s = s
      .slice(1, -1)
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\");
  }
  if (s === "/dev/null") return "";
  if (s.startsWith("a/") || s.startsWith("b/")) return s.slice(2);
  return s;
}

function parseDiffGitHeader(line: string): { a: string; b: string } | null {
  if (!line.startsWith("diff --git ")) return null;
  const rest = line.slice("diff --git ".length);
  const tokens: string[] = [];
  let i = 0;
  while (i < rest.length && tokens.length < 2) {
    if (rest[i] === " ") {
      i++;
      continue;
    }
    if (rest[i] === '"') {
      let j = i + 1;
      let buf = '"';
      while (j < rest.length) {
        buf += rest[j];
        if (rest[j] === '"' && rest[j - 1] !== "\\") {
          j++;
          break;
        }
        j++;
      }
      tokens.push(buf);
      i = j;
    } else {
      let j = i;
      while (j < rest.length && rest[j] !== " ") j++;
      tokens.push(rest.slice(i, j));
      i = j;
    }
  }
  if (tokens.length < 2) return null;
  return {
    a: decodeGitPathToken(tokens[0] || ""),
    b: decodeGitPathToken(tokens[1] || ""),
  };
}

/** Split `git show --patch` output into per-file patches. */
export function parseUnifiedCommitDiff(stdout: string): CommitPatchFile[] {
  const text = String(stdout || "").replace(/^\uFEFF/, "");
  const start = text.indexOf("diff --git ");
  if (start < 0) return [];
  const chunks = text.slice(start).split(/\n(?=diff --git )/);
  const files: CommitPatchFile[] = [];

  for (const chunk of chunks) {
    if (files.length >= COMMIT_PATCH_MAX_FILES) break;
    const lines = chunk.split("\n");
    const header = lines.find((l) => l.startsWith("diff --git ")) || "";
    const paths = parseDiffGitHeader(header);
    let status: CommitPatchFile["status"] = "modified";
    let path = paths?.b || paths?.a || "";
    for (const line of lines) {
      if (line.startsWith("new file mode")) status = "added";
      else if (line.startsWith("deleted file mode")) status = "deleted";
      else if (line.startsWith("rename to ")) {
        path = decodeGitPathToken(line.slice("rename to ".length).trim());
      }
    }
    if (status === "deleted" && paths?.a) path = paths.a;
    if (status === "added" && paths?.b) path = paths.b;
    if (!path) continue;

    const isBinary =
      chunk.includes("\nBinary files ") ||
      chunk.startsWith("Binary files ") ||
      chunk.includes("GIT binary patch");
    let additions = 0;
    let deletions = 0;
    if (!isBinary) {
      for (const line of lines) {
        if (
          line.startsWith("+++") ||
          line.startsWith("---") ||
          line.startsWith("diff ")
        ) {
          continue;
        }
        if (line.startsWith("+")) additions++;
        else if (line.startsWith("-")) deletions++;
      }
    }

    let patch = chunk.trimEnd();
    let truncated = false;
    if (!isBinary && patch.length > COMMIT_PATCH_MAX_CHARS) {
      patch = `${patch.slice(0, COMMIT_PATCH_MAX_CHARS)}\n... truncated ...`;
      truncated = true;
    }

    files.push({
      path,
      status,
      additions,
      deletions,
      isBinary: isBinary || undefined,
      patch: isBinary ? undefined : patch,
      truncated: truncated || undefined,
    });
  }

  return files;
}

function gitFailureCode(err: unknown): number | string | null {
  const code = (err as { code?: number | string }).code;
  if (typeof code === "number" || typeof code === "string") return code;
  return null;
}

async function gitDir(repoPath: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(
    "git",
    ["--no-pager", "--git-dir", repoPath, ...args],
    {
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: MAX_BUFFER,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        GIT_PAGER: "cat",
      },
    }
  );
  return typeof stdout === "string" ? stdout : String(stdout || "");
}

export async function readBareCommitDiff(opts: {
  repoPath: string;
  sha: string;
  branch?: string | null;
}): Promise<BareCommitDiffResult> {
  const sha = sanitizeCommitSha(opts.sha);
  if (!sha) {
    return { ok: false, code: "bad_sha", message: "Invalid commit id" };
  }

  const branchRaw = String(opts.branch || "").trim();
  let branch: string | null = null;
  if (branchRaw) {
    branch = sanitizeCommitBranchName(branchRaw);
    if (!branch) {
      return { ok: false, code: "bad_branch", message: "Invalid branch name" };
    }
  }

  let fullSha = "";
  try {
    fullSha = (
      await gitDir(opts.repoPath, ["rev-parse", "--verify", `${sha}^{commit}`])
    ).trim();
  } catch {
    return {
      ok: false,
      code: "missing_commit",
      message: "Commit not found in this repository",
    };
  }
  if (!/^[0-9a-f]{40}$/.test(fullSha)) {
    return {
      ok: false,
      code: "missing_commit",
      message: "Commit not found in this repository",
    };
  }

  if (branch) {
    const branchRef = `refs/heads/${branch}`;
    try {
      await gitDir(opts.repoPath, [
        "rev-parse",
        "--verify",
        `${branchRef}^{commit}`,
      ]);
    } catch {
      return {
        ok: false,
        code: "missing_branch",
        message: `Branch ${branch} was not found`,
      };
    }
    try {
      await gitDir(opts.repoPath, [
        "merge-base",
        "--is-ancestor",
        fullSha,
        branchRef,
      ]);
    } catch (err) {
      if (gitFailureCode(err) === 1) {
        return {
          ok: false,
          code: "not_on_branch",
          message: `Commit is not on branch ${branch}`,
        };
      }
      return {
        ok: false,
        code: "git_error",
        message: "Could not check that commit against the branch",
      };
    }
  }

  let patch = "";
  try {
    patch = await gitDir(opts.repoPath, [
      "show",
      "--first-parent",
      "--format=",
      "--patch",
      "--find-renames",
      fullSha,
    ]);
  } catch (err) {
    const stdout = (err as { stdout?: string }).stdout;
    if (gitFailureCode(err) === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
      return {
        ok: false,
        code: "too_large",
        message: "This commit's diff is too large to show",
      };
    }
    if (typeof stdout === "string" && stdout.includes("diff --git ")) {
      patch = stdout;
    } else {
      return {
        ok: false,
        code: "git_error",
        message: "Could not read the commit diff",
      };
    }
  }

  return {
    ok: true,
    sha: fullSha,
    branch: branch || undefined,
    files: parseUnifiedCommitDiff(patch),
  };
}
