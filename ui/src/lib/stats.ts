/**
 * Statistics Calculation Functions
 * Calculate top repos, users, etc. from activity data
 * 
 * CRITICAL: New functions count from Nostr events (network source of truth)
 * Old functions use localStorage (kept for fallback)
 */

import { getActivities, Activity, ActivityType } from "./activity-tracking";
import { resolveEntityToPubkey, getRepoOwnerPubkey } from "./utils/entity-resolver";
import { KIND_REPOSITORY_NIP34, KIND_REPOSITORY_STATE, KIND_PULL_REQUEST, KIND_ISSUE, KIND_STATUS_APPLIED, KIND_STATUS_CLOSED } from "./nostr/events";

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
  const deletedRepos = JSON.parse(localStorage.getItem("gittr_deleted_repos") || "[]") as Array<{entity: string; repo: string; deletedAt: number}>;
  const repoKey = `${entity}/${repo}`.toLowerCase();
  return deletedRepos.some(d => `${d.entity}/${d.repo}`.toLowerCase() === repoKey);
}

/**
 * Helper: Check if user has access to repo (owner or write access)
 */
function userHasAccessToRepo(userPubkey: string | null | undefined, repo: any): boolean {
  if (!userPubkey || !repo) return false;
  
  const normalizedPubkey = userPubkey.toLowerCase();
  
  // Check if owner
  if (repo.ownerPubkey && repo.ownerPubkey.toLowerCase() === normalizedPubkey) {
    return true;
  }
  
  // Check contributors for write access (owner, maintainer, or contributor with weight > 0)
  if (repo.contributors && Array.isArray(repo.contributors)) {
    const contributor = repo.contributors.find((c: any) => 
      c.pubkey && c.pubkey.toLowerCase() === normalizedPubkey
    );
    if (contributor) {
      // Owner or maintainer have write access
      if (contributor.role === "owner" || contributor.role === "maintainer") return true;
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
export function getTopRepos(count: number = 10, userPubkey?: string | null): RepoStats[] {
  const activities = getActivities();
  const repos = JSON.parse(localStorage.getItem("gittr_repos") || "[]") as any[];
  const repoMap = new Map<string, RepoStats>();
  
  let skippedRepoCreated = 0;
  let processedActivities = 0;
  
  activities.forEach(activity => {
    if (!activity.repo || !activity.entity) return;
    
    // CRITICAL: Don't count repo_created or repo_imported as activity - repos are metadata, not activities
    if (activity.type === "repo_created" || activity.type === "repo_imported") {
      skippedRepoCreated++;
      return;
    }
    
    // Extract entity and repo name from activity.repo (format: "entity/repo")
    const [activityEntity, activityRepo] = activity.repo.split('/');
    if (!activityEntity || !activityRepo) return;
    
    // Skip if repo is deleted
    if (isRepoDeleted(activityEntity, activityRepo)) return;
    
    // If userPubkey provided, only include repos where user has access
    if (userPubkey) {
      const repo = repos.find((r: any) => {
        const rEntity = r.entity || "";
        const rRepo = r.repo || r.slug || "";
        return rEntity.toLowerCase() === activityEntity.toLowerCase() && 
               rRepo.toLowerCase() === activityRepo.toLowerCase();
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
    .filter(repo => repo.activityCount > 0) // Only repos with at least 1 activity (not just repo_created)
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
    const allCounts = Array.from(repoMap.values()).map(r => r.activityCount);
    const maxCount = Math.max(...allCounts, 0);
    console.warn(`⚠️ [getTopRepos] No repos with activities found. Max activity: ${maxCount}, Skipped ${skippedRepoCreated} repo_created, processed ${processedActivities} activities, ${repoMap.size} repos in map`);
  } else if (result.length > 0) {
    console.log(`✅ [getTopRepos] Found ${result.length} repos. Top activity: ${result[0]?.activityCount || 0}, Repos: ${result.map(r => `${r.repoName}(${r.activityCount})`).join(', ')}`);
  }
  
  return result;
}

/**
 * Get most active developers (by PR merges)
 */
export function getTopDevsByPRs(count: number = 10): UserStats[] {
  const activities = getActivities();
  const userMap = new Map<string, UserStats>();
  
  activities.forEach(activity => {
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
    .sort((a, b) => b.prMergedCount - a.prMergedCount)
    .slice(0, count);
}

/**
 * Get most active bounty takers
 */
export function getTopBountyTakers(count: number = 10): UserStats[] {
  const activities = getActivities();
  const userMap = new Map<string, UserStats>();
  
  activities.forEach(activity => {
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
    .sort((a, b) => b.bountyClaimedCount - a.bountyClaimedCount)
    .slice(0, count);
}

/**
 * Get most active users (overall activity)
 * @param userPubkey - Optional: only count activities on repos where this user has access
 */
export function getTopUsers(count: number = 10, userPubkey?: string | null): UserStats[] {
  const activities = getActivities();
  const userMap = new Map<string, UserStats>();
  
  // Also get repos to resolve full pubkeys from partial ones and check access
  const repos = JSON.parse(localStorage.getItem("gittr_repos") || "[]") as any[];
  
  activities.forEach(activity => {
    // If userPubkey provided, only count activities on repos where user has access
    if (userPubkey && activity.repo && activity.entity) {
      const [activityEntity, activityRepo] = activity.repo.split('/');
      if (activityEntity && activityRepo) {
        // Skip if repo is deleted
        if (isRepoDeleted(activityEntity, activityRepo)) return;
        
        // Check if user has access
        const repo = repos.find((r: any) => {
          const rEntity = r.entity || "";
          const rRepo = r.repo || r.slug || "";
          return rEntity.toLowerCase() === activityEntity.toLowerCase() && 
                 rRepo.toLowerCase() === activityRepo.toLowerCase();
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
    .sort((a, b) => b.activityCount - a.activityCount)
    .slice(0, count);
}

/**
 * Get latest bounties (open issues with highest bounties)
 * Optionally filter by owner pubkey to show only user's own bounties
 */
export function getLatestBounties(count: number = 5, ownerPubkey?: string | null): Array<{
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
    const entity = repo.entity || repo.slug?.split("/")[0] || repo.ownerPubkey?.slice(0, 8);
    const repoName = repo.repo || repo.slug?.split("/")[1] || repo.name || repo.slug;
    if (!entity || !repoName) return;

    // If filtering by owner, only include repos owned by that user
    if (ownerPubkey) {
      const repoOwnerPubkey = repo.ownerPubkey || (repo.contributors?.find((c: any) => c.weight === 100)?.pubkey);
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
export function getOpenBounties(count: number = 5): Array<{
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
    const entity = repo.entity || repo.slug?.split("/")[0] || repo.ownerPubkey?.slice(0, 8);
    const repoName = repo.repo || repo.slug?.split("/")[1] || repo.name || repo.slug;
    if (!entity || !repoName) return;

    const issueKey = `gittr_issues__${entity}__${repoName}`;
    const issues = JSON.parse(localStorage.getItem(issueKey) || "[]");

    issues.forEach((issue: any) => {
      // Only include open issues with paid bounties (available to claim)
      if (issue.status === "open" && issue.bountyAmount && issue.bountyStatus === "paid") {
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
    const repoOwnerPubkey = repo.ownerPubkey || (repo.contributors?.find((c: any) => c.weight === 100)?.pubkey);
    if (repoOwnerPubkey !== ownerPubkey) return;

    const entity = repo.entity || repo.slug?.split("/")[0] || repo.ownerPubkey?.slice(0, 8);
    const repoName = repo.repo || repo.slug?.split("/")[1] || repo.name || repo.slug;
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
export function getRecentActivity(count: number = 10, userPubkey?: string | null): Activity[] {
  const activities = getActivities();
  const repos = JSON.parse(localStorage.getItem("gittr_repos") || "[]") as any[];
  let filtered = activities;
  
  // If userPubkey provided, filter by user AND only show activities on repos where user has access
  if (userPubkey) {
    const normalized = userPubkey.toLowerCase();
    filtered = activities.filter(a => {
      if (!a.user || !a.repo || !a.entity) return false;
      
      // Match user pubkey
      const activityUser = a.user.toLowerCase();
      const userMatches = 
        activityUser === normalized ||
        (normalized.length === 8 && activityUser.startsWith(normalized)) ||
        (normalized.length === 8 && activityUser.length === 64 && activityUser.startsWith(normalized));
      
      if (!userMatches) return false;
      
      // Extract entity and repo from activity.repo
      const [activityEntity, activityRepo] = a.repo.split('/');
      if (!activityEntity || !activityRepo) return false;
      
      // Skip if repo is deleted
      if (isRepoDeleted(activityEntity, activityRepo)) return false;
      
      // Check if user has access to this repo
      const repo = repos.find((r: any) => {
        const rEntity = r.entity || "";
        const rRepo = r.repo || r.slug || "";
        return rEntity.toLowerCase() === activityEntity.toLowerCase() && 
               rRepo.toLowerCase() === activityRepo.toLowerCase();
      });
      
      // Only include if user has access to the repo
      return repo && userHasAccessToRepo(userPubkey, repo);
    });
  } else {
    // Even without userPubkey, filter out deleted repos
    filtered = activities.filter(a => {
      if (!a.repo || !a.entity) return false;
      const [activityEntity, activityRepo] = a.repo.split('/');
      if (!activityEntity || !activityRepo) return false;
      return !isRepoDeleted(activityEntity, activityRepo);
    });
  }
  
  return filtered
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, count);
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
    const entity = repo.entity || repo.slug?.split("/")[0] || repo.ownerPubkey?.slice(0, 8);
    const repoName = repo.repo || repo.slug?.split("/")[1] || repo.name || repo.slug;
    if (!entity || !repoName) return;
    
    // Skip if repo is deleted
    if (isRepoDeleted(entity, repoName)) return;
    
    // If userPubkey provided, only include repos where user has WRITE access (owner or maintainer)
    // This ensures users only see PRs/Issues from repos they can actually manage
    if (userPubkey) {
      const normalizedPubkey = userPubkey.toLowerCase();
      
      // Check if owner
      const isOwner = repo.ownerPubkey && repo.ownerPubkey.toLowerCase() === normalizedPubkey;
      if (isOwner) {
        // Owner has write access, continue
      } else {
        // Check if maintainer (has write access but not owner)
        const contributor = repo.contributors?.find((c: any) => 
          c.pubkey && c.pubkey.toLowerCase() === normalizedPubkey
        );
        const isMaintainer = contributor && (
          contributor.role === "maintainer" || 
          (contributor.weight && contributor.weight >= 50 && contributor.weight < 100)
        );
        if (!isMaintainer) {
          // User doesn't have write access, skip this repo
          return;
        }
      }
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
    recentIssues: allIssues.sort((a, b) => b.createdAt - a.createdAt).slice(0, 5),
  };
}

/**
 * Get recent bounty activities for a user
 * @param userPubkey - User's pubkey to filter activities
 * @param count - Number of activities to return
 */
export function getRecentBountyActivities(userPubkey: string | null, count: number = 5): Activity[] {
  if (!userPubkey) return [];
  
  const activities = getActivities();
  const repos = JSON.parse(localStorage.getItem("gittr_repos") || "[]") as any[];
  const normalized = userPubkey.toLowerCase();
  
  // Filter for bounty-related activities by this user
  const bountyActivities = activities.filter(a => {
    if (!a.user || !a.repo || !a.entity) return false;
    
    // Only bounty_created and bounty_claimed activities
    if (a.type !== "bounty_created" && a.type !== "bounty_claimed") return false;
    
    // Match user pubkey
    const activityUser = a.user.toLowerCase();
    const userMatches = 
      activityUser === normalized ||
      (normalized.length === 8 && activityUser.startsWith(normalized)) ||
      (normalized.length === 8 && activityUser.length === 64 && activityUser.startsWith(normalized));
    
    if (!userMatches) return false;
    
    // Extract entity and repo from activity.repo
    const [activityEntity, activityRepo] = a.repo.split('/');
    if (!activityEntity || !activityRepo) return false;
    
    // Skip if repo is deleted
    if (isRepoDeleted(activityEntity, activityRepo)) return false;
    
    // Check if user has access to this repo (for bounty_created, user should be owner)
    const repo = repos.find((r: any) => {
      const rEntity = r.entity || "";
      const rRepo = r.repo || r.slug || "";
      return rEntity.toLowerCase() === activityEntity.toLowerCase() && 
             rRepo.toLowerCase() === activityRepo.toLowerCase();
    });
    
    // For bounty_created, user should have access (they created it)
    // For bounty_claimed, user is the claimer, so always include
    if (a.type === "bounty_created" && repo && !userHasAccessToRepo(userPubkey, repo)) return false;
    
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
    return { bountiesSetOut: 0, bountiesClaimed: 0, totalSetOutAmount: 0, totalClaimedAmount: 0 };
  }
  
  const activities = getActivities();
  const normalized = userPubkey.toLowerCase();
  
  let bountiesSetOut = 0;
  let bountiesClaimed = 0;
  let totalSetOutAmount = 0;
  let totalClaimedAmount = 0;
  
  activities.forEach(a => {
    if (!a.user) return;
    
    const activityUser = a.user.toLowerCase();
    const userMatches = 
      activityUser === normalized ||
      (normalized.length === 8 && activityUser.startsWith(normalized)) ||
      (normalized.length === 8 && activityUser.length === 64 && activityUser.startsWith(normalized));
    
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
    const entity = repo.entity || repo.slug?.split("/")[0] || repo.ownerPubkey?.slice(0, 8);
    const repoName = repo.repo || repo.slug?.split("/")[1] || repo.name || repo.slug;
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
  sinceDays: number = 90 // Count activity from last 90 days (increased from 30 for better coverage)
): Promise<Map<string, RepoStats>> {
  // CRITICAL: Only use GRASP/git relays - regular relays don't have git events!
  const { getGraspServers } = require("@/lib/utils/grasp-servers");
  const graspRelays = getGraspServers(relays);
  const activeRelays = graspRelays.length > 0 ? graspRelays : relays; // Fallback if no GRASP relays
  
  console.log(`🔍 [Nostr Repo Stats] Starting query for all repos using ${activeRelays.length} GRASP/git relays (filtered from ${relays.length} total):`, activeRelays);
  
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
          const dTag = event.tags?.find((t: any) => Array.isArray(t) && t[0] === "d");
          const repoName = dTag?.[1];
          if (repoName && event.pubkey && typeof repoName === "string") {
            const repoId = `${event.pubkey}/${repoName}`;
            // Only create repo entry if it doesn't exist, don't count announcement as activity
            if (!repoMap.has(repoId)) {
              repoMap.set(repoId, {
                repoId,
                repoName: repoName as string,
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
          const dTag = event.tags?.find((t: any) => Array.isArray(t) && t[0] === "d");
          const repoName = dTag?.[1];
          if (repoName && event.pubkey && typeof repoName === "string") {
            const repoId = `${event.pubkey}/${repoName}`;
            const existing = repoMap.get(repoId) || {
              repoId,
              repoName: repoName as string,
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
            existing.lastActivity = Math.max(existing.lastActivity, event.created_at * 1000);
            repoMap.set(repoId, existing);
          }
        }
        // Count PR events (kind 1618)
        else if (event.kind === KIND_PULL_REQUEST) {
          const aTag = event.tags?.find((t: any) => Array.isArray(t) && t[0] === "a");
          if (aTag && aTag[1]) {
            // Extract repo from "a" tag: "30617:<owner-pubkey>:<repo-name>"
            const aValue = aTag[1] as string;
            const match = aValue.match(/^30617:([0-9a-f]{64}):(.+)$/i);
            if (match && match[1] && match[2]) {
              const [, ownerPubkey, repoName] = match;
              const repoId = `${ownerPubkey}/${repoName}`;
              const existing = repoMap.get(repoId) || {
                repoId,
                repoName: repoName as string,
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
              existing.lastActivity = Math.max(existing.lastActivity, event.created_at * 1000);
              repoMap.set(repoId, existing);
            }
          }
        }
        // Count PR merged status (kind 1631)
        else if (event.kind === KIND_STATUS_APPLIED) {
          const kTag = event.tags?.find((t: any) => Array.isArray(t) && t[0] === "k");
          if (kTag && kTag[1] === "1618") {
            const aTag = event.tags?.find((t: any) => Array.isArray(t) && t[0] === "a");
            if (aTag && aTag[1]) {
              const aValue = aTag[1] as string;
              const match = aValue.match(/^30617:([0-9a-f]{64}):(.+)$/i);
              if (match && match[1] && match[2]) {
                const [, ownerPubkey, repoName] = match;
                const repoId = `${ownerPubkey}/${repoName}`;
                const existing = repoMap.get(repoId) || {
                  repoId,
                  repoName: repoName as string,
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
                existing.lastActivity = Math.max(existing.lastActivity, event.created_at * 1000);
                repoMap.set(repoId, existing);
              }
            }
          }
        }
        // Count issue events (kind 1621)
        else if (event.kind === KIND_ISSUE) {
          const aTag = event.tags?.find((t: any) => Array.isArray(t) && t[0] === "a");
          if (aTag && aTag[1]) {
            const aValue = aTag[1] as string;
            const match = aValue.match(/^30617:([0-9a-f]{64}):(.+)$/i);
            if (match && match[1] && match[2]) {
              const [, ownerPubkey, repoName] = match;
              const repoId = `${ownerPubkey}/${repoName}`;
              const existing = repoMap.get(repoId) || {
                repoId,
                repoName: repoName as string,
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
              existing.lastActivity = Math.max(existing.lastActivity, event.created_at * 1000);
              repoMap.set(repoId, existing);
            }
          }
        }
        // Count issue closed status (kind 1632)
        else if (event.kind === KIND_STATUS_CLOSED) {
          const kTag = event.tags?.find((t: any) => Array.isArray(t) && t[0] === "k");
          if (kTag && kTag[1] === "1621") {
            const aTag = event.tags?.find((t: any) => Array.isArray(t) && t[0] === "a");
            if (aTag && aTag[1]) {
              const aValue = aTag[1] as string;
              const match = aValue.match(/^30617:([0-9a-f]{64}):(.+)$/i);
              if (match && match[1] && match[2]) {
                const [, ownerPubkey, repoName] = match;
                const repoId = `${ownerPubkey}/${repoName}`;
                const existing = repoMap.get(repoId) || {
                  repoId,
                  repoName: repoName as string,
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
                existing.lastActivity = Math.max(existing.lastActivity, event.created_at * 1000);
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
            console.log(`✅ [Nostr Repo Stats] Counted activities for ${repoMap.size} repos from Nostr`);
            resolve(repoMap);
          }, 1000);
        }
      },
      {} // options parameter
    );

    // Timeout after 12 seconds - balance between speed and getting enough data
    // Increased from 8s to 12s to ensure we get enough repos before timing out
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        unsub();
        const totalActivities = Array.from(repoMap.values()).reduce((sum, r) => sum + r.activityCount, 0);
        const reposWithActivity = Array.from(repoMap.values()).filter(r => r.activityCount > 0).length;
        console.log(`⏱️ [Nostr Repo Stats] Timeout after 12s (EOSE: ${eoseCount}/${expectedEose}), returning counts:`, repoMap.size, 'repos,', reposWithActivity, 'with activity,', totalActivities, 'total activities');
        resolve(repoMap);
      }
    }, 12000);
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
  sinceDays: number = 90 // Count activity from last 90 days (increased from 30 for better coverage)
): Promise<Map<string, UserStats>> {
  // CRITICAL: Only use GRASP/git relays - regular relays don't have git events!
  const { getGraspServers } = require("@/lib/utils/grasp-servers");
  const graspRelays = getGraspServers(relays);
  const activeRelays = graspRelays.length > 0 ? graspRelays : relays; // Fallback if no GRASP relays
  
  console.log(`🔍 [Nostr User Stats] Starting query for all users using ${activeRelays.length} GRASP/git relays (filtered from ${relays.length} total):`, activeRelays);
  
  return new Promise((resolve) => {
    const userMap = new Map<string, UserStats>();
    const seenRepos = new Map<string, Set<string>>(); // Track unique repos per user (pubkey -> Set<repoId>)
    const since = Math.floor((Date.now() - sinceDays * 24 * 60 * 60 * 1000) / 1000);
    
    let eoseCount = 0;
    const expectedEose = activeRelays.length;
    let resolved = false;

    const filters = [
      // Repo announcements (kind 30617) - count unique repos per user
      {
        kinds: [KIND_REPOSITORY_NIP34],
        since,
        limit: 1000,
      },
      // Repo state events (kind 30618) - indicate pushes
      {
        kinds: [KIND_REPOSITORY_STATE],
        since,
        limit: 2000,
      },
      // PR events (kind 1618)
      {
        kinds: [KIND_PULL_REQUEST],
        since,
        limit: 1000,
      },
      // PR merged status (kind 1631)
      {
        kinds: [KIND_STATUS_APPLIED],
        "#k": ["1618"],
        since,
        limit: 500,
      },
      // Issue events (kind 1621)
      {
        kinds: [KIND_ISSUE],
        since,
        limit: 1000,
      },
      // Issue closed status (kind 1632)
      {
        kinds: [KIND_STATUS_CLOSED],
        "#k": ["1621"],
        since,
        limit: 500,
      },
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
          const dTag = event.tags?.find((t: any) => Array.isArray(t) && t[0] === "d");
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
            existing.lastActivity = Math.max(existing.lastActivity, event.created_at * 1000);
          }
        }
        // Count repo state events (kind 30618) - indicate pushes
        else if (event.kind === KIND_REPOSITORY_STATE) {
          existing.commitCount++;
          existing.activityCount++;
          existing.lastActivity = Math.max(existing.lastActivity, event.created_at * 1000);
        }
        // Count PR events (kind 1618)
        else if (event.kind === KIND_PULL_REQUEST) {
          existing.activityCount++;
          existing.lastActivity = Math.max(existing.lastActivity, event.created_at * 1000);
        }
        // Count PR merged status (kind 1631)
        else if (event.kind === KIND_STATUS_APPLIED) {
          const kTag = event.tags?.find((t: any) => Array.isArray(t) && t[0] === "k");
          if (kTag && kTag[1] === "1618") {
            existing.prMergedCount++;
            existing.activityCount++;
            existing.lastActivity = Math.max(existing.lastActivity, event.created_at * 1000);
          }
        }
        // Count issue events (kind 1621)
        else if (event.kind === KIND_ISSUE) {
          existing.activityCount++;
          existing.lastActivity = Math.max(existing.lastActivity, event.created_at * 1000);
        }
        // Count issue closed status (kind 1632)
        else if (event.kind === KIND_STATUS_CLOSED) {
          const kTag = event.tags?.find((t: any) => Array.isArray(t) && t[0] === "k");
          if (kTag && kTag[1] === "1621") {
            existing.activityCount++;
            existing.lastActivity = Math.max(existing.lastActivity, event.created_at * 1000);
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
            console.log(`✅ [Nostr User Stats] Counted activities for ${userMap.size} users from Nostr`);
            resolve(userMap);
          }, 1000);
        }
      },
      {} // options parameter
    );

    // Timeout after 5 seconds (balance between speed and getting data)
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        unsub();
        console.log(`⏱️ [Nostr User Stats] Timeout after 5s (EOSE: ${eoseCount}/${expectedEose}), returning counts:`, userMap.size, 'users');
        resolve(userMap);
      }
    }, 5000);
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
  count: number = 10
): Promise<RepoStats[]> {
  try {
    if (!subscribe || typeof subscribe !== 'function') {
      console.error(`❌ [getTopReposFromNostr] subscribe is not a function:`, typeof subscribe);
      return [];
    }
    
    // CRITICAL: countRepoActivitiesFromNostr already filters to GRASP servers internally
    // Don't filter here again - pass all relays and let countRepoActivitiesFromNostr handle filtering
    // This ensures we don't accidentally filter out relays that might be needed
    console.log(`🔍 [getTopReposFromNostr] Starting query with ${relays.length} relays (will be filtered to GRASP servers internally)`);
    const repoMap = await countRepoActivitiesFromNostr(subscribe, relays, 999999); // All time (sinceDays param ignored now, but kept for API compatibility)
    
    // Debug: Log all repos with activity
    const allReposWithActivity = Array.from(repoMap.values()).filter(repo => repo.activityCount > 0);
    console.log(`📊 [getTopReposFromNostr] Total repos in map: ${repoMap.size}, repos with activity: ${allReposWithActivity.length}`);
    if (allReposWithActivity.length > 0) {
      console.log(`📋 [getTopReposFromNostr] All repos with activity:`, allReposWithActivity.slice(0, 20).map(r => `${r.repoName}(${r.activityCount})`).join(', '));
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
    
    console.log(`✅ [getTopReposFromNostr] Found ${repos.length} repos from Nostr (${repoMap.size} total in map), top activity: ${repos[0]?.activityCount || 0}`);
    if (repos.length > 0) {
      console.log(`📋 [getTopReposFromNostr] Top repos:`, repos.map(r => `${r.repoName}(${r.activityCount})`).join(', '));
    } else if (allReposWithActivity.length > 0) {
      console.warn(`⚠️ [getTopReposFromNostr] No repos returned after sorting/slicing, but ${allReposWithActivity.length} repos have activity!`);
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
  count: number = 10
): Promise<UserStats[]> {
  // CRITICAL: countUserActivitiesFromNostr doesn't filter to GRASP servers (users can be on any relay)
  // But for consistency and performance, filter to GRASP servers here
  const { getGraspServers } = require("@/lib/utils/grasp-servers");
  const graspRelays = getGraspServers(relays);
  const activeRelays = graspRelays.length > 0 ? graspRelays : relays; // Fallback if no GRASP relays
  
  console.log(`🔍 [getTopUsersFromNostr] Starting query with ${activeRelays.length} GRASP/git relays (filtered from ${relays.length} total):`, activeRelays);
  const userMap = await countUserActivitiesFromNostr(subscribe, activeRelays, 90); // Last 90 days
  return Array.from(userMap.values())
    .sort((a, b) => b.activityCount - a.activityCount)
    .slice(0, count);
}

