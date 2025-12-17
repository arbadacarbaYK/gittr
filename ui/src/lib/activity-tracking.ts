/**
 * Activity Tracking System
 * Tracks all user activities for stats and timeline display
 * 
 * CRITICAL: Activity counts should come from Nostr events (network), not localStorage
 * People use multiple clients, so we need to count what's actually on Nostr
 */

import { getRepoOwnerPubkey } from "./utils/entity-resolver";
import { KIND_REPOSITORY_NIP34, KIND_REPOSITORY_STATE, KIND_PULL_REQUEST, KIND_ISSUE, KIND_STATUS_APPLIED, KIND_STATUS_CLOSED } from "./nostr/events";

export type ActivityType = 
  | "repo_created"
  | "repo_imported"
  | "pr_created"
  | "pr_merged"
  | "commit_created"
  | "issue_created"
  | "issue_closed"
  | "bounty_created"
  | "bounty_claimed"
  | "repo_zapped"
  | "file_edited"
  | "release_created";

export interface Activity {
  id: string;
  type: ActivityType;
  timestamp: number;
  user: string; // pubkey
  repo?: string; // entity/repo format
  entity?: string; // entity/pubkey
  repoName?: string; // display name
  metadata?: {
    prId?: string;
    issueId?: string;
    commitId?: string;
    bountyAmount?: number;
    zapAmount?: number;
    filePath?: string;
    releaseTag?: string;
    [key: string]: any;
  };
}

const ACTIVITY_STORAGE_KEY = "gittr_activities";
const ACTIVITY_MAX_AGE = 365 * 24 * 60 * 60 * 1000; // 1 year

/**
 * Record an activity
 */
export function recordActivity(activity: Omit<Activity, "id" | "timestamp">): void {
  try {
    const activities = getActivities();
    const newActivity: Activity = {
      ...activity,
      id: `activity-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
    };
    
    activities.push(newActivity);
    
    // Clean up old activities (older than 1 year)
    const cutoff = Date.now() - ACTIVITY_MAX_AGE;
    const filtered = activities.filter(a => a.timestamp >= cutoff);
    
    // Keep last 10000 activities
    const recent = filtered.slice(-10000);
    
    localStorage.setItem(ACTIVITY_STORAGE_KEY, JSON.stringify(recent));
    
    // Dispatch event for real-time updates
    window.dispatchEvent(new CustomEvent("gittr:activity-recorded", { detail: newActivity }));
  } catch (error) {
    console.error("Failed to record activity:", error);
  }
}

/**
 * Get all activities
 */
export function getActivities(): Activity[] {
  try {
    const stored = localStorage.getItem(ACTIVITY_STORAGE_KEY);
    if (!stored) return [];
    return JSON.parse(stored) as Activity[];
  } catch {
    return [];
  }
}

/**
 * Helper: Check if repo is deleted
 */
function isRepoDeleted(entity: string, repo: string): boolean {
  try {
    const deletedRepos = JSON.parse(localStorage.getItem("gittr_deleted_repos") || "[]") as Array<{entity: string; repo: string; deletedAt: number}>;
    const repoKey = `${entity}/${repo}`.toLowerCase();
    return deletedRepos.some(d => `${d.entity}/${d.repo}`.toLowerCase() === repoKey);
  } catch {
    return false;
  }
}

/**
 * Get activities for a specific user
 * Matches by full pubkey, 8-char prefix, or npub format
 * CRITICAL: Filters out activities from deleted repos
 */
export function getUserActivities(userPubkey: string): Activity[] {
  const allActivities = getActivities();
  
  // Normalize the userPubkey - if it's npub, decode it
  let normalizedPubkey = userPubkey;
  if (userPubkey.startsWith("npub")) {
    try {
      const { nip19 } = require("nostr-tools");
      const decoded = nip19.decode(userPubkey);
      if (decoded.type === "npub") {
        normalizedPubkey = decoded.data as string;
      }
    } catch {
      // Invalid npub, use as-is
    }
  }
  
  // Get 8-char prefix for matching
  const prefix = normalizedPubkey.length >= 8 ? normalizedPubkey.slice(0, 8).toLowerCase() : null;
  
  return allActivities.filter(a => {
    const activityUser = a.user?.toLowerCase() || "";
    const normalizedPubkeyLower = normalizedPubkey.toLowerCase();
    
    // Match user pubkey
    let userMatches = false;
    // Exact match (full pubkey)
    if (activityUser === normalizedPubkeyLower) userMatches = true;
    // Match by 8-char prefix
    else if (prefix && activityUser.startsWith(prefix)) userMatches = true;
    else if (prefix && normalizedPubkeyLower.startsWith(activityUser.slice(0, 8))) userMatches = true;
    // Match if activity user is prefix of search pubkey
    else if (activityUser.length === 8 && normalizedPubkeyLower.startsWith(activityUser)) userMatches = true;
    
    if (!userMatches) return false;
    
    // Filter out activities from deleted repos
    if (a.repo && a.entity) {
      const [activityEntity, activityRepo] = a.repo.split('/');
      if (activityEntity && activityRepo && isRepoDeleted(activityEntity, activityRepo)) {
        return false;
      }
    }
    
    return true;
  });
}

/**
 * Get activities for a specific repo
 */
export function getRepoActivities(repoId: string): Activity[] {
  return getActivities().filter(a => a.repo === repoId);
}

/**
 * Get activities in a date range
 */
export function getActivitiesInRange(startDate: number, endDate: number): Activity[] {
  return getActivities().filter(
    a => a.timestamp >= startDate && a.timestamp <= endDate
  );
}

/**
 * Get activity count by type for a user
 */
export function getUserActivityCounts(userPubkey: string): Record<ActivityType, number> {
  const activities = getUserActivities(userPubkey);
  const counts: Record<string, number> = {};
  
  Object.values([
    "repo_created",
    "repo_imported",
    "pr_created",
    "pr_merged",
    "commit_created",
    "issue_created",
    "issue_closed",
    "bounty_created",
    "bounty_claimed",
    "repo_zapped",
    "file_edited",
    "release_created",
  ] as ActivityType[]).forEach(type => {
    counts[type] = activities.filter(a => a.type === type).length;
  });
  
  return counts as Record<ActivityType, number>;
}

/**
 * Get contribution graph data (like GitHub's activity graph)
 * Returns array of {date: string, count: number} for last 52 weeks
 */
export function getContributionGraph(userPubkey: string): Array<{date: string; count: number}> {
  const activities = getUserActivities(userPubkey);
  const weeks: Record<string, number> = {};
  
  // Initialize last 52 weeks
  const now = Date.now();
  for (let i = 0; i < 365; i++) {
    const date = new Date(now - i * 24 * 60 * 60 * 1000);
    const dateStr = date.toISOString().split("T")[0];
    if (dateStr) {
    weeks[dateStr] = 0;
    }
  }
  
  // Count activities per day
  activities.forEach(activity => {
    const date = new Date(activity.timestamp);
    const dateStr = date.toISOString().split("T")[0];
    if (dateStr && dateStr in weeks && weeks[dateStr] !== undefined) {
      weeks[dateStr] = (weeks[dateStr] || 0) + 1;
    }
  });
  
  // Convert to array sorted by date
  return Object.entries(weeks)
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Backfill activities from existing data
 * Call this once to populate activity history from existing commits, PRs, issues, etc.
 */
export function backfillActivities(): void {
  const activities: Omit<Activity, "id" | "timestamp">[] = [];
  
  try {
    // 1. Get all repos
    const repos = JSON.parse(localStorage.getItem("gittr_repos") || "[]") as any[];
    
    repos.forEach((repo: any) => {
      if (!repo.entity || repo.entity === "user") return;
      const repoId = `${repo.entity}/${repo.repo || repo.slug}`;
      
      // Get full owner pubkey from repo (repos always have full pubkey in ownerPubkey)
      const ownerPubkey = getRepoOwnerPubkey(repo, repo.entity);
      if (!ownerPubkey) {
        // Skip repos without valid owner pubkey
        return;
      }
      
      // Repo creation/import
      // CRITICAL: Always create activity for repos, even if createdAt is missing
      // Use createdAt if available, otherwise use current time (for existing repos)
      const repoCreatedAt = repo.createdAt || repo.updatedAt || Date.now();
        activities.push({
          type: repo.sourceUrl ? "repo_imported" : "repo_created",
          user: ownerPubkey, // Use full pubkey, not entity
          repo: repoId,
          entity: repo.entity,
          repoName: repo.name || repo.repo || repo.slug,
        timestamp: repoCreatedAt, // Use actual timestamp if available
      } as any);
      
      // Commits
      const commitsKey = `gittr_commits__${repo.entity}__${repo.repo || repo.slug}`;
      const commits = JSON.parse(localStorage.getItem(commitsKey) || "[]") as any[];
      commits.forEach((commit: any) => {
        if (commit.timestamp || commit.createdAt) {
          // Use commit.author if it's a full pubkey, otherwise use ownerPubkey
          const commitUser = (commit.author && /^[0-9a-f]{64}$/i.test(commit.author)) 
            ? commit.author 
            : ownerPubkey;
          activities.push({
            type: "commit_created",
            user: commitUser,
            repo: repoId,
            entity: repo.entity,
            repoName: repo.name || repo.repo || repo.slug,
            metadata: {
              commitId: commit.id,
              fileCount: commit.filesChanged || 0,
            },
          });
        }
      });
      
      // PRs
      const prsKey = `gittr_prs__${repo.entity}__${repo.repo || repo.slug}`;
      const prs = JSON.parse(localStorage.getItem(prsKey) || "[]") as any[];
      prs.forEach((pr: any) => {
        if (pr.createdAt) {
          // Use pr.author if it's a full pubkey, otherwise use ownerPubkey
          const prUser = (pr.author && /^[0-9a-f]{64}$/i.test(pr.author)) 
            ? pr.author 
            : ownerPubkey;
          activities.push({
            type: "pr_created",
            user: prUser,
            repo: repoId,
            entity: repo.entity,
            repoName: repo.name || repo.repo || repo.slug,
            metadata: {
              prId: pr.id,
            },
          });
        }
        if (pr.mergedAt && pr.status === "merged") {
          // Use pr.mergedBy or pr.author if full pubkey, otherwise use ownerPubkey
          const mergedBy = (pr.mergedBy && /^[0-9a-f]{64}$/i.test(pr.mergedBy))
            ? pr.mergedBy
            : ((pr.author && /^[0-9a-f]{64}$/i.test(pr.author)) ? pr.author : ownerPubkey);
          activities.push({
            type: "pr_merged",
            user: mergedBy,
            repo: repoId,
            entity: repo.entity,
            repoName: repo.name || repo.repo || repo.slug,
            metadata: {
              prId: pr.id,
              commitId: pr.mergeCommit,
            },
          });
        }
      });
      
      // Issues
      const issuesKey = `gittr_issues__${repo.entity}__${repo.repo || repo.slug}`;
      const issues = JSON.parse(localStorage.getItem(issuesKey) || "[]") as any[];
      issues.forEach((issue: any) => {
        if (issue.createdAt) {
          // Use issue.author if it's a full pubkey, otherwise use ownerPubkey
          const issueUser = (issue.author && /^[0-9a-f]{64}$/i.test(issue.author))
            ? issue.author
            : ownerPubkey;
          activities.push({
            type: "issue_created",
            user: issueUser,
            repo: repoId,
            entity: repo.entity,
            repoName: repo.name || repo.repo || repo.slug,
            metadata: {
              issueId: issue.id,
            },
          });
        }
        if (issue.bountyAmount && issue.bountyStatus === "paid") {
          const bountyUser = (issue.author && /^[0-9a-f]{64}$/i.test(issue.author))
            ? issue.author
            : ownerPubkey;
          activities.push({
            type: "bounty_created",
            user: bountyUser, // Bounty creator
            repo: repoId,
            entity: repo.entity,
            repoName: repo.name || repo.repo || repo.slug,
            metadata: {
              issueId: issue.id,
              bountyAmount: issue.bountyAmount,
            },
          });
        }
        if (issue.bountyStatus === "released" && issue.bountyClaimedBy) {
          // Use issue.bountyClaimedBy if it's a full pubkey, otherwise skip
          if (/^[0-9a-f]{64}$/i.test(issue.bountyClaimedBy)) {
            activities.push({
              type: "bounty_claimed",
              user: issue.bountyClaimedBy,
              repo: repoId,
              entity: repo.entity,
              repoName: repo.name || repo.repo || repo.slug,
              metadata: {
                issueId: issue.id,
                bountyAmount: issue.bountyAmount,
              },
            });
          }
        }
      });
    });
    
    // Record all backfilled activities
    // CRITICAL: Use original timestamp from activity if available, otherwise use current time
    // CRITICAL: Check for duplicates before recording to prevent counting same activity multiple times
    const existingActivities = getActivities();
    const existingActivityIds = new Set(
      existingActivities.map(a => {
        // Create unique ID from activity type, repo, user, and timestamp (rounded to nearest second to handle minor differences)
        const ts = Math.floor(a.timestamp / 1000) * 1000;
        return `${a.type}:${a.repo}:${a.user}:${ts}`;
      })
    );
    
    let newCount = 0;
    activities.forEach(activity => {
      const timestamp = (activity as any).timestamp || Date.now();
      const roundedTs = Math.floor(timestamp / 1000) * 1000;
      const activityId = `${activity.type}:${activity.repo}:${activity.user}:${roundedTs}`;
      
      // Skip if this activity already exists
      if (existingActivityIds.has(activityId)) {
        return;
      }
      
      recordActivity({
        ...activity,
        timestamp: timestamp,
      } as any);
      newCount++;
    });
    
    if (newCount > 0) {
      console.log(`✅ [Backfill] Recorded ${newCount} new activities (skipped ${activities.length - newCount} duplicates)`);
    }
    
    // Mark as backfilled to prevent duplicate runs
    localStorage.setItem("gittr_activities_backfilled", Date.now().toString());
    
  } catch (error) {
    console.error("Failed to backfill activities:", error);
  }
}

/**
 * Sync commits from bridge API to activities
 * Fetches real git commits from the bridge and converts them to activities
 * This ensures activity bar shows commits made via `git push`, not just UI actions
 */
export async function syncCommitsFromBridge(
  ownerPubkey: string,
  repoEntity: string,
  repoName: string,
  branch: string = "main"
): Promise<number> {
  try {
    // Fetch commits from bridge API
    const response = await fetch(
      `/api/nostr/repo/commits?ownerPubkey=${encodeURIComponent(ownerPubkey)}&repo=${encodeURIComponent(repoName)}&branch=${encodeURIComponent(branch)}&limit=100`
    );

    if (!response.ok) {
      if (response.status === 404) {
        // Repo not cloned yet - this is normal, not an error
        return 0;
      }
      console.warn(`⚠️ [Activity Sync] Failed to fetch commits: ${response.status} ${response.statusText}`);
      return 0;
    }

    const data = await response.json();
    if (!data.commits || !Array.isArray(data.commits)) {
      return 0;
    }

    const commits = data.commits;
    const existingActivities = getActivities();
    const repoId = `${repoEntity}/${repoName}`;
    let syncedCount = 0;

    // Get existing commit IDs to avoid duplicates
    const existingCommitIds = new Set(
      existingActivities
        .filter(a => a.repo === repoId && a.type === "commit_created")
        .map(a => a.metadata?.commitId)
        .filter((id): id is string => !!id)
    );

    for (const commit of commits) {
      // Skip if we already have this commit
      if (existingCommitIds.has(commit.id)) {
        continue;
      }

      // Try to extract pubkey from author email or name
      // Git commits might have email like "user@example.com" or "npub1xxx@example.com"
      // Or author name might be a pubkey
      let commitUser = ownerPubkey; // Default to repo owner
      
      if (commit.authorEmail) {
        // Check if email contains npub
        const npubMatch = commit.authorEmail.match(/npub1[a-z0-9]{58}/i);
        if (npubMatch) {
          try {
            const { nip19 } = require("nostr-tools");
            const decoded = nip19.decode(npubMatch[0]);
            if (decoded.type === "npub" && /^[0-9a-f]{64}$/i.test(decoded.data as string)) {
              commitUser = decoded.data as string;
            }
          } catch {
            // Invalid npub, use owner
          }
        }
        // Check if email is a pubkey (64-char hex)
        else if (/^[0-9a-f]{64}@/i.test(commit.authorEmail)) {
          const pubkeyMatch = commit.authorEmail.match(/^([0-9a-f]{64})@/i);
          if (pubkeyMatch && pubkeyMatch[1]) {
            commitUser = pubkeyMatch[1];
          }
        }
      }

      // Check if author name is a pubkey
      if (commit.author && /^[0-9a-f]{64}$/i.test(commit.author)) {
        commitUser = commit.author;
      }

      // Record commit as activity
      recordActivity({
        type: "commit_created",
        user: commitUser,
        repo: repoId,
        entity: repoEntity,
        repoName: repoName,
        metadata: {
          commitId: commit.id,
          // Use timestamp from git commit (already in milliseconds)
          timestamp: commit.timestamp,
        },
      });

      syncedCount++;
    }

    if (syncedCount > 0) {
      console.log(`✅ [Activity Sync] Synced ${syncedCount} commits from bridge for ${repoId}`);
    }

    return syncedCount;
  } catch (error) {
    console.error("❌ [Activity Sync] Failed to sync commits from bridge:", error);
    return 0;
  }
}

/**
 * Sync issues and PRs from Nostr into activities
 * Fetches issues (kind 1621) and PRs (kind 1618) from localStorage and converts them to activities
 * This ensures activity bar shows issues/PRs created via Nostr, not just UI actions
 */
export function syncIssuesAndPRsFromNostr(userPubkey: string): number {
  try {
    const repos = JSON.parse(localStorage.getItem("gittr_repos") || "[]") as any[];
    const userRepos = repos.filter((repo: any) => {
      if (!repo.entity || repo.entity === "user") return false;
      const ownerPubkey = getRepoOwnerPubkey(repo, repo.entity);
      return ownerPubkey && ownerPubkey.toLowerCase() === userPubkey.toLowerCase();
    });

    let syncedCount = 0;
    const existingActivities = getActivities();

    for (const repo of userRepos) {
      const ownerPubkey = getRepoOwnerPubkey(repo, repo.entity);
      if (!ownerPubkey) continue;

      const repoId = `${repo.entity}/${repo.repo || repo.slug}`;
      const repoName = repo.repo || repo.slug;

      // Get existing issue/PR IDs to avoid duplicates
      const existingIssueIds = new Set(
        existingActivities
          .filter(a => a.repo === repoId && (a.type === "issue_created" || a.type === "issue_closed"))
          .map(a => a.metadata?.issueId)
          .filter((id): id is string => !!id)
      );
      
      const existingPRIds = new Set(
        existingActivities
          .filter(a => a.repo === repoId && (a.type === "pr_created" || a.type === "pr_merged"))
          .map(a => a.metadata?.prId)
          .filter((id): id is string => !!id)
      );

      // Sync issues from localStorage
      const issuesKey = `gittr_issues__${repo.entity}__${repoName}`;
      const issues = JSON.parse(localStorage.getItem(issuesKey) || "[]") as any[];
      
      for (const issue of issues) {
        if (existingIssueIds.has(issue.id)) continue;
        
        if (issue.createdAt) {
          const issueUser = (issue.author && /^[0-9a-f]{64}$/i.test(issue.author))
            ? issue.author
            : ownerPubkey;
          
          recordActivity({
            type: "issue_created",
            user: issueUser,
            repo: repoId,
            entity: repo.entity,
            repoName: repoName,
            metadata: {
              issueId: issue.id,
            },
            timestamp: issue.createdAt,
          } as any);
          syncedCount++;
        }
        
        if (issue.status === "closed" && issue.closedAt) {
          const closedBy = (issue.closedBy && /^[0-9a-f]{64}$/i.test(issue.closedBy))
            ? issue.closedBy
            : ownerPubkey;
          
          recordActivity({
            type: "issue_closed",
            user: closedBy,
            repo: repoId,
            entity: repo.entity,
            repoName: repoName,
            metadata: {
              issueId: issue.id,
            },
            timestamp: issue.closedAt,
          } as any);
          syncedCount++;
        }
      }

      // Sync PRs from localStorage
      const prsKey = `gittr_prs__${repo.entity}__${repoName}`;
      const prs = JSON.parse(localStorage.getItem(prsKey) || "[]") as any[];
      
      for (const pr of prs) {
        if (existingPRIds.has(pr.id)) continue;
        
        if (pr.createdAt) {
          const prUser = (pr.author && /^[0-9a-f]{64}$/i.test(pr.author))
            ? pr.author
            : ownerPubkey;
          
          recordActivity({
            type: "pr_created",
            user: prUser,
            repo: repoId,
            entity: repo.entity,
            repoName: repoName,
            metadata: {
              prId: pr.id,
            },
            timestamp: pr.createdAt,
          } as any);
          syncedCount++;
        }
        
        if (pr.mergedAt && pr.status === "merged") {
          const mergedBy = (pr.mergedBy && /^[0-9a-f]{64}$/i.test(pr.mergedBy))
            ? pr.mergedBy
            : ((pr.author && /^[0-9a-f]{64}$/i.test(pr.author)) ? pr.author : ownerPubkey);
          
          recordActivity({
            type: "pr_merged",
            user: mergedBy,
            repo: repoId,
            entity: repo.entity,
            repoName: repoName,
            metadata: {
              prId: pr.id,
              commitId: pr.mergeCommit,
            },
            timestamp: pr.mergedAt,
          } as any);
          syncedCount++;
        }
      }
    }

    if (syncedCount > 0) {
      console.log(`✅ [Activity Sync] Synced ${syncedCount} issues/PRs from Nostr for user ${userPubkey.slice(0, 8)}...`);
    }

    return syncedCount;
  } catch (error) {
    console.error("❌ [Activity Sync] Failed to sync issues/PRs from Nostr:", error);
    return 0;
  }
}

/**
 * Sync commits from bridge for all repos owned by a user
 * This is called when viewing a profile to ensure activity bar is up-to-date
 */
export async function syncUserCommitsFromBridge(userPubkey: string): Promise<number> {
  try {
    const repos = JSON.parse(localStorage.getItem("gittr_repos") || "[]") as any[];
    const userRepos = repos.filter((repo: any) => {
      if (!repo.entity || repo.entity === "user") return false;
      const ownerPubkey = getRepoOwnerPubkey(repo, repo.entity);
      return ownerPubkey && ownerPubkey.toLowerCase() === userPubkey.toLowerCase();
    });

    let totalSynced = 0;

    // Sync commits for each repo (limit to 10 repos to avoid overwhelming)
    for (const repo of userRepos.slice(0, 10)) {
      const ownerPubkey = getRepoOwnerPubkey(repo, repo.entity);
      if (!ownerPubkey) continue;

      const repoName = repo.repo || repo.slug;
      const branch = repo.defaultBranch || "main";

      try {
        const synced = await syncCommitsFromBridge(ownerPubkey, repo.entity, repoName, branch);
        totalSynced += synced;
        
        // Small delay between repos to avoid overwhelming the bridge
        await new Promise(resolve => setTimeout(resolve, 200));
      } catch (error) {
        console.error(`❌ [Activity Sync] Failed to sync commits for ${repo.entity}/${repoName}:`, error);
      }
    }

    if (totalSynced > 0) {
      console.log(`✅ [Activity Sync] Synced ${totalSynced} total commits from bridge for user ${userPubkey.slice(0, 8)}...`);
    }

    return totalSynced;
  } catch (error) {
    console.error("❌ [Activity Sync] Failed to sync user commits:", error);
    return 0;
  }
}

/**
 * Count activities directly from Nostr events (network source of truth)
 * This is the PRIMARY way to count activities - people use multiple clients!
 * 
 * Counts:
 * - Repos: kind 30617 (repo announcements)
 * - Pushes: kind 30618 (repo state events - indicate new commits/pushes)
 * - PRs: kind 1618 (PR events) + kind 1631 (PR merged status)
 * - Issues: kind 1621 (issue events) + kind 1632 (issue closed status)
 */
export interface NostrActivityCounts {
  repos: number; // Unique repos (kind 30617)
  pushes: number; // Repo state updates (kind 30618) - indicates pushes
  prsCreated: number; // PR events (kind 1618)
  prsMerged: number; // PR merged status (kind 1631)
  issuesCreated: number; // Issue events (kind 1621)
  issuesClosed: number; // Issue closed status (kind 1632)
  total: number; // Total activity count
}

export function countActivitiesFromNostr(
  subscribe: (
    filters: any[],
    relays: string[],
    onEvent: (event: any, isAfterEose: boolean, relayURL?: string) => void,
    maxDelayms?: number,
    onEose?: (relayUrl: string, minCreatedAt: number) => void,
    options?: any
  ) => () => void,
  relays: string[],
  userPubkey: string
): Promise<NostrActivityCounts> {
  // CRITICAL: Only use GRASP/git relays - regular relays don't have git events!
  const { getGraspServers } = require("@/lib/utils/grasp-servers");
  const graspRelays = getGraspServers(relays);
  const activeRelays = graspRelays.length > 0 ? graspRelays : relays; // Fallback if no GRASP relays
  
  // CRITICAL: Normalize pubkey to lowercase for consistent querying
  // Nostr pubkeys are case-insensitive, but some relays might be strict
  const normalizedPubkey = userPubkey.toLowerCase();
  
  console.log(`🔍 [Nostr Activity Count] Starting query for ${normalizedPubkey.slice(0, 8)}... using ${activeRelays.length} GRASP/git relays (filtered from ${relays.length} total):`, activeRelays);
  
  return new Promise((resolve) => {
    const counts: NostrActivityCounts = {
      repos: 0,
      pushes: 0,
      prsCreated: 0,
      prsMerged: 0,
      issuesCreated: 0,
      issuesClosed: 0,
      total: 0,
    };

    const seenRepos = new Set<string>(); // Track unique repos (pubkey/repoName)
    const seenPRs = new Set<string>(); // Track unique PRs (event ID)
    const seenIssues = new Set<string>(); // Track unique issues (event ID)
    let eoseCount = 0;
    const expectedEose = activeRelays.length;
    let resolved = false;

    // Find ALL repos and ALL activities (no time limit)
    // If we find repos, we should find their associated activities
    // CRITICAL: Use normalized pubkey (lowercase) for all queries
    const filters = [
      // Repo announcements (kind 30617) - find ALL repos
      {
        kinds: [KIND_REPOSITORY_NIP34],
        authors: [normalizedPubkey],
        limit: 1000,
      },
      // Repo state events (kind 30618) - indicate pushes/new commits (ALL time)
      {
        kinds: [KIND_REPOSITORY_STATE],
        authors: [normalizedPubkey],
        limit: 1000,
      },
      // PR events (kind 1618) - ALL time
      {
        kinds: [KIND_PULL_REQUEST],
        authors: [normalizedPubkey],
        limit: 1000,
      },
      // PR merged status (kind 1631) - ALL time
      {
        kinds: [KIND_STATUS_APPLIED],
        authors: [normalizedPubkey],
        "#k": ["1618"], // Only PR status events
        limit: 1000,
      },
      // Issue events (kind 1621) - ALL time
      {
        kinds: [KIND_ISSUE],
        authors: [normalizedPubkey],
        limit: 1000,
      },
      // Issue closed status (kind 1632) - ALL time
      {
        kinds: [KIND_STATUS_CLOSED],
        authors: [normalizedPubkey],
        "#k": ["1621"], // Only issue status events
        limit: 1000,
      },
    ];

    const unsub = subscribe(
      filters,
      activeRelays,
      (event, _isAfterEose, _relayURL) => {
        // Count repo announcements (kind 30617) - but DON'T count as activity
        // Repos are metadata, not user actions. We track them separately.
        if (event.kind === KIND_REPOSITORY_NIP34) {
          const dTag = event.tags?.find((t: any) => Array.isArray(t) && t[0] === "d");
          const repoName = dTag?.[1];
          if (repoName) {
            const repoKey = `${event.pubkey}/${repoName}`;
            if (!seenRepos.has(repoKey)) {
              seenRepos.add(repoKey);
              counts.repos++;
              // DON'T increment total - repos are metadata, not activities
            }
          }
        }
        // Count repo state events (kind 30618) - these indicate pushes
        // CRITICAL: Normalize event pubkey to lowercase for comparison
        else if (event.kind === KIND_REPOSITORY_STATE) {
          const eventPubkey = (event.pubkey || "").toLowerCase();
          if (eventPubkey === normalizedPubkey) {
            counts.pushes++;
            counts.total++;
          }
        }
        // Count PR events (kind 1618)
        // CRITICAL: Normalize event pubkey to lowercase for comparison
        else if (event.kind === KIND_PULL_REQUEST) {
          const eventPubkey = (event.pubkey || "").toLowerCase();
          if (eventPubkey === normalizedPubkey && !seenPRs.has(event.id)) {
            seenPRs.add(event.id);
            counts.prsCreated++;
            counts.total++;
          }
        }
        // Count PR merged status (kind 1631)
        // CRITICAL: Normalize event pubkey to lowercase for comparison
        else if (event.kind === KIND_STATUS_APPLIED) {
          const eventPubkey = (event.pubkey || "").toLowerCase();
          if (eventPubkey === normalizedPubkey) {
            const kTag = event.tags?.find((t: any) => Array.isArray(t) && t[0] === "k");
            if (kTag && kTag[1] === "1618") {
              // This is a PR merged status
              counts.prsMerged++;
              counts.total++;
            }
          }
        }
        // Count issue events (kind 1621)
        // CRITICAL: Normalize event pubkey to lowercase for comparison
        else if (event.kind === KIND_ISSUE) {
          const eventPubkey = (event.pubkey || "").toLowerCase();
          if (eventPubkey === normalizedPubkey && !seenIssues.has(event.id)) {
            seenIssues.add(event.id);
            counts.issuesCreated++;
            counts.total++;
          }
        }
        // Count issue closed status (kind 1632)
        // CRITICAL: Normalize event pubkey to lowercase for comparison
        else if (event.kind === KIND_STATUS_CLOSED) {
          const eventPubkey = (event.pubkey || "").toLowerCase();
          if (eventPubkey === normalizedPubkey) {
            const kTag = event.tags?.find((t: any) => Array.isArray(t) && t[0] === "k");
            if (kTag && kTag[1] === "1621") {
              // This is an issue closed status
              counts.issuesClosed++;
              counts.total++;
            }
          }
        }
      },
      undefined,
      (relayUrl: string, minCreatedAt: number) => {
        // EOSE from this relay
        eoseCount++;
        if (eoseCount >= expectedEose && !resolved) {
          resolved = true;
          setTimeout(() => {
            unsub();
            console.log(`✅ [Nostr Activity Count] Final counts from Nostr for ${userPubkey.slice(0, 8)}:`, {
              repos: counts.repos,
              pushes: counts.pushes,
              prsCreated: counts.prsCreated,
              prsMerged: counts.prsMerged,
              issuesCreated: counts.issuesCreated,
              issuesClosed: counts.issuesClosed,
              total: counts.total,
            });
            resolve(counts);
          }, 1000); // Wait 1s after EOSE for any delayed events
        }
      },
      {} // options parameter
    );

    // Timeout after 15 seconds (need more time to get all activity from all time)
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        unsub();
        console.log(`⏱️ [Nostr Activity Count] Timeout after 15s (EOSE: ${eoseCount}/${expectedEose}), returning counts:`, {
          repos: counts.repos,
          pushes: counts.pushes,
          prsCreated: counts.prsCreated,
          prsMerged: counts.prsMerged,
          issuesCreated: counts.issuesCreated,
          issuesClosed: counts.issuesClosed,
          total: counts.total,
        });
        resolve(counts);
      }
    }, 15000);
  });
}

