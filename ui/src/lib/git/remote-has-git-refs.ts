import { execFile } from "child_process";
import { promisify } from "util";

import {
  buildCloneAttemptUrls,
  normalizeCloneUrl,
} from "./shallow-clone-remote";

const execFileAsync = promisify(execFile);

const LS_REMOTE_TIMEOUT_MS = 8_000;

/** True when `git ls-remote --heads` printed at least one branch SHA. */
export function lsRemoteStdoutHasRefs(stdout: string): boolean {
  const text = String(stdout || "");
  if (!text.trim()) return false;
  return /refs\/heads\//.test(text) || /^[0-9a-f]{40,64}\t/im.test(text);
}

export function parseLsRemoteHeads(
  stdout: string
): Array<{ ref: string; commit: string }> {
  const out: Array<{ ref: string; commit: string }> = [];
  for (const line of String(stdout || "").split(/\r?\n/)) {
    const match = line
      .trim()
      .match(/^([0-9a-f]{40,64})\s+(refs\/heads\/\S+)$/i);
    if (!match?.[1] || !match?.[2]) continue;
    out.push({ commit: match[1].toLowerCase(), ref: match[2] });
  }
  return out;
}

/** Branch tips from `git ls-remote --heads`. Empty when the remote has none or cannot be read. */
export async function listRemoteHeadRefs(
  cloneUrl: string
): Promise<Array<{ ref: string; commit: string }>> {
  const normalized = normalizeCloneUrl(String(cloneUrl || "").trim());
  if (!normalized) return [];
  const attempts = buildCloneAttemptUrls(normalized);
  for (const url of attempts) {
    try {
      const { stdout } = await execFileAsync(
        "git",
        ["ls-remote", "--heads", url],
        {
          timeout: LS_REMOTE_TIMEOUT_MS,
          maxBuffer: 256 * 1024,
          env: {
            ...process.env,
            GIT_TERMINAL_PROMPT: "0",
            GIT_ASKPASS: "echo",
          },
        }
      );
      const heads = parseLsRemoteHeads(String(stdout || ""));
      if (heads.length > 0) return heads;
    } catch {
      /* try the next URL form */
    }
  }
  return [];
}

/**
 * Cheap “can git clone see a repo here?” check. Does not list a file tree
 * and must not be tied to the Code-tab fetch race.
 */
export async function remoteHasGitRefs(cloneUrl: string): Promise<boolean> {
  const normalized = normalizeCloneUrl(String(cloneUrl || "").trim());
  if (!normalized) return false;
  const attempts = buildCloneAttemptUrls(normalized);
  for (const url of attempts) {
    try {
      const { stdout } = await execFileAsync(
        "git",
        ["ls-remote", "--heads", url],
        {
          timeout: LS_REMOTE_TIMEOUT_MS,
          maxBuffer: 256 * 1024,
          env: {
            ...process.env,
            GIT_TERMINAL_PROMPT: "0",
            GIT_ASKPASS: "echo",
          },
        }
      );
      if (lsRemoteStdoutHasRefs(String(stdout || ""))) return true;
    } catch {
      /* try the next URL form */
    }
  }
  return false;
}
