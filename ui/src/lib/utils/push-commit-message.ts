/**
 * Default bridge commit subject for HTTP / MCP pushes that invent a tip.
 * Keep short — yy-mm-dd hh:mm UTC (not full ISO).
 * SSH `git push` does not use this; those keep the author's commit message.
 */
export function formatPushFromGittrStamp(
  unixSeconds: number = Math.floor(Date.now() / 1000)
): string {
  const d = new Date(
    (unixSeconds > 0 ? unixSeconds : Math.floor(Date.now() / 1000)) * 1000
  );
  const pad2 = (n: number) => String(n).padStart(2, "0");
  const short = `${String(d.getUTCFullYear()).slice(-2)}-${pad2(
    d.getUTCMonth() + 1
  )}-${pad2(d.getUTCDate())} ${pad2(d.getUTCHours())}:${pad2(
    d.getUTCMinutes()
  )}`;
  return `Push from gittr (${short})`;
}

/** Prefer a caller-supplied message; otherwise the short stamp. */
export function resolveBridgePushCommitMessage(
  commitMessage: unknown,
  unixSeconds?: number
): string {
  if (typeof commitMessage === "string") {
    const trimmed = commitMessage
      .trim()
      .replace(/[\r\n]+/g, " ")
      .slice(0, 200);
    if (trimmed) return trimmed;
  }
  return formatPushFromGittrStamp(unixSeconds);
}
