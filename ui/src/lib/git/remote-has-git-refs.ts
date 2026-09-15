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
