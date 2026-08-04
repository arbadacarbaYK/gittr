/**
 * Path suffix under /{entity}/{repo} for homepage (and similar) activity links.
 * Prefer deep links to the relevant tab / item when we have an id.
 */
export function getActivityDeepPath(activity: {
  type: string;
  id?: string;
  metadata?: {
    prId?: string;
    issueId?: string;
    commitId?: string;
    releaseTag?: string;
    [key: string]: unknown;
  };
}): string {
  const meta = activity.metadata || {};
  switch (activity.type) {
    case "pr_created":
    case "pr_merged": {
      const prId =
        (typeof meta.prId === "string" && meta.prId) ||
        (activity.id && !String(activity.id).startsWith("activity-")
          ? activity.id
          : "");
      return prId ? `/pulls/${prId}` : "/pulls";
    }
    case "issue_created":
    case "issue_closed": {
      const issueId =
        (typeof meta.issueId === "string" && meta.issueId) ||
        (activity.id && !String(activity.id).startsWith("activity-")
          ? activity.id
          : "");
      return issueId ? `/issues/${issueId}` : "/issues";
    }
    case "commit_created":
      return "/commits";
    case "release_created":
      return "/releases";
    case "bounty_created":
    case "bounty_claimed":
      return "/issues";
    default:
      return "";
  }
}

export function getActivityLabel(
  type: string,
  repoLabel: string
): string {
  switch (type) {
    case "pr_merged":
      return `Merged PR in ${repoLabel}`;
    case "pr_created":
      return `New PR in ${repoLabel}`;
    case "commit_created":
      return `New commit in ${repoLabel}`;
    case "repo_zapped":
      return `Zapped ${repoLabel}`;
    case "issue_created":
      return `New issue in ${repoLabel}`;
    case "issue_closed":
      return `Closed issue in ${repoLabel}`;
    case "release_created":
      return `Release in ${repoLabel}`;
    case "repo_created":
      return `Created ${repoLabel}`;
    case "repo_imported":
      return `Imported ${repoLabel}`;
    case "bounty_claimed":
      return `Bounty claimed in ${repoLabel}`;
    case "bounty_created":
      return `Bounty set in ${repoLabel}`;
    case "file_edited":
      return `Edited file in ${repoLabel}`;
    default:
      return `Activity in ${repoLabel}`;
  }
}

export function getActivityIcon(type: string): string {
  switch (type) {
    case "pr_merged":
      return "🔀";
    case "pr_created":
      return "🔀";
    case "commit_created":
      return "📦";
    case "repo_zapped":
      return "⚡";
    case "issue_created":
      return "📌";
    case "issue_closed":
      return "✅";
    case "release_created":
      return "🏷️";
    case "repo_created":
      return "📦";
    case "repo_imported":
      return "⬇️";
    case "bounty_claimed":
    case "bounty_created":
      return "💰";
    case "file_edited":
      return "✏️";
    default:
      return "•";
  }
}
