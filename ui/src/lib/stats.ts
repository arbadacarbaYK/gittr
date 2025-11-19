/**
 * Statistics Calculation Functions
 * Calculate top repos, users, etc. from activity data
 */

import { getActivities, Activity, ActivityType } from "./activity-tracking";
import { resolveEntityToPubkey, getRepoOwnerPubkey } from "./utils/entity-resolver";

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
  
  activities.forEach(activity => {
    if (!activity.repo || !activity.entity) return;
    
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
  
  return Array.from(repoMap.values())
    .sort((a, b) => b.activityCount - a.activityCount)
    .slice(0, count);
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

