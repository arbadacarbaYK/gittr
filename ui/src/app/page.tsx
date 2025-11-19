"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useCallback } from "react";
import useSession from "@/lib/nostr/useSession";
import { Button } from "@/components/ui/button";
import { getTopRepos, getTopDevsByPRs, getTopBountyTakers, getTopUsers, getLatestBounties, getOpenBounties, getOwnBountyStats, getRecentActivity, getOpenPRsAndIssues, getRecentBountyActivities, getUserBountyActivityStats, getPlatformBountyStats, RepoStats, UserStats } from "@/lib/stats";
import { backfillActivities, Activity } from "@/lib/activity-tracking";
import { useContributorMetadata } from "@/lib/nostr/useContributorMetadata";
import { useNostrContext } from "@/lib/nostr/NostrContext";
import { getRepoOwnerPubkey, getEntityDisplayName } from "@/lib/utils/entity-resolver";
import { getRepoStatus, getStatusBadgeStyle } from "@/lib/utils/repo-status";
import { formatDateTime24h } from "@/lib/utils/date-format";
import { nip19 } from "nostr-tools";
import { ZapButton } from "@/components/ui/zap-button";
import { loadStoredRepos, type StoredRepo } from "@/lib/repos/storage";

type Repo = {
  slug: string;
  entity?: string;
  repo?: string;
  name: string;
  sourceUrl?: string;
  createdAt: number;
  entityDisplayName?: string;
  ownerPubkey?: string; // Full 64-char pubkey
  logoUrl?: string;
  files?: Array<{type: string; path: string; size?: number}>;
  defaultBranch?: string;
  nostrEventId?: string;
  lastNostrEventId?: string;
  syncedFromNostr?: boolean;
  deleted?: boolean;
  archived?: boolean;
};

export default function HomePage() {
  const { isLoggedIn, name } = useSession();
  const { pubkey } = useNostrContext();
  const [repos, setRepos] = useState<Repo[]>([]);
  const [topRepos, setTopRepos] = useState<RepoStats[]>([]);
  const [topDevs, setTopDevs] = useState<UserStats[]>([]);
  const [topBountyTakers, setTopBountyTakers] = useState<UserStats[]>([]);
  const [topUsers, setTopUsers] = useState<UserStats[]>([]);
  const [latestBounties, setLatestBounties] = useState<any[]>([]);
  const [openBounties, setOpenBounties] = useState<any[]>([]);
  const [ownBountyStats, setOwnBountyStats] = useState<{totalPending: number; totalPaid: number; totalReleased: number; totalAmount: number; pendingAmount: number; paidAmount: number; releasedAmount: number} | null>(null);
  const [recentBountyActivities, setRecentBountyActivities] = useState<Activity[]>([]);
  const [userBountyActivityStats, setUserBountyActivityStats] = useState<{bountiesSetOut: number; bountiesClaimed: number; totalSetOutAmount: number; totalClaimedAmount: number} | null>(null);
  const [platformBountyStats, setPlatformBountyStats] = useState<{totalAvailable: number; pendingPayment: number; availableBounties: number; totalBounties: number; pendingCount: number; releasedCount: number; offlineCount: number} | null>(null);
  const [recentActivity, setRecentActivity] = useState<Activity[]>([]);
  const [openPRsAndIssues, setOpenPRsAndIssues] = useState<{openPRs: number; openIssues: number; recentPRs: any[]; recentIssues: any[]} | null>(null);
  const [statsLoaded, setStatsLoaded] = useState(false);

  // Load repos and listen for updates from Nostr sync
  const loadRepos = useCallback(() => {
    try {
      const list = loadStoredRepos();
      setRepos(list as Repo[]);
    } catch {
      setRepos([]);
    }
  }, []);

  useEffect(() => {
    loadRepos();
    
    // Listen for repo updates from Nostr sync
    const handleRepoUpdate = () => {
      loadRepos();
    };
    
    window.addEventListener("storage", handleRepoUpdate);
    window.addEventListener("ngit:repo-created", handleRepoUpdate);
    window.addEventListener("ngit:repo-imported", handleRepoUpdate);
    
    return () => {
      window.removeEventListener("storage", handleRepoUpdate);
      window.removeEventListener("ngit:repo-created", handleRepoUpdate);
      window.removeEventListener("ngit:repo-imported", handleRepoUpdate);
    };
  }, [loadRepos]);

  // Backfill activities on first load (if not already done)
  useEffect(() => {
    // Check if activities exist - if not, force backfill even if flag is set
    const activities = JSON.parse(localStorage.getItem("gittr_activities") || "[]");
    const backfilled = localStorage.getItem("ngit_activities_backfilled");
    
    // If no activities exist, force a backfill (even if flag was set before)
    if (activities.length === 0 || !backfilled) {
      console.log("Backfilling activities...");
      backfillActivities();
      localStorage.setItem("ngit_activities_backfilled", "true");
      // Trigger stats refresh after backfill completes
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent("gittr:activity-recorded"));
      }, 1000);
    }
    
    // Listen for new activities
    const handleActivity = () => {
      try {
      // CRITICAL: Show platform-wide stats (all repos/users) for Most Active cards
      // These should show ALL repos like the explore page
      setTopRepos(getTopRepos(10)); // Always show all repos (no pubkey filter)
      setTopUsers(getTopUsers(10)); // Always show all users (no pubkey filter)
      
      // These are always platform-wide (not filtered by user access)
      setTopDevs(getTopDevsByPRs(10));
      setTopBountyTakers(getTopBountyTakers(10));
      setLatestBounties(getLatestBounties(5)); // Show all bounties (from all users)
      setOpenBounties(getOpenBounties(5)); // Show open/available bounties
      
      if (pubkey) {
        setOwnBountyStats(getOwnBountyStats(pubkey)); // Show user's own bounty stats
        setRecentBountyActivities(getRecentBountyActivities(pubkey, 5)); // Recent bounty activities
        setUserBountyActivityStats(getUserBountyActivityStats(pubkey)); // Bounty activity stats
        // Show PRs and issues from repos where user has write access (only when logged in)
        setOpenPRsAndIssues(getOpenPRsAndIssues(pubkey));
        // Recent Activity: Only show repos where user is owner or has write access
        setRecentActivity(getRecentActivity(10, pubkey));
      } else {
        setRecentBountyActivities([]);
        setUserBountyActivityStats(null);
        // Don't show PRs & Issues when not logged in
        setOpenPRsAndIssues(null);
        // Recent Activity: Show all when not logged in
        setRecentActivity(getRecentActivity(10));
      }
      // Always load platform-wide bounty stats
      setPlatformBountyStats(getPlatformBountyStats());
      } catch (error) {
        console.error("Error loading stats:", error);
        // Set empty arrays to prevent UI breaking
        setTopRepos([]);
        setTopUsers([]);
        setTopDevs([]);
        setTopBountyTakers([]);
        setLatestBounties([]);
        setOpenBounties([]);
        setRecentActivity([]);
      } finally {
        // Always set statsLoaded to true, even if there was an error
        // This ensures the grid container renders (even if empty)
      setStatsLoaded(true);
      }
    };
    
    handleActivity();
    window.addEventListener("gittr:activity-recorded", handleActivity);
    window.addEventListener("ngit:activity-recorded", handleActivity); // Also listen for old event name
    window.addEventListener("ngit:pr-updated", handleActivity);
    window.addEventListener("ngit:issue-updated", handleActivity);
    
    return () => {
      window.removeEventListener("gittr:activity-recorded", handleActivity);
      window.removeEventListener("ngit:activity-recorded", handleActivity);
      window.removeEventListener("ngit:pr-updated", handleActivity);
      window.removeEventListener("ngit:issue-updated", handleActivity);
    };
  }, [pubkey]); // Re-run when pubkey changes (login/logout)

  const recent = useMemo(() => {
    // Sort by createdAt, newest first
    const sorted = repos.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    
    // Deduplicate repos by entity/repo combination (keep the most recent one)
    const dedupeMap = new Map<string, Repo>();
    sorted.forEach((r) => {
      const entity = (r.entity || '').trim();
      const repo = (r.repo || r.slug || '').trim();
      const key = `${entity}/${repo}`.toLowerCase(); // Case-insensitive comparison
      const existing = dedupeMap.get(key);
      if (!existing) {
        dedupeMap.set(key, r);
      } else {
        // Keep the one with the most recent createdAt OR the one with an event ID (if one has it and the other doesn't)
        const rHasEventId = !!(r.nostrEventId || (r as any).lastNostrEventId || (r as any).syncedFromNostr);
        const existingHasEventId = !!(existing.nostrEventId || (existing as any).lastNostrEventId || (existing as any).syncedFromNostr);
        
        // Prefer repo with event ID (it's more up-to-date)
        if (rHasEventId && !existingHasEventId) {
          dedupeMap.set(key, r);
        } else if (!rHasEventId && existingHasEventId) {
          // Keep existing (has event ID)
        } else if ((r.createdAt || 0) > (existing.createdAt || 0)) {
          // Both have or both don't have event ID - keep most recent
          dedupeMap.set(key, r);
        }
      }
    });
    
    // Load list of locally-deleted repos (user deleted them, don't show)
    // CRITICAL: Use same key as explore page for consistency
    const deletedRepos = JSON.parse(localStorage.getItem("gittr_deleted_repos") || "[]") as Array<{entity: string; repo: string; deletedAt: number}>;
    
    // Filter out deleted/archived repos AND locally-deleted repos
    const filtered = Array.from(dedupeMap.values()).filter((r: any) => {
      // Check if repo is marked as deleted/archived on Nostr
      if (r.deleted === true || r.archived === true) return false;
      
      // Check if repo is in locally-deleted list (robust matching)
      const entity = (r.entity || '').trim();
      const repo = (r.repo || r.slug || '').trim();
      const ownerPubkey = (r.ownerPubkey || '').trim();
      
      // Check if this repo matches any deleted repo entry
      const isDeleted = deletedRepos.some((d: any) => {
        const deletedEntity = (d.entity || '').trim();
        const deletedRepo = (d.repo || '').trim();
        
        // Match by repo name first
        if (deletedRepo.toLowerCase() !== repo.toLowerCase()) return false;
        
        // Match by entity (exact match)
        if (deletedEntity.toLowerCase() === entity.toLowerCase()) return true;
        
        // Match by ownerPubkey if available (most reliable)
        if (ownerPubkey && /^[0-9a-f]{64}$/i.test(ownerPubkey)) {
          // Try to decode deleted entity if it's npub
          if (deletedEntity && deletedEntity.startsWith('npub')) {
            try {
              const decoded = nip19.decode(deletedEntity);
              if (decoded.type === 'npub' && (decoded.data as string).toLowerCase() === ownerPubkey.toLowerCase()) {
                return true;
              }
            } catch {}
          }
          // Match by full pubkey
          if (deletedEntity && deletedEntity.toLowerCase() === ownerPubkey.toLowerCase()) return true;
        }
        
        // Match by entity prefix (8-char)
        if (deletedEntity && deletedEntity.length === 8 && entity && entity.toLowerCase().startsWith(deletedEntity.toLowerCase())) return true;
        if (entity && entity.length === 8 && deletedEntity && deletedEntity.toLowerCase().startsWith(entity.toLowerCase())) return true;
        
        return false;
      });
      
      if (isDeleted) return false;
      
      return true;
    });
    
    // Return top 12 unique repos
    return filtered.slice(0, 12);
  }, [repos]);

  // Get metadata for user avatars (stats)
  const userPubkeys = useMemo(() => [
    ...topDevs.map(d => d.pubkey),
    ...topBountyTakers.map(b => b.pubkey),
    ...topUsers.map(u => u.pubkey),
  ].filter((p, i, arr) => arr.indexOf(p) === i), [topDevs, topBountyTakers, topUsers]);
  
  // Get owner pubkeys from recent repos for metadata fetching
  const recentRepoOwnerPubkeys = useMemo(() => {
    return recent
      .map(r => {
        const ownerPubkey = getRepoOwnerPubkey(r as any, r.entity);
        return ownerPubkey && /^[0-9a-f]{64}$/i.test(ownerPubkey) ? ownerPubkey : null;
      })
      .filter((p): p is string => p !== null);
  }, [recent]);
  
  // Combine all pubkeys for metadata fetching
  const allPubkeys = useMemo(() => [
    ...userPubkeys,
    ...recentRepoOwnerPubkeys,
  ].filter((p, i, arr) => arr.indexOf(p) === i), [userPubkeys, recentRepoOwnerPubkeys]);
  
  const userMetadata = useContributorMetadata(allPubkeys);

  const getDisplayName = (pubkey: string) => {
    const meta = userMetadata[pubkey];
    if (meta?.name || meta?.display_name) {
      return meta.name || meta.display_name;
    }
    // Fallback to npub format (not shortened pubkey)
    try {
      const { nip19 } = require("nostr-tools");
      const npub = nip19.npubEncode(pubkey);
      return `${npub.substring(0, 16)}...`;
    } catch {
      return pubkey.slice(0, 8);
    }
  };
  
  // Helper function to convert entity to npub URL format
  const getRepoUrl = useCallback((entity: string, repoPath: string): string => {
    if (!entity || !repoPath) return "#";
    
    // Extract repo name from path (might include /issues/123 or /pulls/456)
    const repoName = repoPath.split("/")[0];
    const subPath = repoPath.includes("/") ? "/" + repoPath.split("/").slice(1).join("/") : "";
    
    // Try to find the repo and get ownerPubkey
    try {
      const repos = loadStoredRepos();
      const foundRepo = repos.find((r) => {
        const rEntity = r.entity;
        const rRepo = r.repo || r.slug?.split("/")[1] || r.slug;
        return (rEntity === entity || (rEntity && entity && entity.length === 8 && rEntity.toLowerCase().startsWith(entity.toLowerCase()))) &&
               (rRepo === repoName || r.slug === `${entity}/${repoName}`);
      });
      
      if (foundRepo) {
        const ownerPubkey = getRepoOwnerPubkey(foundRepo, entity);
        if (ownerPubkey && /^[0-9a-f]{64}$/i.test(ownerPubkey)) {
          try {
            const npub = nip19.npubEncode(ownerPubkey);
            return `/${npub}/${repoName}${subPath}`;
          } catch {
            // Fallback to entity if encoding fails
          }
        }
      }
    } catch {
      // Fallback to entity if lookup fails
    }
    
    // Fallback: use entity as-is (might be npub already, or 8-char prefix)
    return `/${entity}/${repoPath}`;
  }, []);
  
  // Resolve repo icon (same logic as explore page)
  const resolveRepoIcon = (repo: Repo): string | null => {
    // Priority 1: Stored logoUrl
    if (repo.logoUrl && repo.logoUrl.trim().length > 0) {
      return repo.logoUrl;
    }
    
    // Priority 2: Logo file from repo
    if (repo.files && repo.files.length > 0) {
      const logoFiles = repo.files
        .map(f => f.path)
        .filter(p => {
          const fileName = p.split("/").pop() || "";
          const baseName = fileName.replace(/\.[^.]+$/, "").toLowerCase();
          const extension = fileName.split(".").pop()?.toLowerCase() || "";
          const imageExts = ["png", "jpg", "jpeg", "gif", "webp", "svg", "ico"];
          return baseName.includes("logo") && imageExts.includes(extension);
        });
      
      if (logoFiles.length > 0) {
        const prioritized = logoFiles.sort((a, b) => {
          const aParts = a.split("/");
          const bParts = b.split("/");
          const aName = aParts[aParts.length - 1]?.replace(/\.[^.]+$/, "").toLowerCase() || "";
          const bName = bParts[bParts.length - 1]?.replace(/\.[^.]+$/, "").toLowerCase() || "";
          const aIsRoot = aParts.length === 1;
          const bIsRoot = bParts.length === 1;
          
          if (aName === "logo" && bName !== "logo") return -1;
          if (bName === "logo" && aName !== "logo") return 1;
          if (aName === "logo" && bName === "logo") {
            if (aIsRoot && !bIsRoot) return -1;
            if (!aIsRoot && bIsRoot) return 1;
          }
          if (aIsRoot && !bIsRoot) return -1;
          if (!aIsRoot && bIsRoot) return 1;
          
          const aExt = a.split(".").pop()?.toLowerCase() || "";
          const bExt = b.split(".").pop()?.toLowerCase() || "";
          const formatPriority = { png: 0, svg: 1, webp: 2, jpg: 3, jpeg: 3, gif: 4, ico: 5 };
          const aPrio = formatPriority[aExt as keyof typeof formatPriority] ?? 10;
          const bPrio = formatPriority[bExt as keyof typeof formatPriority] ?? 10;
          return aPrio - bPrio;
        });
        
        const logoPath = prioritized[0];
        
        // Only proceed if we have a logoPath
        if (!logoPath) return null;
        
        // For GitHub repos, use GitHub raw URL
        if (repo.sourceUrl) {
          try {
            const url = new URL(repo.sourceUrl);
            if (url.hostname === "github.com") {
              const parts = url.pathname.split("/").filter(Boolean);
              if (parts.length >= 2 && parts[0] && parts[1]) {
                const owner = parts[0];
                const repoName = parts[1].replace(/\.git$/, "");
                const branch = repo.defaultBranch || "main";
                return `https://raw.githubusercontent.com/${owner}/${repoName}/${encodeURIComponent(branch)}/${logoPath}`;
              }
            }
          } catch {}
        }
        
        // For native Nostr repos (without sourceUrl), use the API endpoint
        // CRITICAL: Construct API URL for logo files from native Nostr repos
        if (!repo.sourceUrl) {
          const ownerPubkey = repo.entity ? getRepoOwnerPubkey(repo as any, repo.entity) : null;
          const repoName = repo.repo || repo.slug || repo.name;
          if (ownerPubkey && /^[0-9a-f]{64}$/i.test(ownerPubkey) && repoName) {
            const branch = repo.defaultBranch || "main";
            // Construct API URL - this will work for native Nostr repos
            return `/api/nostr/repo/file-content?ownerPubkey=${encodeURIComponent(ownerPubkey)}&repo=${encodeURIComponent(repoName)}&path=${encodeURIComponent(logoPath)}&branch=${encodeURIComponent(branch || "main")}`;
          }
        }
      }
    }
    
    // Priority 3: Owner Nostr profile picture
    const ownerPubkey = repo.entity ? getRepoOwnerPubkey(repo as any, repo.entity) : null;
    if (ownerPubkey && /^[0-9a-f]{64}$/i.test(ownerPubkey)) {
      const metadata = userMetadata[ownerPubkey];
      if (metadata?.picture) {
        const picture = metadata.picture;
        if (picture && picture.trim().length > 0 && picture.startsWith("http")) {
          return picture;
        }
      }
    }
    
    return null;
  };

  return (
    <div className="container mx-auto max-w-[95%] xl:max-w-[90%] 2xl:max-w-[85%] p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold">Home</h1>
        <p className="text-gray-400 mt-1">
          {isLoggedIn ? `Welcome, ${name || "nostr user"}` : "Welcome. Please log in with NIP-07 to create and fork repos."}
        </p>
      </header>

      {/* Stats Cards */}
      {statsLoaded && (
        <>
          {/* Top Row: Most Active Repos, Most Active Users, Open Bounties - Equal width row matching Recent repositories width */}
          <div className="mb-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* Top Repos - Always show */}
            <div className="border border-[#383B42] rounded p-4 flex flex-col">
              <h3 className="font-semibold mb-3 text-purple-400">🔥 Most Active Repos</h3>
              <div className="space-y-2 flex-1">
                {topRepos.length > 0 ? (
                  topRepos.slice(0, 5).map((repo, idx) => {
                    // repoId is in format "entity/repo"
                    const [entity, repoName] = (repo.repoId && typeof repo.repoId === 'string' && repo.repoId.includes("/")) 
                      ? repo.repoId.split("/") 
                      : [repo.entity || "", repo.repoId || ""];
                    const href = getRepoUrl(entity || "", repoName || "");
                    
                    return (
                      <Link 
                        key={repo.repoId} 
                        href={href}
                        className="block hover:bg-gray-800/50 rounded p-2 -m-2"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-purple-300 truncate flex-1">
                            {idx + 1}. {repo.repoName}
                          </span>
                          <span className="text-xs text-gray-500 ml-2">{repo.activityCount}</span>
                        </div>
                      </Link>
                    );
                  })
                ) : (
                  <div className="text-sm text-gray-500 py-2">No active repos yet</div>
                )}
              </div>
            </div>

            {/* Top Users - Always show */}
            <div className="border border-[#383B42] rounded p-4 flex flex-col">
              <h3 className="font-semibold mb-3 text-yellow-400">⭐ Most Active</h3>
              <div className="space-y-2 flex-1">
                {topUsers.length > 0 ? (
                  topUsers.slice(0, 5).map((user, idx) => {
                    // Use full pubkey for profile link (more reliable than 8-char prefix)
                    return (
                      <Link
                        key={user.pubkey}
                        href={`/${user.pubkey}`}
                        className="block hover:bg-gray-800/50 rounded p-2 -m-2"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-yellow-300 truncate flex-1">
                            {idx + 1}. {getDisplayName(user.pubkey)}
                          </span>
                          <span className="text-xs text-gray-500 ml-2">{user.activityCount}</span>
                        </div>
                      </Link>
                    );
                  })
                ) : (
                  <div className="text-sm text-gray-500 py-2">No active users yet</div>
                )}
              </div>
            </div>

            {/* Open Bounties - Always show */}
            <div className="border border-[#383B42] rounded p-4 flex flex-col">
              <h3 className="font-semibold mb-3 text-yellow-400 flex items-center justify-between">
                <span>💰 Open Bounties</span>
                <Link href="/bounty-hunt?status=paid" className="text-xs text-purple-400 hover:text-purple-300">
                  Hunt →
                </Link>
              </h3>
              <div className="space-y-2 flex-1">
                {openBounties.length > 0 ? (
                  openBounties.slice(0, 5).map((bounty, idx) => {
                    const href = getRepoUrl(bounty.entity, `${bounty.repoName}/issues/${bounty.issueId}`);
                    return (
                      <Link
                        key={bounty.issueId}
                        href={href}
                        className="block hover:bg-gray-800/50 rounded p-2 -m-2"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="text-sm text-yellow-300 truncate">
                              {idx + 1}. {bounty.title}
                            </div>
                            <div className="text-xs text-gray-500 truncate mt-0.5">
                              {bounty.repoName}
                            </div>
                          </div>
                          <div className="text-xs text-yellow-400 font-semibold whitespace-nowrap">
                            {bounty.bountyAmount.toLocaleString()}⚡
                          </div>
                        </div>
                      </Link>
                    );
                  })
                ) : (
                  <div className="text-sm text-gray-500 py-2">No open bounties available</div>
                )}
              </div>
            </div>
          </div>

          {/* Other Stats Cards - Second Row */}
          <div className="mb-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-6 gap-4 auto-rows-fr">
            {/* Top Devs */}
            {topDevs.length > 0 && (
              <div className="border border-[#383B42] rounded p-4">
                <h3 className="font-semibold mb-3 text-green-400">⚡ Active Mergers</h3>
                <div className="space-y-2">
                  {topDevs.slice(0, 5).map((dev, idx) => {
                    // Use full pubkey for profile link (more reliable than 8-char prefix)
                    return (
                      <Link
                        key={dev.pubkey}
                        href={`/${dev.pubkey}`}
                        className="block hover:bg-gray-800/50 rounded p-2 -m-2"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-green-300 truncate flex-1">
                            {idx + 1}. {getDisplayName(dev.pubkey)}
                          </span>
                          <span className="text-xs text-gray-500 ml-2">{dev.prMergedCount} PRs</span>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Top Bounty Takers */}
            {topBountyTakers.length > 0 && (
              <div className="border border-[#383B42] rounded p-4">
                <h3 className="font-semibold mb-3 text-yellow-400">💰 Bounty Hunters</h3>
                <div className="space-y-2">
                  {topBountyTakers.slice(0, 5).map((hunter, idx) => {
                    // Use full pubkey for profile link (more reliable than 8-char prefix)
                    return (
                      <Link
                        key={hunter.pubkey}
                        href={`/${hunter.pubkey}`}
                        className="block hover:bg-gray-800/50 rounded p-2 -m-2"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-yellow-300 truncate flex-1">
                            {idx + 1}. {getDisplayName(hunter.pubkey)}
                          </span>
                          <span className="text-xs text-gray-500 ml-2">{hunter.bountyClaimedCount}</span>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Platform Bounty Statistics */}
          {platformBountyStats && platformBountyStats.totalBounties > 0 && (
            <div className="border border-[#383B42] rounded p-4">
              <h3 className="font-semibold mb-3 text-yellow-400 flex items-center justify-between">
                <span>💰 Bounty Statistics</span>
                <Link href="/bounty-hunt" className="text-xs text-purple-400 hover:text-purple-300">
                  Hunt →
                </Link>
              </h3>
              <div className="space-y-2 text-sm">
                <Link href="/bounty-hunt?status=paid" className="block hover:bg-gray-800/50 rounded p-2 -m-2">
                  <div className="flex justify-between">
                    <span className="text-gray-400">Available:</span>
                    <span className="text-green-400 font-semibold">
                      {platformBountyStats.availableBounties} ({platformBountyStats.totalAvailable.toLocaleString()} sats)
                    </span>
                  </div>
                </Link>
                <Link href="/bounty-hunt?status=pending" className="block hover:bg-gray-800/50 rounded p-2 -m-2">
                  <div className="flex justify-between">
                    <span className="text-gray-400">Pending:</span>
                    <span className="text-yellow-400 font-semibold">
                      {platformBountyStats.pendingCount} ({platformBountyStats.pendingPayment.toLocaleString()} sats)
                    </span>
                  </div>
                </Link>
                <Link href="/bounty-hunt?status=released" className="block hover:bg-gray-800/50 rounded p-2 -m-2">
                  <div className="flex justify-between">
                    <span className="text-gray-400">Released:</span>
                    <span className="text-purple-400 font-semibold">
                      {platformBountyStats.releasedCount}
                    </span>
                  </div>
                </Link>
                {platformBountyStats.offlineCount > 0 && (
                  <div className="flex justify-between">
                    <span className="text-gray-400">Offline:</span>
                    <span className="text-gray-500 font-semibold">
                      {platformBountyStats.offlineCount}
                    </span>
                  </div>
                )}
                <div className="pt-2 border-t border-[#383B42] flex justify-between">
                  <span className="text-gray-300 font-semibold">Total:</span>
                  <span className="text-yellow-300 font-bold">
                    {platformBountyStats.totalBounties}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Your Bounty Status (if logged in) */}
          {isLoggedIn && ownBountyStats && (ownBountyStats.totalPending > 0 || ownBountyStats.totalPaid > 0 || ownBountyStats.totalReleased > 0) && (
            <div className="border border-[#383B42] rounded p-4">
              <h3 className="font-semibold mb-3 text-yellow-400">💰 Your Bounties</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-400">Pending Payment:</span>
                  <span className="text-yellow-400 font-semibold">
                    {ownBountyStats.totalPending} ({ownBountyStats.pendingAmount.toLocaleString()} sats)
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Available:</span>
                  <span className="text-green-400 font-semibold">
                    {ownBountyStats.totalPaid} ({ownBountyStats.paidAmount.toLocaleString()} sats)
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Claimed:</span>
                  <span className="text-purple-400 font-semibold">
                    {ownBountyStats.totalReleased} ({ownBountyStats.releasedAmount.toLocaleString()} sats)
                  </span>
                </div>
                <div className="pt-2 border-t border-[#383B42] flex justify-between">
                  <span className="text-gray-300 font-semibold">Total:</span>
                  <span className="text-yellow-300 font-bold">
                    {ownBountyStats.totalAmount.toLocaleString()} sats
                  </span>
                </div>
              </div>
              <Link href="/settings/bounties" className="block mt-3 text-xs text-purple-400 hover:text-purple-300">
                Manage bounties →
              </Link>
            </div>
          )}

          {/* Latest Bounties */}
          {latestBounties.length > 0 && (
            <div className="border border-[#383B42] rounded p-4">
              <h3 className="font-semibold mb-3 text-yellow-400">💎 Latest Bounties</h3>
              <div className="space-y-2">
                {latestBounties.slice(0, 5).map((bounty, idx) => {
                  const href = getRepoUrl(bounty.entity, `${bounty.repoName}/issues/${bounty.issueId}`);
                  return (
                    <Link
                      key={bounty.issueId}
                      href={href}
                      className="block hover:bg-gray-800/50 rounded p-2 -m-2"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-yellow-300 truncate">
                            {bounty.title}
                          </div>
                          <div className="text-xs text-gray-500 truncate mt-0.5">
                            {bounty.repoName}
                          </div>
                        </div>
                        <div className="text-xs text-yellow-400 font-semibold whitespace-nowrap">
                          {bounty.bountyAmount.toLocaleString()}⚡
                        </div>
                      </div>
                      {bounty.bountyStatus === "pending" && (
                        <div className="text-[10px] text-gray-500 mt-1">Pending payment</div>
                      )}
                    </Link>
                  );
                })}
              </div>
              <Link href="/bounty-hunt" className="block mt-3 text-xs text-purple-400 hover:text-purple-300">
                View all bounties →
              </Link>
            </div>
          )}

          {/* Your Bounty Activities (if logged in) */}
          {isLoggedIn && userBountyActivityStats && (userBountyActivityStats.bountiesSetOut > 0 || userBountyActivityStats.bountiesClaimed > 0 || recentBountyActivities.length > 0) && (
            <div className="border border-[#383B42] rounded p-4">
              <h3 className="font-semibold mb-3 text-yellow-400">⚡ Your Bounty Activity</h3>
              
              {/* Quick Stats */}
              {(userBountyActivityStats.bountiesSetOut > 0 || userBountyActivityStats.bountiesClaimed > 0) && (
                <div className="mb-3 space-y-1.5 text-xs">
                  {userBountyActivityStats.bountiesSetOut > 0 && (
                    <div className="flex justify-between">
                      <span className="text-gray-400">Bounties Set Out:</span>
                      <span className="text-yellow-300 font-semibold">
                        {userBountyActivityStats.bountiesSetOut} ({userBountyActivityStats.totalSetOutAmount.toLocaleString()} sats)
                      </span>
                    </div>
                  )}
                  {userBountyActivityStats.bountiesClaimed > 0 && (
                    <div className="flex justify-between">
                      <span className="text-gray-400">Bounties Claimed:</span>
                      <span className="text-green-300 font-semibold">
                        {userBountyActivityStats.bountiesClaimed} ({userBountyActivityStats.totalClaimedAmount.toLocaleString()} sats)
                      </span>
                    </div>
                  )}
                </div>
              )}
              
              {/* Recent Activities */}
              {recentBountyActivities.length > 0 && (
                <>
                  <div className="text-xs text-gray-400 mb-2">Recent Activity</div>
                  <div className="space-y-1.5">
                    {recentBountyActivities.slice(0, 3).map((activity) => {
                      const href = activity.entity && activity.repo 
                        ? getRepoUrl(activity.entity, activity.repo.split("/").pop() || activity.repo)
                        : "#";
                      
                      const timeAgo = Math.floor((Date.now() - activity.timestamp) / 1000 / 60);
                      const timeStr = timeAgo < 1 ? "just now" : timeAgo < 60 ? `${timeAgo}m ago` : timeAgo < 1440 ? `${Math.floor(timeAgo / 60)}h ago` : `${Math.floor(timeAgo / 1440)}d ago`;
                      
                      const activityText = activity.type === "bounty_created" 
                        ? `Set bounty on ${activity.repoName || activity.repo}`
                        : `Claimed bounty on ${activity.repoName || activity.repo}`;
                      
                      const bountyAmount = activity.metadata?.bountyAmount;
                      
                      return (
                        <Link
                          key={activity.id}
                          href={href}
                          className="block hover:bg-gray-800/50 rounded p-1.5 -m-1.5"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <div className="text-xs text-yellow-300 truncate">
                                {activityText}
                              </div>
                              <div className="text-[10px] text-gray-500 mt-0.5">
                                {timeStr}
                              </div>
                            </div>
                            {bountyAmount && (
                              <div className="text-xs text-yellow-400 font-semibold whitespace-nowrap">
                                {bountyAmount.toLocaleString()}⚡
                              </div>
                            )}
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                </>
              )}
              
              <div className="flex gap-2 mt-3">
                <Link href="/bounty-hunt" className="text-xs text-purple-400 hover:text-purple-300">
                  Hunt bounties →
                </Link>
                {ownBountyStats && (ownBountyStats.totalPending > 0 || ownBountyStats.totalPaid > 0) && (
                  <Link href="/settings/bounties" className="text-xs text-purple-400 hover:text-purple-300">
                    Manage →
                  </Link>
                )}
              </div>
            </div>
          )}

          {/* Open PRs & Issues - Full width to match Recent Activity section - Only show when logged in and there are PRs or Issues */}
          {isLoggedIn && openPRsAndIssues && (openPRsAndIssues.openPRs > 0 || openPRsAndIssues.openIssues > 0) && (
            <div className="border border-[#383B42] rounded p-4 col-span-full">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-purple-400">📋 Open PRs & Issues</h3>
                <div className="flex gap-3 text-xs">
                  <Link href="/pulls" className="text-purple-400 hover:text-purple-300">
                    {openPRsAndIssues.openPRs} PRs
                  </Link>
                  <span className="text-gray-600">|</span>
                  <Link href="/issues" className="text-purple-400 hover:text-purple-300">
                    {openPRsAndIssues.openIssues} Issues
                  </Link>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {/* Recent PRs */}
                <div>
                  <div className="text-xs text-gray-400 mb-2">Recent PRs</div>
                  <div className="space-y-1.5">
                    {openPRsAndIssues.recentPRs.slice(0, 3).map((pr) => {
                      const href = getRepoUrl(pr.entity, `${pr.repoName}/pulls/${pr.id}`);
                      return (
                        <Link
                          key={pr.id}
                          href={href}
                          className="block hover:bg-gray-800/50 rounded p-1.5 -m-1.5"
                        >
                          <div className="text-xs text-purple-300 truncate">{pr.title}</div>
                          <div className="text-[10px] text-gray-500 truncate">{pr.repoName}</div>
                        </Link>
                      );
                    })}
                    {openPRsAndIssues.recentPRs.length === 0 && (
                      <div className="text-xs text-gray-500">No open PRs</div>
                    )}
                  </div>
                </div>
                {/* Recent Issues */}
                <div>
                  <div className="text-xs text-gray-400 mb-2">Recent Issues</div>
                  <div className="space-y-1.5">
                    {openPRsAndIssues.recentIssues.slice(0, 3).map((issue) => {
                      const href = getRepoUrl(issue.entity, `${issue.repoName}/issues/${issue.id}`);
                      return (
                        <Link
                          key={issue.id}
                          href={href}
                          className="block hover:bg-gray-800/50 rounded p-1.5 -m-1.5"
                        >
                          <div className="text-xs text-purple-300 truncate">{issue.title}</div>
                          <div className="text-[10px] text-gray-500 truncate">{issue.repoName}</div>
                        </Link>
                      );
                    })}
                    {openPRsAndIssues.recentIssues.length === 0 && (
                      <div className="text-xs text-gray-500">No open issues</div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          </div>
        </>
      )}

      {/* Recent Activity - Full Width - Always show */}
      {statsLoaded && (
        <div className="mb-6 border border-[#383B42] rounded p-4">
          <h3 className="font-semibold mb-4 text-purple-400">⚡ Recent Activity</h3>
          {recentActivity.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3">
              {recentActivity.slice(0, 12).map((activity) => {
              const getActivityIcon = () => {
                switch (activity.type) {
                  case "pr_merged": return "🔀";
                  case "commit_created": return "📝";
                  case "repo_zapped": return "⚡";
                  case "issue_created": return "📌";
                  case "release_created": return "🏷️";
                  case "repo_created": return "📦";
                  case "repo_imported": return "⬇️";
                  case "bounty_claimed": return "💰";
                  default: return "•";
                }
              };

              const getActivityText = () => {
                switch (activity.type) {
                  case "pr_merged":
                    return `Merged PR in ${activity.repoName || activity.repo}`;
                  case "commit_created":
                    return `New commit in ${activity.repoName || activity.repo}`;
                  case "repo_zapped":
                    return `Zapped ${activity.repoName || activity.repo}`;
                  case "issue_created":
                    return `New issue in ${activity.repoName || activity.repo}`;
                  case "release_created":
                    return `Release in ${activity.repoName || activity.repo}`;
                  case "repo_created":
                    return `Created ${activity.repoName || activity.repo}`;
                  case "repo_imported":
                    return `Imported ${activity.repoName || activity.repo}`;
                  case "bounty_claimed":
                    return `Bounty claimed in ${activity.repoName || activity.repo}`;
                  default:
                    return `${activity.type} in ${activity.repoName || activity.repo}`;
                }
              };

              const href = activity.entity && activity.repo 
                ? getRepoUrl(activity.entity, activity.repo.split("/").pop() || activity.repo)
                : "#";

              const timeAgo = Math.floor((Date.now() - activity.timestamp) / 1000 / 60);
              const timeStr = timeAgo < 1 ? "just now" : timeAgo < 60 ? `${timeAgo}m ago` : timeAgo < 1440 ? `${Math.floor(timeAgo / 60)}h ago` : `${Math.floor(timeAgo / 1440)}d ago`;

              return (
                <Link
                  key={activity.id}
                  href={href}
                  className="block hover:bg-gray-800/50 rounded p-3 border border-[#383B42] transition-colors"
                >
                  <div className="flex items-start gap-2">
                    <span className="text-base flex-shrink-0">{getActivityIcon()}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-gray-300 truncate">
                        {getActivityText()}
                      </div>
                      <div className="text-xs text-gray-500 mt-1">
                        {timeStr}
                      </div>
                    </div>
                  </div>
                </Link>
              );
            })}
            </div>
          ) : (
            <div className="text-gray-400">No recent activity yet.</div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <section className="lg:col-span-2 border border-[#383B42] rounded p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold">Recent repositories</h2>
            <Link href="/explore" className="text-sm text-purple-500 hover:underline">Explore all</Link>
          </div>
          {recent.length === 0 ? (
            <div className="text-gray-400">No repositories yet. Create or import one to get started.</div>
          ) : (
            <ul className="divide-y divide-[#383B42]">
              {recent.filter((r: any) => {
                // Filter out deleted repos
                return !r.deleted && !r.archived;
              }).map((r) => {
                const entity = r.entity;
                const repo = r.repo || r.slug;
                if (!entity || entity === "user") return null;
                
                // CRITICAL: Resolve full owner pubkey and convert to npub format
                const ownerPubkey = getRepoOwnerPubkey(r as any, entity);
                let href: string;
                
                // Always ensure we have a valid href - never use "#"
                if (!entity || !repo) {
                  console.error('⚠️ [Home] Missing entity or repo:', { entity, repo, r });
                  href = `/explore`; // Fallback to explore page
                } else if (ownerPubkey && /^[0-9a-f]{64}$/i.test(ownerPubkey)) {
                  try {
                    const npub = nip19.npubEncode(ownerPubkey);
                    href = `/${npub}/${repo}`;
                  } catch (error) {
                    console.error('⚠️ [Home] Failed to encode npub:', { ownerPubkey, error });
                    href = `/${entity}/${repo}`;
                  }
                } else {
                  // Use entity format as fallback (route handler accepts both)
                  href = `/${entity}/${repo}`;
                }
                
                // Get display name from metadata
                const displayName = ownerPubkey && /^[0-9a-f]{64}$/i.test(ownerPubkey)
                  ? getEntityDisplayName(ownerPubkey, userMetadata, entity)
                  : (r.entityDisplayName || entity);
                
                // Resolve icons - always show fallback if icon fails
                let iconUrl: string | null = null;
                let ownerPicture: string | undefined = undefined;
                try {
                  iconUrl = resolveRepoIcon(r);
                  if (ownerPubkey && /^[0-9a-f]{64}$/i.test(ownerPubkey)) {
                    ownerPicture = userMetadata[ownerPubkey]?.picture;
                  }
                } catch (error) {
                  console.error('⚠️ [Home] Error resolving icons:', error);
                }
                
                return (
                  <li key={`${entity}-${repo}`} className="py-3">
                    <Link 
                      href={href} 
                      className="flex items-center gap-3 hover:bg-gray-800/50 rounded p-2 -m-2 cursor-pointer"
                    >
                      {/* Unified repo icon (circle): repo pic -> owner profile pic -> nostr default -> logo.svg */}
                      <div className="flex-shrink-0">
                        <div className="relative h-6 w-6 rounded-full overflow-hidden">
                          {/* Priority 1: Repo icon */}
                          {iconUrl && (
                            <img 
                              src={iconUrl} 
                              alt="repo" 
                              className="h-6 w-6 rounded-full object-cover absolute inset-0"
                              loading="lazy"
                              onError={(e) => {
                                e.currentTarget.style.display = 'none';
                              }}
                            />
                          )}
                          {/* Priority 2: Owner profile picture */}
                          {!iconUrl && ownerPicture && (
                            <img 
                              src={ownerPicture} 
                              alt={displayName}
                              className="h-6 w-6 rounded-full object-cover absolute inset-0"
                              loading="lazy"
                              onError={(e) => {
                                e.currentTarget.style.display = 'none';
                              }}
                            />
                          )}
                          {/* Priority 3: Nostr default / logo.svg fallback */}
                          {!iconUrl && !ownerPicture && (
                            <img 
                              src="/logo.svg" 
                              alt="repo" 
                              className="h-6 w-6 rounded-full object-contain absolute inset-0"
                              loading="lazy"
                              onError={(e) => {
                                e.currentTarget.style.display = 'none';
                              }}
                            />
                          )}
                          {/* Final fallback: gray circle */}
                          <span className="inline-block h-6 w-6 rounded-full bg-[#22262C]" />
                        </div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <div className="text-purple-500 hover:underline font-semibold truncate">
                      {displayName}/{r.name || repo}
                          </div>
                          {/* Status badge */}
                          {pubkey && (r as any).ownerPubkey === pubkey && (() => {
                            const status = getRepoStatus(r);
                            const style = getStatusBadgeStyle(status);
                            return (
                              <span className={`text-xs px-2 py-0.5 rounded ${style.bg} ${style.text} flex-shrink-0`}>
                                {style.label}
                              </span>
                            );
                          })()}
                        </div>
                    <div className="text-gray-400 text-sm">
                      {r.sourceUrl ? (
                        <>Imported from {r.sourceUrl}</>
                      ) : (
                        <>Created {formatDateTime24h(r.createdAt)}</>
                      )}
                    </div>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <aside className="space-y-4">
          <div className="border border-[#383B42] rounded p-4">
            <h3 className="font-semibold mb-2">Quick actions</h3>
            <div className="flex flex-col gap-2">
              <Link href="/new">
                <Button className="w-full" variant="default">Create repository</Button>
              </Link>
              <Link href="/explore">
                <Button className="w-full" variant="outline">Explore</Button>
              </Link>
              <Link href="/repositories">
                <Button className="w-full" variant="outline">Your repositories</Button>
              </Link>
              <Link href="/settings">
                <Button className="w-full" variant="outline">Settings</Button>
              </Link>
            </div>
          </div>

          <div className="border border-[#383B42] rounded p-4">
            <h3 className="font-semibold mb-2">Tips</h3>
            <ul className="list-disc list-inside text-gray-400 text-sm space-y-1">
              <li>Import from GitHub to populate code and README.</li>
              <li>Enable zaps in Settings → Account.</li>
              <li>Link your GitHub profile to show contributor icons.</li>
            </ul>
          </div>
        </aside>
      </div>

      {/* Footer */}
      <div className="mt-12 mb-6 flex flex-col items-center justify-center gap-4">
        <p className="text-center text-sm text-gray-400">
          Made by Bitcoiners with{" "}
          <span 
            className="inline-block"
            style={{ color: "var(--color-accent-primary)" }}
          >
            💜
          </span>
        </p>
        <div className="flex items-center justify-center">
          <ZapButton
            recipient="npub1nur7st367ys7cqtjyv74alu84y209zsw8wagpxvrl3g9q2veqzuqjqh65s"
            amount={10}
            comment="Donation to gittr.space"
            recipientMetadata={{
              lud16: "gittr@bitcoindelta.club",
              // LNURL provided as fallback, but LUD-16 will be tried first
              lnurl: "LNURL1DP68GURN8GHJ7CNFW33K76TWV3JKCARP9E3KCATZ9AKXUATJD3CZ75MHVFERYNQARADUV",
            }}
            variant="outline"
            size="sm"
            className="text-sm"
            label="Donate to this project"
          />
        </div>
      </div>
    </div>
  );
}
