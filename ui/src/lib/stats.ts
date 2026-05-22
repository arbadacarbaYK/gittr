/**
 * Statistics Calculation Functions
 * Calculate top repos, users, etc. from activity data
 *
 * CRITICAL: New functions count from Nostr events (network source of truth)
 * Old functions use localStorage (kept for fallback)
 */
import {
  type Activity,
  ActivityType,
  getActivities,
} from "./activity-tracking";
import { isPublisherBlocklisted } from "./moderation/publisher-blocklist";
import {
  KIND_ISSUE,
  KIND_PULL_REQUEST,
  KIND_REPOSITORY_NIP34,
  KIND_REPOSITORY_STATE,
  KIND_STATUS_APPLIED,
  KIND_STATUS_CLOSED,
} from "./nostr/events";
import { nip19 } from "nostr-tools";

import {
  getRepoOwnerPubkey,
  resolveEntityToPubkey,
} from "./utils/entity-resolver";

/** Home "Recent repositories" card — npub entity for links */
export type PlatformRecentRepo = {
  entity: string;
  repo: string;
  repoName: string;
  ownerPubkey: string;
  lastActivity: number;
  description?: string;
};

/** Home "Recent Activity" when browser has no local gittr_activities */
export type PlatformRecentActivity = {
  id: string;
  type: ActivityType;
  timestamp: number;
  user: string;
  entity: string;
  repo: string;
  repoName: string;
  metadata?: Activity["metadata"];
};

function hexPubkeyToNpub(pubkey: string): string {
  const hex = (pubkey || "").trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hex)) return pubkey;
  try {
    return nip19.npubEncode(hex);
  } catch {
    return hex.slice(0, 8);
  }
}

function repoIdToNpubEntity(repoId: string, fallbackHex: string): string {
  const parts = repoId.split("/");
  const hex = parts[0] || fallbackHex;
  return hexPubkeyToNpub(hex);
}

export interface RepoStats {
  repoId: string;
  repoName: string;
  entity: string;
  activityCount: number;
  prCount: number;
  commitCount: number;
  issueCount: number;
  zapCount: number;
  lastActivity: number;
}

export interface UserStats {
  pubkey: string;
  activityCount: number;
  prMergedCount: number;
  commitCount: number;
  bountyClaimedCount: number;
  reposCreatedCount: number;
  lastActivity: number;
}

/**
 * Helper: Check if repo is deleted
 */
function isRepoDeleted(entity: string, repo: string): boolean {
  const deletedRepos = JSON.parse(
    localStorage.getItem("gittr_deleted_repos") || "[]"
  ) as Array<{ entity: string; repo: string; deletedAt: number }>;
  const repoKey = `${entity}/${repo}`.toLowerCase();
  return deletedRepos.some(
    (d) => `${d.entity}/${d.repo}`.toLowerCase() === repoKey
  );
}

/**
 * Helper: Check if user has access to repo (owner or write access)
 */
function userHasAccessToRepo(
  userPubkey: string | null | undefined,
  repo: any
): boolean {
  if (!userPubkey || !repo) return false;

  const normalizedPubkey = userPubkey.toLowerCase();

  // Check if owner
  if (repo.ownerPubkey && repo.ownerPubkey.toLowerCase() === normalizedPubkey) {
    return true;
  }

  // Check contributors for write access (owner, maintainer, or contributor with weight > 0)
  if (repo.contributors && Array.isArray(repo.contributors)) {
    const contributor = repo.contributors.find(
      (c: any) => c.pubkey && c.pubkey.toLowerCase() === normalizedPubkey
    );
    if (contributor) {
      // Owner or maintainer have write access
      if (contributor.role === "owner" || contributor.role === "maintainer")
        return true;
      // Contributor with weight > 0 has write access
      if (contributor.weight && contributor.weight > 0) return true;
    }
  }

  return false;
}

/**
 * Get top 10 most active repositories
 * @param userPubkey - Optional: filter to repos where user has access (owner or write access)
 */
export function getTopRepos(
  count = 10,
  userPubkey?: string | null
): RepoStats[] {
  const activities = getActivities();
  const repos = JSON.parse(
    localStorage.getItem("gittr_repos") || "[]"
  ) as any[];
  const repoMap = new Map<string, RepoStats>();

  let skippedRepoCreated = 0;
  let processedActivities = 0;

  activities.forEach((activity) => {
    if (!activity.repo || !activity.entity) return;

    // CRITICAL: Don't count repo_created or repo_imported as activity - repos are metadata, not activities
    if (activity.type === "repo_created" || activity.type === "repo_imported") {
      skippedRepoCreated++;
      return;
    }

    // Extract entity and repo name from activity.repo (format: "entity/repo")
    const [activityEntity, activityRepo] = activity.repo.split("/");
    if (!activityEntity || !activityRepo) return;

    // Skip if repo is deleted
    if (isRepoDeleted(activityEntity, activityRepo)) return;

    // If userPubkey provided, only include repos where user has access
    if (userPubkey) {
      const repo = repos.find((r: any) => {
        const rEntity = r.entity || "";
        const rRepo = r.repo || r.slug || "";
        return (
          rEntity.toLowerCase() === activityEntity.toLowerCase() &&
          rRepo.toLowerCase() === activityRepo.toLowerCase()
        );
      });

      if (!repo || !userHasAccessToRepo(userPubkey, repo)) return;
    }

    processedActivities++;

    const existing = repoMap.get(activity.repo) || {
      repoId: activity.repo,
      repoName: activity.repoName || activityRepo,
      entity: activity.entity || activityEntity,
      activityCount: 0,
      prCount: 0,
      commitCount: 0,
      issueCount: 0,
      zapCount: 0,
      lastActivity: 0,
    };

    existing.activityCount++;
    existing.lastActivity = Math.max(existing.lastActivity, activity.timestamp);

    if (activity.type === "pr_created" || activity.type === "pr_merged") {
      existing.prCount++;
    }
    if (activity.type === "commit_created") {
      existing.commitCount++;
    }
    if (activity.type === "issue_created" || activity.type === "issue_closed") {
      existing.issueCount++;
    }
    if (activity.type === "repo_zapped") {
      existing.zapCount++;
    }

    repoMap.set(activity.repo, existing);
  });

  // Sort by activity count DESCENDING (highest first) - show repos with most activity at top
  const result = Array.from(repoMap.values())
    .filter(
      (repo) =>
        repo.activityCount > 0 &&
        !isPublisherBlocklisted(resolveEntityToPubkey(repo.entity) || undefined)
    )
    .sort((a, b) => {
      // Sort by activity count DESCENDING (highest first)
      if (b.activityCount !== a.activityCount) {
        return b.activityCount - a.activityCount;
      }
      // If same activity count, sort by last activity (most recent first)
      return b.lastActivity - a.lastActivity;
    })
    .slice(0, count);

  // Debug logging
  if (result.length === 0 && repoMap.size > 0) {
    const allCounts = Array.from(repoMap.values()).map((r) => r.activityCount);
    const maxCount = Math.max(...allCounts, 0);
    console.warn(
      `⚠️ [getTopRepos] No repos with activities found. Max activity: ${maxCount}, Skipped ${skippedRepoCreated} repo_created, processed ${processedActivities} activities, ${repoMap.size} repos in map`
    );
  } else if (result.length > 0) {
    console.log(
      `✅ [getTopRepos] Found ${result.length} repos. Top activity: ${
        result[0]?.activityCount || 0
      }, Repos: ${result
        .map((r) => `${r.repoName}(${r.activityCount})`)
        .join(", ")}`
    );
  }

  return result;
}

/**
 * Get most active developers (by PR merges)
 */
export function getTopDevsByPRs(count = 10): UserStats[] {
  const activities = getActivities();
  const userMap = new Map<string, UserStats>();

  activities.forEach((activity) => {
    if (activity.type !== "pr_merged") return;

    const existing = userMap.get(activity.user) || {
      pubkey: activity.user,
      activityCount: 0,
      prMergedCount: 0,
      commitCount: 0,
      bountyClaimedCount: 0,
      reposCreatedCount: 0,
      lastActivity: 0,
    };

    existing.prMergedCount++;
    existing.activityCount++;
    existing.lastActivity = Math.max(existing.lastActivity, activity.timestamp);

    userMap.set(activity.user, existing);
  });

  return Array.from(userMap.values())
    .filter((u) => !isPublisherBlocklisted(u.pubkey))
    .sort((a, b) => b.prMergedCount - a.prMergedCount)
    .slice(0, count);
}

/**
 * Get most active bounty takers
 */
export function getTopBountyTakers(count = 10): UserStats[] {
  const activities = getActivities();
  const userMap = new Map<string, UserStats>();

  activities.forEach((activity) => {
    if (activity.type !== "bounty_claimed") return;

    const existing = userMap.get(activity.user) || {
      pubkey: activity.user,
      activityCount: 0,
      prMergedCount: 0,
      commitCount: 0,
      bountyClaimedCount: 0,
      reposCreatedCount: 0,
      lastActivity: 0,
    };

    existing.bountyClaimedCount++;
    existing.activityCount++;
    existing.lastActivity = Math.max(existing.lastActivity, activity.timestamp);

    userMap.set(activity.user, existing);
  });

  return Array.from(userMap.values())
    .filter((u) => !isPublisherBlocklisted(u.pubkey))
    .sort((a, b) => b.bountyClaimedCount - a.bountyClaimedCount)
    .slice(0, count);
}

/**
 * Get most active users (overall activity)
 * @param userPubkey - Optional: only count activities on repos where this user has access
 */
export function getTopUsers(
  count = 10,
  userPubkey?: string | null
): UserStats[] {
  const activities = getActivities();
  const userMap = new Map<string, UserStats>();

  // Also get repos to resolve full pubkeys from partial ones and check access
  const repos = JSON.parse(
    localStorage.getItem("gittr_repos") || "[]"
  ) as any[];

  activities.forEach((activity) => {
    // If userPubkey provided, only count activities on repos where user has access
    if (userPubkey && activity.repo && activity.entity) {
      const [activityEntity, activityRepo] = activity.repo.split("/");
      if (activityEntity && activityRepo) {
        // Skip if repo is deleted
        if (isRepoDeleted(activityEntity, activityRepo)) return;

        // Check if user has access
        const repo = repos.find((r: any) => {
          const rEntity = r.entity || "";
          const rRepo = r.repo || r.slug || "";
          return (
            rEntity.toLowerCase() === activityEntity.toLowerCase() &&
            rRepo.toLowerCase() === activityRepo.toLowerCase()
          );
        });

        if (!repo || !userHasAccessToRepo(userPubkey, repo)) return;
      }
    }
    // Only use full 64-char pubkeys - repos always have full pubkeys
    // If activity has npub, decode it. Otherwise must be full pubkey.
    let activityUserPubkey = activity.user;

    // If user is not a full pubkey, try to resolve npub only (no partial pubkeys)
    if (!activityUserPubkey || !/^[0-9a-f]{64}$/i.test(activityUserPubkey)) {
      // Only try to resolve npubs - repos should always have full pubkeys
      const resolved = resolveEntityToPubkey(activityUserPubkey);
      if (resolved) {
        activityUserPubkey = resolved;
      } else {
        // If it's not a full pubkey and not an npub, skip this activity
        // (shouldn't happen if activities are recorded correctly)
        return;
      }
    }

    // Skip if still not a valid full pubkey
    if (!activityUserPubkey || !/^[0-9a-f]{64}$/i.test(activityUserPubkey)) {
      return; // Skip invalid activities
    }

    const existing = userMap.get(activityUserPubkey) || {
      pubkey: activityUserPubkey,
      activityCount: 0,
      prMergedCount: 0,
      commitCount: 0,
      bountyClaimedCount: 0,
      reposCreatedCount: 0,
      lastActivity: 0,
    };

    existing.activityCount++;
    existing.lastActivity = Math.max(existing.lastActivity, activity.timestamp);

    if (activity.type === "pr_merged") {
      existing.prMergedCount++;
    }
    if (activity.type === "commit_created") {
      existing.commitCount++;
    }
    if (activity.type === "bounty_claimed") {
      existing.bountyClaimedCount++;
    }
    if (activity.type === "repo_created" || activity.type === "repo_imported") {
      existing.reposCreatedCount++;
    }

    userMap.set(activityUserPubkey, existing);
  });

  return Array.from(userMap.values())
    .filter((u) => !isPublisherBlocklisted(u.pubkey))
    .sort((a, b) => b.activityCount - a.activityCount)
    .slice(0, count);
}

/**
 * Get latest bounties (open issues with highest bounties)
 * Optionally filter by owner pubkey to show only user's own bounties
 */
export function getLatestBounties(
  count = 5,
  ownerPubkey?: string | null
): Array<{
  issueId: string;
  repoId: string;
  repoName: string;
  entity: string;
  title: string;
  bountyAmount: number;
  bountyStatus: "pending" | "paid" | "released" | "offline";
  createdAt: number;
}> {
  const repos = JSON.parse(localStorage.getItem("gittr_repos") || "[]");
  const bounties: Array<{
    issueId: string;
    repoId: string;
    repoName: string;
    entity: string;
    title: string;
    bountyAmount: number;
    bountyStatus: "pending" | "paid" | "released" | "offline";
    createdAt: number;
  }> = [];

  repos.forEach((repo: any) => {
    const entity =
      repo.entity || repo.slug?.split("/")[0] || repo.ownerPubkey?.slice(0, 8);
    const repoName =
      repo.repo || repo.slug?.split("/")[1] || repo.name || repo.slug;
    if (!entity || !repoName) return;

    // If filtering by owner, only include repos owned by that user
    if (ownerPubkey) {
      const repoOwnerPubkey =
        repo.ownerPubkey ||
        repo.contributors?.find((c: any) => c.weight === 100)?.pubkey;
      if (repoOwnerPubkey !== ownerPubkey) return; // Skip repos not owned by user
    }

    const issueKey = `gittr_issues__${entity}__${repoName}`;
    const issues = JSON.parse(localStorage.getItem(issueKey) || "[]");

    issues.forEach((issue: any) => {
      if (issue.status === "open" && issue.bountyAmount && issue.bountyStatus) {
        bounties.push({
          issueId: issue.id || issue.number,
          repoId: `${entity}/${repoName}`,
          repoName: repoName,
          entity: entity,
          title: issue.title || "Untitled",
          bountyAmount: issue.bountyAmount,
          bountyStatus: issue.bountyStatus,
          createdAt: issue.createdAt || Date.now(),
        });
      }
    });
  });

  return bounties
    .sort((a, b) => b.bountyAmount - a.bountyAmount)
    .slice(0, count);
}

/**
 * Get open bounties (available bounties with status "paid" on open issues)
 */
export function getOpenBounties(count = 5): Array<{
  issueId: string;
  repoId: string;
  repoName: string;
  entity: string;
  title: string;
  bountyAmount: number;
  createdAt: number;
}> {
  const repos = JSON.parse(localStorage.getItem("gittr_repos") || "[]");
  const bounties: Array<{
    issueId: string;
    repoId: string;
    repoName: string;
    entity: string;
    title: string;
    bountyAmount: number;
    createdAt: number;
  }> = [];

  repos.forEach((repo: any) => {
    const entity =
      repo.entity || repo.slug?.split("/")[0] || repo.ownerPubkey?.slice(0, 8);
    const repoName =
      repo.repo || repo.slug?.split("/")[1] || repo.name || repo.slug;
    if (!entity || !repoName) return;

    const issueKey = `gittr_issues__${entity}__${repoName}`;
    const issues = JSON.parse(localStorage.getItem(issueKey) || "[]");

    issues.forEach((issue: any) => {
      // Only include open issues with paid bounties (available to claim)
      if (
        issue.status === "open" &&
        issue.bountyAmount &&
        issue.bountyStatus === "paid"
      ) {
        bounties.push({
          issueId: issue.id || issue.number,
          repoId: `${entity}/${repoName}`,
          repoName: repoName,
          entity: entity,
          title: issue.title || "Untitled",
          bountyAmount: issue.bountyAmount,
          createdAt: issue.createdAt || Date.now(),
        });
      }
    });
  });

  return bounties
    .sort((a, b) => b.bountyAmount - a.bountyAmount)
    .slice(0, count);
}

/**
 * Get user's own bounty statistics (total pending, paid, released)
 */
export function getOwnBountyStats(ownerPubkey: string | null): {
  totalPending: number;
  totalPaid: number;
  totalReleased: number;
  totalAmount: number;
  pendingAmount: number;
  paidAmount: number;
  releasedAmount: number;
} {
  if (!ownerPubkey) {
    return {
      totalPending: 0,
      totalPaid: 0,
      totalReleased: 0,
      totalAmount: 0,
      pendingAmount: 0,
      paidAmount: 0,
      releasedAmount: 0,
    };
  }

  const repos = JSON.parse(localStorage.getItem("gittr_repos") || "[]");
  let totalPending = 0;
  let totalPaid = 0;
  let totalReleased = 0;
  let pendingAmount = 0;
  let paidAmount = 0;
  let releasedAmount = 0;

  repos.forEach((repo: any) => {
    // Only count repos owned by this user
    const repoOwnerPubkey =
      repo.ownerPubkey ||
      repo.contributors?.find((c: any) => c.weight === 100)?.pubkey;
    if (repoOwnerPubkey !== ownerPubkey) return;

    const entity =
      repo.entity || repo.slug?.split("/")[0] || repo.ownerPubkey?.slice(0, 8);
    const repoName =
      repo.repo || repo.slug?.split("/")[1] || repo.name || repo.slug;
    if (!entity || !repoName) return;

    const issueKey = `gittr_issues__${entity}__${repoName}`;
    const issues = JSON.parse(localStorage.getItem(issueKey) || "[]");

    issues.forEach((issue: any) => {
      if (issue.bountyAmount && issue.bountyStatus) {
        const amount = issue.bountyAmount || 0;
        if (issue.bountyStatus === "pending") {
          totalPending++;
          pendingAmount += amount;
        } else if (issue.bountyStatus === "paid") {
          totalPaid++;
          paidAmount += amount;
        } else if (issue.bountyStatus === "released") {
          totalReleased++;
          releasedAmount += amount;
        }
      }
    });
  });

  return {
    totalPending,
    totalPaid,
    totalReleased,
    totalAmount: pendingAmount + paidAmount + releasedAmount,
    pendingAmount,
    paidAmount,
    releasedAmount,
  };
}

/**
 * Get recent activity (commits, PR merges, releases, etc.)
 * @param count - Number of activities to return
 * @param userPubkey - Optional: filter by specific user's pubkey and only show activities on repos where user has access
 */
export function getRecentActivity(
  count = 10,
  userPubkey?: string | null
): Activity[] {
  const activities = getActivities();
  const repos = JSON.parse(
    localStorage.getItem("gittr_repos") || "[]"
  ) as any[];
  let filtered = activities;

  // If userPubkey provided, filter by user AND only show activities on repos where user has access
  if (userPubkey) {
    const normalized = userPubkey.toLowerCase();
    filtered = activities.filter((a) => {
      if (!a.user || !a.repo || !a.entity) return false;

      // Match user pubkey
      const activityUser = a.user.toLowerCase();
      const userMatches =
        activityUser === normalized ||
        (normalized.length === 8 && activityUser.startsWith(normalized)) ||
        (normalized.length === 8 &&
          activityUser.length === 64 &&
          activityUser.startsWith(normalized));

      if (!userMatches) return false;

      // Extract entity and repo from activity.repo
      const [activityEntity, activityRepo] = a.repo.split("/");
      if (!activityEntity || !activityRepo) return false;

      // Skip if repo is deleted
      if (isRepoDeleted(activityEntity, activityRepo)) return false;

      // Check if user has access to this repo
      const repo = repos.find((r: any) => {
        const rEntity = r.entity || "";
        const rRepo = r.repo || r.slug || "";
        return (
          rEntity.toLowerCase() === activityEntity.toLowerCase() &&
          rRepo.toLowerCase() === activityRepo.toLowerCase()
        );
      });

      // Only include if user has access to the repo
      return repo && userHasAccessToRepo(userPubkey, repo);
    });
  } else {
    // Even without userPubkey, filter out deleted repos
    filtered = activities.filter((a) => {
      if (!a.repo || !a.entity) return false;
      const [activityEntity, activityRepo] = a.repo.split("/");
      if (!activityEntity || !activityRepo) return false;
      return !isRepoDeleted(activityEntity, activityRepo);
    });
  }

  return filtered.sort((a, b) => b.timestamp - a.timestamp).slice(0, count);
}

/**
 * True if the user can manage PRs/issues for this repo (owner or maintainer).
 * Matches the scope used by getOpenPRsAndIssues when userPubkey is set.
 */
export function repoAllowsUserToManagePRsAndIssues(
  repo: any,
  userPubkey: string
): boolean {
  const entity =
    repo.entity || repo.slug?.split("/")[0] || repo.ownerPubkey?.slice(0, 8);
  const repoName =
    repo.repo || repo.slug?.split("/")[1] || repo.name || repo.slug;
  if (!entity || !repoName) return false;
  if (isRepoDeleted(entity, repoName)) return false;

  const normalizedPubkey = userPubkey.toLowerCase();
  const isOwner =
    repo.ownerPubkey && repo.ownerPubkey.toLowerCase() === normalizedPubkey;
  if (isOwner) return true;

  const contributor = repo.contributors?.find(
    (c: any) => c.pubkey && c.pubkey.toLowerCase() === normalizedPubkey
  );
  const isMaintainer =
    contributor &&
    (contributor.role === "maintainer" ||
      (contributor.weight &&
        contributor.weight >= 50 &&
        contributor.weight < 100));
  return !!isMaintainer;
}

/**
 * Get open PRs and Issues statistics
 * @param userPubkey - Optional: filter to repos where user has write access (owner or maintainer only)
 *                      CRITICAL: Only shows repos where user can merge PRs/manage issues
 */
export function getOpenPRsAndIssues(userPubkey?: string | null): {
  openPRs: number;
  openIssues: number;
  recentPRs: Array<{
    id: string;
    title: string;
    repoId: string;
    repoName: string;
    entity: string;
    author: string;
    createdAt: number;
  }>;
  recentIssues: Array<{
    id: string;
    title: string;
    repoId: string;
    repoName: string;
    entity: string;
    author: string;
    createdAt: number;
  }>;
} {
  const repos = JSON.parse(localStorage.getItem("gittr_repos") || "[]");
  const allPRs: Array<{
    id: string;
    title: string;
    repoId: string;
    repoName: string;
    entity: string;
    author: string;
    createdAt: number;
  }> = [];
  const allIssues: Array<{
    id: string;
    title: string;
    repoId: string;
    repoName: string;
    entity: string;
    author: string;
    createdAt: number;
  }> = [];

  repos.forEach((repo: any) => {
    const entity =
      repo.entity || repo.slug?.split("/")[0] || repo.ownerPubkey?.slice(0, 8);
    const repoName =
      repo.repo || repo.slug?.split("/")[1] || repo.name || repo.slug;
    if (!entity || !repoName) return;
    if (isRepoDeleted(entity, repoName)) return;

    if (userPubkey && !repoAllowsUserToManagePRsAndIssues(repo, userPubkey)) {
      return;
    }

    // Get PRs
    const prKey = `gittr_prs__${entity}__${repoName}`;
    const prs = JSON.parse(localStorage.getItem(prKey) || "[]");
    prs.forEach((pr: any) => {
      if (pr.status === "open") {
        allPRs.push({
          id: pr.id || pr.number,
          title: pr.title || "Untitled PR",
          repoId: `${entity}/${repoName}`,
          repoName: repoName,
          entity: entity,
          author: pr.author || "",
          createdAt: pr.createdAt || Date.now(),
        });
      }
    });

    // Get Issues
    const issueKey = `gittr_issues__${entity}__${repoName}`;
    const issues = JSON.parse(localStorage.getItem(issueKey) || "[]");
    issues.forEach((issue: any) => {
      if (issue.status === "open") {
        allIssues.push({
          id: issue.id || issue.number,
          title: issue.title || "Untitled Issue",
          repoId: `${entity}/${repoName}`,
          repoName: repoName,
          entity: entity,
          author: issue.author || "",
          createdAt: issue.createdAt || Date.now(),
        });
      }
    });
  });

  return {
    openPRs: allPRs.length,
    openIssues: allIssues.length,
    recentPRs: allPRs.sort((a, b) => b.createdAt - a.createdAt).slice(0, 5),
    recentIssues: allIssues
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 5),
  };
}

/**
 * Get recent bounty activities for a user
 * @param userPubkey - User's pubkey to filter activities
 * @param count - Number of activities to return
 */
export function getRecentBountyActivities(
  userPubkey: string | null,
  count = 5
): Activity[] {
  if (!userPubkey) return [];

  const activities = getActivities();
  const repos = JSON.parse(
    localStorage.getItem("gittr_repos") || "[]"
  ) as any[];
  const normalized = userPubkey.toLowerCase();

  // Filter for bounty-related activities by this user
  const bountyActivities = activities.filter((a) => {
    if (!a.user || !a.repo || !a.entity) return false;

    // Only bounty_created and bounty_claimed activities
    if (a.type !== "bounty_created" && a.type !== "bounty_claimed")
      return false;

    // Match user pubkey
    const activityUser = a.user.toLowerCase();
    const userMatches =
      activityUser === normalized ||
      (normalized.length === 8 && activityUser.startsWith(normalized)) ||
      (normalized.length === 8 &&
        activityUser.length === 64 &&
        activityUser.startsWith(normalized));

    if (!userMatches) return false;

    // Extract entity and repo from activity.repo
    const [activityEntity, activityRepo] = a.repo.split("/");
    if (!activityEntity || !activityRepo) return false;

    // Skip if repo is deleted
    if (isRepoDeleted(activityEntity, activityRepo)) return false;

    // Check if user has access to this repo (for bounty_created, user should be owner)
    const repo = repos.find((r: any) => {
      const rEntity = r.entity || "";
      const rRepo = r.repo || r.slug || "";
      return (
        rEntity.toLowerCase() === activityEntity.toLowerCase() &&
        rRepo.toLowerCase() === activityRepo.toLowerCase()
      );
    });

    // For bounty_created, user should have access (they created it)
    // For bounty_claimed, user is the claimer, so always include
    if (
      a.type === "bounty_created" &&
      repo &&
      !userHasAccessToRepo(userPubkey, repo)
    )
      return false;

    return true;
  });

  return bountyActivities
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, count);
}

/**
 * Get user's bounty activity stats (bounties set out, bounties claimed)
 */
export function getUserBountyActivityStats(userPubkey: string | null): {
  bountiesSetOut: number;
  bountiesClaimed: number;
  totalSetOutAmount: number;
  totalClaimedAmount: number;
} {
  if (!userPubkey) {
    return {
      bountiesSetOut: 0,
      bountiesClaimed: 0,
      totalSetOutAmount: 0,
      totalClaimedAmount: 0,
    };
  }

  const activities = getActivities();
  const normalized = userPubkey.toLowerCase();

  let bountiesSetOut = 0;
  let bountiesClaimed = 0;
  let totalSetOutAmount = 0;
  let totalClaimedAmount = 0;

  activities.forEach((a) => {
    if (!a.user) return;

    const activityUser = a.user.toLowerCase();
    const userMatches =
      activityUser === normalized ||
      (normalized.length === 8 && activityUser.startsWith(normalized)) ||
      (normalized.length === 8 &&
        activityUser.length === 64 &&
        activityUser.startsWith(normalized));

    if (!userMatches) return;

    if (a.type === "bounty_created") {
      bountiesSetOut++;
      totalSetOutAmount += a.metadata?.bountyAmount || 0;
    } else if (a.type === "bounty_claimed") {
      bountiesClaimed++;
      totalClaimedAmount += a.metadata?.bountyAmount || 0;
    }
  });

  return {
    bountiesSetOut,
    bountiesClaimed,
    totalSetOutAmount,
    totalClaimedAmount,
  };
}

/**
 * Get platform-wide bounty statistics (all bounties across all repos)
 */
export function getPlatformBountyStats(): {
  totalAvailable: number; // Total sats in paid bounties
  pendingPayment: number; // Total sats in pending bounties
  availableBounties: number; // Count of paid bounties
  totalBounties: number; // Total count of all bounties
  pendingCount: number; // Count of pending bounties
  releasedCount: number; // Count of released bounties
  offlineCount: number; // Count of offline bounties
} {
  const repos = JSON.parse(localStorage.getItem("gittr_repos") || "[]");
  let totalAvailable = 0;
  let pendingPayment = 0;
  let availableBounties = 0;
  let totalBounties = 0;
  let pendingCount = 0;
  let releasedCount = 0;
  let offlineCount = 0;

  repos.forEach((repo: any) => {
    const entity =
      repo.entity || repo.slug?.split("/")[0] || repo.ownerPubkey?.slice(0, 8);
    const repoName =
      repo.repo || repo.slug?.split("/")[1] || repo.name || repo.slug;
    if (!entity || !repoName) return;

    const issueKey = `gittr_issues__${entity}__${repoName}`;
    const issues = JSON.parse(localStorage.getItem(issueKey) || "[]");

    issues.forEach((issue: any) => {
      if (issue.bountyAmount && issue.bountyStatus) {
        const amount = issue.bountyAmount || 0;
        totalBounties++;

        if (issue.bountyStatus === "pending") {
          pendingCount++;
          pendingPayment += amount;
        } else if (issue.bountyStatus === "paid") {
          availableBounties++;
          totalAvailable += amount;
        } else if (issue.bountyStatus === "released") {
          releasedCount++;
        } else if (issue.bountyStatus === "offline") {
          offlineCount++;
        }
      }
    });
  });

  return {
    totalAvailable,
    pendingPayment,
    availableBounties,
    totalBounties,
    pendingCount,
    releasedCount,
    offlineCount,
  };
}

/**
 * Count activities from Nostr for ALL repos (platform-wide)
 * Returns map of repoId -> activity counts
 */
export function countRepoActivitiesFromNostr(
  subscribe: (
    filters: any[],
    relays: string[],
    onEvent: (event: any, isAfterEose: boolean, relayURL?: string) => void,
    maxDelayms?: number,
    onEose?: (relayUrl: string, minCreatedAt: number) => void,
    options?: any
  ) => () => void,
  relays: string[],
  sinceDays = 90 // Count activity from last 90 days (increased from 30 for better coverage)
): Promise<Map<string, RepoStats>> {
  // CRITICAL: Only use GRASP/git relays - regular relays don't have git events!
  const { getGraspServers } = require("@/lib/utils/grasp-servers");
  const graspRelays = getGraspServers(relays);
  const activeRelays = graspRelays.length > 0 ? graspRelays : relays; // Fallback if no GRASP relays

  console.log(
    `🔍 [Nostr Repo Stats] Starting query for all repos using ${activeRelays.length} GRASP/git relays (filtered from ${relays.length} total):`,
    activeRelays
  );

  return new Promise((resolve) => {
    const repoMap = new Map<string, RepoStats>();
    // REMOVED since filter - count ALL activities from all time, not just last 90 days
    // This ensures we capture all historical activity, not just recent

    let eoseCount = 0;
    const expectedEose = activeRelays.length;
    let resolved = false;

    const filters = [
      // Repo announcements (kind 30617) - count unique repos (NO since - get all)
      {
        kinds: [KIND_REPOSITORY_NIP34],
        limit: 5000, // Increased limit to get more repos
      },
      // Repo state events (kind 30618) - indicate pushes (NO since - get all)
      {
        kinds: [KIND_REPOSITORY_STATE],
        limit: 5000, // Increased limit to get all pushes
      },
      // PR events (kind 1618) (NO since - get all)
      {
        kinds: [KIND_PULL_REQUEST],
        limit: 2000,
      },
      // PR merged status (kind 1631) (NO since - get all)
      {
        kinds: [KIND_STATUS_APPLIED],
        "#k": ["1618"], // Only PR status events
        limit: 1000,
      },
      // Issue events (kind 1621) (NO since - get all)
      {
        kinds: [KIND_ISSUE],
        limit: 2000,
      },
      // Issue closed status (kind 1632) (NO since - get all)
      {
        kinds: [KIND_STATUS_CLOSED],
        "#k": ["1621"], // Only issue status events
        limit: 1000,
      },
    ];

    const unsub = subscribe(
      filters,
      activeRelays,
      (event, _isAfterEose, _relayURL) => {
        // Count repo announcements (kind 30617) - DON'T count as activity, just ensure repo exists
        // Repo announcements are metadata, not activities. Activities are pushes, PRs, issues.
        if (event.kind === KIND_REPOSITORY_NIP34) {
          const dTag = event.tags?.find(
            (t: any) => Array.isArray(t) && t[0] === "d"
          );
          const repoName = dTag?.[1];
          if (repoName && event.pubkey && typeof repoName === "string") {
            const repoId = `${event.pubkey}/${repoName}`;
            // Only create repo entry if it doesn't exist, don't count announcement as activity
            if (!repoMap.has(repoId)) {
              repoMap.set(repoId, {
                repoId,
                repoName: repoName,
                entity: event.pubkey,
                activityCount: 0,
                prCount: 0,
                commitCount: 0,
                issueCount: 0,
                zapCount: 0,
                lastActivity: event.created_at * 1000, // Convert to milliseconds
              });
            }
          }
        }
        // Count repo state events (kind 30618) - indicate pushes
        else if (event.kind === KIND_REPOSITORY_STATE) {
          const dTag = event.tags?.find(
            (t: any) => Array.isArray(t) && t[0] === "d"
          );
          const repoName = dTag?.[1];
          if (repoName && event.pubkey && typeof repoName === "string") {
            const repoId = `${event.pubkey}/${repoName}`;
            const existing = repoMap.get(repoId) || {
              repoId,
              repoName: repoName,
              entity: event.pubkey,
              activityCount: 0,
              prCount: 0,
              commitCount: 0,
              issueCount: 0,
              zapCount: 0,
              lastActivity: event.created_at * 1000,
            };
            existing.commitCount++;
            existing.activityCount++;
            existing.lastActivity = Math.max(
              existing.lastActivity,
              event.created_at * 1000
            );
            repoMap.set(repoId, existing);
          }
        }
        // Count PR events (kind 1618)
        else if (event.kind === KIND_PULL_REQUEST) {
          const aTag = event.tags?.find(
            (t: any) => Array.isArray(t) && t[0] === "a"
          );
          if (aTag && aTag[1]) {
            // Extract repo from "a" tag: "30617:<owner-pubkey>:<repo-name>"
            const aValue = aTag[1] as string;
            const match = aValue.match(/^30617:([0-9a-f]{64}):(.+)$/i);
            if (match && match[1] && match[2]) {
              const [, ownerPubkey, repoName] = match;
              const repoId = `${ownerPubkey}/${repoName}`;
              const existing = repoMap.get(repoId) || {
                repoId,
                repoName: repoName,
                entity: ownerPubkey,
                activityCount: 0,
                prCount: 0,
                commitCount: 0,
                issueCount: 0,
                zapCount: 0,
                lastActivity: event.created_at * 1000,
              };
              existing.prCount++;
              existing.activityCount++;
              existing.lastActivity = Math.max(
                existing.lastActivity,
                event.created_at * 1000
              );
              repoMap.set(repoId, existing);
            }
          }
        }
        // Count PR merged status (kind 1631)
        else if (event.kind === KIND_STATUS_APPLIED) {
          const kTag = event.tags?.find(
            (t: any) => Array.isArray(t) && t[0] === "k"
          );
          if (kTag && kTag[1] === "1618") {
            const aTag = event.tags?.find(
              (t: any) => Array.isArray(t) && t[0] === "a"
            );
            if (aTag && aTag[1]) {
              const aValue = aTag[1] as string;
              const match = aValue.match(/^30617:([0-9a-f]{64}):(.+)$/i);
              if (match && match[1] && match[2]) {
                const [, ownerPubkey, repoName] = match;
                const repoId = `${ownerPubkey}/${repoName}`;
                const existing = repoMap.get(repoId) || {
                  repoId,
                  repoName: repoName,
                  entity: ownerPubkey,
                  activityCount: 0,
                  prCount: 0,
                  commitCount: 0,
                  issueCount: 0,
                  zapCount: 0,
                  lastActivity: event.created_at * 1000,
                };
                existing.prCount++;
                existing.activityCount++;
                existing.lastActivity = Math.max(
                  existing.lastActivity,
                  event.created_at * 1000
                );
                repoMap.set(repoId, existing);
              }
            }
          }
        }
        // Count issue events (kind 1621)
        else if (event.kind === KIND_ISSUE) {
          const aTag = event.tags?.find(
            (t: any) => Array.isArray(t) && t[0] === "a"
          );
          if (aTag && aTag[1]) {
            const aValue = aTag[1] as string;
            const match = aValue.match(/^30617:([0-9a-f]{64}):(.+)$/i);
            if (match && match[1] && match[2]) {
              const [, ownerPubkey, repoName] = match;
              const repoId = `${ownerPubkey}/${repoName}`;
              const existing = repoMap.get(repoId) || {
                repoId,
                repoName: repoName,
                entity: ownerPubkey,
                activityCount: 0,
                prCount: 0,
                commitCount: 0,
                issueCount: 0,
                zapCount: 0,
                lastActivity: event.created_at * 1000,
              };
              existing.issueCount++;
              existing.activityCount++;
              existing.lastActivity = Math.max(
                existing.lastActivity,
                event.created_at * 1000
              );
              repoMap.set(repoId, existing);
            }
          }
        }
        // Count issue closed status (kind 1632)
        else if (event.kind === KIND_STATUS_CLOSED) {
          const kTag = event.tags?.find(
            (t: any) => Array.isArray(t) && t[0] === "k"
          );
          if (kTag && kTag[1] === "1621") {
            const aTag = event.tags?.find(
              (t: any) => Array.isArray(t) && t[0] === "a"
            );
            if (aTag && aTag[1]) {
              const aValue = aTag[1] as string;
              const match = aValue.match(/^30617:([0-9a-f]{64}):(.+)$/i);
              if (match && match[1] && match[2]) {
                const [, ownerPubkey, repoName] = match;
                const repoId = `${ownerPubkey}/${repoName}`;
                const existing = repoMap.get(repoId) || {
                  repoId,
                  repoName: repoName,
                  entity: ownerPubkey,
                  activityCount: 0,
                  prCount: 0,
                  commitCount: 0,
                  issueCount: 0,
                  zapCount: 0,
                  lastActivity: event.created_at * 1000,
                };
                existing.issueCount++;
                existing.activityCount++;
                existing.lastActivity = Math.max(
                  existing.lastActivity,
                  event.created_at * 1000
                );
                repoMap.set(repoId, existing);
              }
            }
          }
        }
      },
      undefined, // maxDelayms: cannot use with onEose, so leave undefined
      (_relayUrl: string, _minCreatedAt: number) => {
        eoseCount++;
        if (eoseCount >= expectedEose && !resolved) {
          resolved = true;
          setTimeout(() => {
            unsub();
            console.log(
              `✅ [Nostr Repo Stats] Counted activities for ${repoMap.size} repos from Nostr`
            );
            resolve(repoMap);
          }, 250);
        }
      },
      {} // options parameter
    );

    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        unsub();
        const totalActivities = Array.from(repoMap.values()).reduce(
          (sum, r) => sum + r.activityCount,
          0
        );
        const reposWithActivity = Array.from(repoMap.values()).filter(
          (r) => r.activityCount > 0
        ).length;
        console.log(
          `⏱️ [Nostr Repo Stats] Timeout after 7s (EOSE: ${eoseCount}/${expectedEose}), returning counts:`,
          repoMap.size,
          "repos,",
          reposWithActivity,
          "with activity,",
          totalActivities,
          "total activities"
        );
        resolve(repoMap);
      }
    }, 7000);
  });
}

/**
 * Count activities from Nostr for ALL users (platform-wide)
 * Returns map of pubkey -> activity counts
 */
export function countUserActivitiesFromNostr(
  subscribe: (
    filters: any[],
    relays: string[],
    onEvent: (event: any, isAfterEose: boolean, relayURL?: string) => void,
    maxDelayms?: number,
    onEose?: (relayUrl: string, minCreatedAt: number) => void,
    options?: any
  ) => () => void,
  relays: string[],
  sinceDays = 90 // Count activity from last 90 days (increased from 30 for better coverage)
): Promise<Map<string, UserStats>> {
  // Use the full relay set passed in (git + general relays). Issues/PRs are often on nos.lol etc.
  const activeRelays = relays.filter(Boolean);
  const useSince =
    sinceDays > 0 && sinceDays < 36500
      ? Math.floor((Date.now() - sinceDays * 24 * 60 * 60 * 1000) / 1000)
      : undefined;

  console.log(
    `🔍 [Nostr User Stats] Starting query for all users using ${activeRelays.length} relays:`,
    activeRelays
  );

  return new Promise((resolve) => {
    const userMap = new Map<string, UserStats>();
    const seenRepos = new Map<string, Set<string>>(); // Track unique repos per user (pubkey -> Set<repoId>)

    let eoseCount = 0;
    const expectedEose = activeRelays.length;
    let resolved = false;

    const withSince = (extra: Record<string, unknown>) =>
      useSince != null ? { ...extra, since: useSince } : extra;

    const filters = [
      withSince({ kinds: [KIND_REPOSITORY_NIP34], limit: 5000 }),
      withSince({ kinds: [KIND_REPOSITORY_STATE], limit: 5000 }),
      withSince({ kinds: [KIND_PULL_REQUEST], limit: 2000 }),
      withSince({ kinds: [KIND_STATUS_APPLIED], "#k": ["1618"], limit: 1000 }),
      withSince({ kinds: [KIND_ISSUE], limit: 2000 }),
      withSince({ kinds: [KIND_STATUS_CLOSED], "#k": ["1621"], limit: 1000 }),
    ];

    const unsub = subscribe(
      filters,
      activeRelays,
      (event, _isAfterEose, _relayURL) => {
        const userPubkey = event.pubkey;
        if (!userPubkey || !/^[0-9a-f]{64}$/i.test(userPubkey)) return;

        const existing = userMap.get(userPubkey) || {
          pubkey: userPubkey,
          activityCount: 0,
          prMergedCount: 0,
          commitCount: 0,
          bountyClaimedCount: 0,
          reposCreatedCount: 0,
          lastActivity: event.created_at * 1000,
        };

        // Count repo announcements (kind 30617)
        if (event.kind === KIND_REPOSITORY_NIP34) {
          const dTag = event.tags?.find(
            (t: any) => Array.isArray(t) && t[0] === "d"
          );
          const repoName = dTag?.[1];
          if (repoName) {
            const repoId = `${userPubkey}/${repoName}`;
            if (!seenRepos.has(userPubkey)) {
              seenRepos.set(userPubkey, new Set());
            }
            if (!seenRepos.get(userPubkey)!.has(repoId)) {
              seenRepos.get(userPubkey)!.add(repoId);
              existing.reposCreatedCount++;
            }
            existing.activityCount++;
            existing.lastActivity = Math.max(
              existing.lastActivity,
              event.created_at * 1000
            );
          }
        }
        // Count repo state events (kind 30618) - indicate pushes
        else if (event.kind === KIND_REPOSITORY_STATE) {
          existing.commitCount++;
          existing.activityCount++;
          existing.lastActivity = Math.max(
            existing.lastActivity,
            event.created_at * 1000
          );
        }
        // Count PR events (kind 1618)
        else if (event.kind === KIND_PULL_REQUEST) {
          existing.activityCount++;
          existing.lastActivity = Math.max(
            existing.lastActivity,
            event.created_at * 1000
          );
        }
        // Count PR merged status (kind 1631)
        else if (event.kind === KIND_STATUS_APPLIED) {
          const kTag = event.tags?.find(
            (t: any) => Array.isArray(t) && t[0] === "k"
          );
          if (kTag && kTag[1] === "1618") {
            existing.prMergedCount++;
            existing.activityCount++;
            existing.lastActivity = Math.max(
              existing.lastActivity,
              event.created_at * 1000
            );
          }
        }
        // Count issue events (kind 1621)
        else if (event.kind === KIND_ISSUE) {
          existing.activityCount++;
          existing.lastActivity = Math.max(
            existing.lastActivity,
            event.created_at * 1000
          );
        }
        // Count issue closed status (kind 1632)
        else if (event.kind === KIND_STATUS_CLOSED) {
          const kTag = event.tags?.find(
            (t: any) => Array.isArray(t) && t[0] === "k"
          );
          if (kTag && kTag[1] === "1621") {
            existing.activityCount++;
            existing.lastActivity = Math.max(
              existing.lastActivity,
              event.created_at * 1000
            );
          }
        }

        userMap.set(userPubkey, existing);
      },
      undefined, // maxDelayms: cannot use with onEose, so leave undefined
      (relayUrl: string, minCreatedAt: number) => {
        eoseCount++;
        if (eoseCount >= expectedEose && !resolved) {
          resolved = true;
          setTimeout(() => {
            unsub();
            console.log(
              `✅ [Nostr User Stats] Counted activities for ${userMap.size} users from Nostr`
            );
            resolve(userMap);
          }, 250);
        }
      },
      {} // options parameter
    );

    // Match repo leaderboard timeout so server API returns both cards together
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        unsub();
        console.log(
          `⏱️ [Nostr User Stats] Timeout after 7s (EOSE: ${eoseCount}/${expectedEose}), returning counts:`,
          userMap.size,
          "users"
        );
        resolve(userMap);
      }
    }, 7000);
  });
}

/**
 * Get top repos from Nostr (network source of truth)
 * Counts directly from Nostr events, not localStorage
 */
export async function getTopReposFromNostr(
  subscribe: (
    filters: any[],
    relays: string[],
    onEvent: (event: any, isAfterEose: boolean, relayURL?: string) => void,
    maxDelayms?: number,
    onEose?: (relayUrl: string, minCreatedAt: number) => void,
    options?: any
  ) => () => void,
  relays: string[],
  count = 10
): Promise<RepoStats[]> {
  try {
    if (!subscribe || typeof subscribe !== "function") {
      console.error(
        `❌ [getTopReposFromNostr] subscribe is not a function:`,
        typeof subscribe
      );
      return [];
    }

    // CRITICAL: countRepoActivitiesFromNostr already filters to GRASP servers internally
    // Don't filter here again - pass all relays and let countRepoActivitiesFromNostr handle filtering
    // This ensures we don't accidentally filter out relays that might be needed
    console.log(
      `🔍 [getTopReposFromNostr] Starting query with ${relays.length} relays (will be filtered to GRASP servers internally)`
    );
    const repoMap = await countRepoActivitiesFromNostr(
      subscribe,
      relays,
      999999
    ); // All time (sinceDays param ignored now, but kept for API compatibility)

    // Debug: Log all repos with activity
    const allReposWithActivity = Array.from(repoMap.values()).filter(
      (repo) =>
        repo.activityCount > 0 &&
        !isPublisherBlocklisted(resolveEntityToPubkey(repo.entity) || undefined)
    );
    console.log(
      `📊 [getTopReposFromNostr] Total repos in map: ${repoMap.size}, repos with activity: ${allReposWithActivity.length}`
    );
    if (allReposWithActivity.length > 0) {
      console.log(
        `📋 [getTopReposFromNostr] All repos with activity:`,
        allReposWithActivity
          .slice(0, 20)
          .map((r) => `${r.repoName}(${r.activityCount})`)
          .join(", ")
      );
    }

    const repos = allReposWithActivity
      .sort((a, b) => {
        // Sort by activity count DESCENDING (highest first)
        if (b.activityCount !== a.activityCount) {
          return b.activityCount - a.activityCount;
        }
        // If same activity count, sort by last activity (most recent first)
        return b.lastActivity - a.lastActivity;
      })
      .slice(0, count);

    console.log(
      `✅ [getTopReposFromNostr] Found ${repos.length} repos from Nostr (${
        repoMap.size
      } total in map), top activity: ${repos[0]?.activityCount || 0}`
    );
    if (repos.length > 0) {
      console.log(
        `📋 [getTopReposFromNostr] Top repos:`,
        repos.map((r) => `${r.repoName}(${r.activityCount})`).join(", ")
      );
    } else if (allReposWithActivity.length > 0) {
      console.warn(
        `⚠️ [getTopReposFromNostr] No repos returned after sorting/slicing, but ${allReposWithActivity.length} repos have activity!`
      );
    }
    return repos;
  } catch (error) {
    console.error(`❌ [getTopReposFromNostr] Error:`, error);
    return []; // Return empty on error, let localStorage handle it
  }
}

/**
 * Get top users from Nostr (network source of truth)
 * Counts directly from Nostr events, not localStorage
 */
export async function getTopUsersFromNostr(
  subscribe: (
    filters: any[],
    relays: string[],
    onEvent: (event: any, isAfterEose: boolean, relayURL?: string) => void,
    maxDelayms?: number,
    onEose?: (relayUrl: string, minCreatedAt: number) => void,
    options?: any
  ) => () => void,
  relays: string[],
  count = 10
): Promise<UserStats[]> {
  console.log(
    `🔍 [getTopUsersFromNostr] Starting query with ${relays.length} relays`
  );
  const userMap = await countUserActivitiesFromNostr(
    subscribe,
    relays,
    999999
  ); // All-time (same window as platform repo leaderboard)
  const users = Array.from(userMap.values())
    .filter((u) => !isPublisherBlocklisted(u.pubkey) && u.activityCount > 0)
    .sort((a, b) => b.activityCount - a.activityCount)
    .slice(0, count);
  console.log(
    `✅ [getTopUsersFromNostr] Returning ${users.length} users (map size ${userMap.size})`
  );
  return users;
}

/** Recent repos by last Nostr event time (not activity score). */
export async function getRecentReposFromNostr(
  subscribe: (
    filters: any[],
    relays: string[],
    onEvent: (event: any, isAfterEose: boolean, relayURL?: string) => void,
    maxDelayms?: number,
    onEose?: (relayUrl: string, minCreatedAt: number) => void,
    options?: any
  ) => () => void,
  relays: string[],
  count = 12
): Promise<PlatformRecentRepo[]> {
  const repoMap = await countRepoActivitiesFromNostr(subscribe, relays, 999999);
  return Array.from(repoMap.values())
    .filter((r) => r.lastActivity > 0)
    .sort((a, b) => b.lastActivity - a.lastActivity)
    .slice(0, count)
    .map((r) => {
      const ownerHex = r.entity.toLowerCase();
      return {
        entity: repoIdToNpubEntity(r.repoId, ownerHex),
        repo: r.repoName,
        repoName: r.repoName,
        ownerPubkey: ownerHex,
        lastActivity: r.lastActivity,
      };
    });
}

function parseATagRepo(
  aValue: string
): { ownerPubkey: string; repoName: string } | null {
  const match = aValue.match(/^30617:([0-9a-f]{64}):(.+)$/i);
  if (!match?.[1] || !match[2]) return null;
  return { ownerPubkey: match[1].toLowerCase(), repoName: match[2] };
}

/** Platform-wide timeline for logged-out / fresh browsers. */
export function getRecentPlatformActivitiesFromNostr(
  subscribe: (
    filters: any[],
    relays: string[],
    onEvent: (event: any, isAfterEose: boolean, relayURL?: string) => void,
    maxDelayms?: number,
    onEose?: (relayUrl: string, minCreatedAt: number) => void,
    options?: any
  ) => () => void,
  relays: string[],
  count = 12
): Promise<PlatformRecentActivity[]> {
  const activeRelays = relays.filter(Boolean);
  const items: PlatformRecentActivity[] = [];
  const seen = new Set<string>();

  return new Promise((resolve) => {
    let resolved = false;
    let eoseCount = 0;
    const expectedEose = activeRelays.length;

    const push = (row: PlatformRecentActivity) => {
      if (seen.has(row.id)) return;
      seen.add(row.id);
      items.push(row);
    };

    const filters = [
      { kinds: [KIND_REPOSITORY_STATE], limit: 1500 },
      { kinds: [KIND_PULL_REQUEST], limit: 800 },
      { kinds: [KIND_ISSUE], limit: 800 },
      { kinds: [KIND_STATUS_APPLIED], "#k": ["1618"], limit: 400 },
      { kinds: [KIND_STATUS_CLOSED], "#k": ["1621"], limit: 400 },
    ];

    const unsub = subscribe(
      filters,
      activeRelays,
      (event) => {
        if (isPublisherBlocklisted(event.pubkey)) return;
        const ts = (event.created_at || 0) * 1000;
        const user = event.pubkey?.toLowerCase?.() || "";

        if (event.kind === KIND_REPOSITORY_STATE) {
          const dTag = event.tags?.find(
            (t: any) => Array.isArray(t) && t[0] === "d"
          );
          const repoName = dTag?.[1];
          if (!repoName || !user) return;
          const entity = hexPubkeyToNpub(user);
          push({
            id: event.id,
            type: "commit_created",
            timestamp: ts,
            user,
            entity,
            repo: repoName,
            repoName,
            metadata: { commitId: event.id },
          });
          return;
        }

        const aTag = event.tags?.find(
          (t: any) => Array.isArray(t) && t[0] === "a"
        );
        const parsed = aTag?.[1] ? parseATagRepo(String(aTag[1])) : null;
        if (!parsed) return;
        const entity = hexPubkeyToNpub(parsed.ownerPubkey);

        if (event.kind === KIND_PULL_REQUEST) {
          push({
            id: event.id,
            type: "pr_created",
            timestamp: ts,
            user,
            entity,
            repo: parsed.repoName,
            repoName: parsed.repoName,
          });
        } else if (event.kind === KIND_ISSUE) {
          push({
            id: event.id,
            type: "issue_created",
            timestamp: ts,
            user,
            entity,
            repo: parsed.repoName,
            repoName: parsed.repoName,
          });
        } else if (event.kind === KIND_STATUS_APPLIED) {
          push({
            id: event.id,
            type: "pr_merged",
            timestamp: ts,
            user,
            entity,
            repo: parsed.repoName,
            repoName: parsed.repoName,
          });
        } else if (event.kind === KIND_STATUS_CLOSED) {
          push({
            id: event.id,
            type: "issue_closed",
            timestamp: ts,
            user,
            entity,
            repo: parsed.repoName,
            repoName: parsed.repoName,
          });
        }
      },
      undefined,
      () => {
        eoseCount++;
        if (eoseCount >= expectedEose && !resolved) {
          resolved = true;
          setTimeout(() => {
            unsub();
            resolve(
              items
                .sort((a, b) => b.timestamp - a.timestamp)
                .slice(0, count)
            );
          }, 200);
        }
      },
      {}
    );

    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        unsub();
        resolve(
          items.sort((a, b) => b.timestamp - a.timestamp).slice(0, count)
        );
      }
    }, 7000);
  });
}
