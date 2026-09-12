export type GitLogPipeCommit = {
  id: string;
  message: string;
  author: string;
  authorEmail?: string;
  timestamp: number;
  branch?: string;
  parentIds?: string[];
};

/**
 * Parse `git log --format="%H|%s|%an|%ae|%at|%P"` lines.
 * Timestamps are returned in milliseconds (same as the bridge commits API).
 */
export function parseGitLogPipeLines(
  stdout: string,
  branch?: string
): GitLogPipeCommit[] {
  const commits: GitLogPipeCommit[] = [];
  const text = (stdout || "").trim();
  if (!text) return commits;

  for (const line of text.split("\n")) {
    const parts = line.split("|");
    if (parts.length < 5) continue;
    const [
      hash,
      message,
      authorName,
      authorEmail,
      timestampStr,
      ...parentHashes
    ] = parts;
    if (!hash?.trim() || !message?.trim() || !timestampStr) continue;
    const timestamp = parseInt(timestampStr, 10) * 1000;
    if (!Number.isFinite(timestamp)) continue;
    const parentIds =
      parentHashes.length > 0 && parentHashes[0]
        ? parentHashes[0]
            .trim()
            .split(/\s+/)
            .filter((p) => p.length > 0)
        : [];
    commits.push({
      id: hash.trim(),
      message: message.trim(),
      author: authorName?.trim() || authorEmail?.trim() || "unknown",
      authorEmail: authorEmail?.trim() || undefined,
      timestamp,
      branch,
      parentIds: parentIds.length > 0 ? parentIds : undefined,
    });
  }
  return commits;
}
