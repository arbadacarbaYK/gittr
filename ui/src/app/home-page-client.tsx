"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button, buttonVariants } from "@/components/ui/button";
import { ZapButton } from "@/components/ui/zap-button";
import { type Activity, backfillActivities } from "@/lib/activity-tracking";
import { useNostrContext } from "@/lib/nostr/NostrContext";
import {
  type Metadata,
  useContributorMetadata,
} from "@/lib/nostr/useContributorMetadata";
import useSession from "@/lib/nostr/useSession";
import { hasPrivateRepoAccess } from "@/lib/repo-permissions";
import { repoCardDescriptionText } from "@/lib/repos/repo-about-text";
import { loadStoredRepos } from "@/lib/repos/storage";
import {
  type PlatformRecentActivity,
  type PlatformRecentRepo,
  type RepoStats,
  type UserStats,
  getLatestBounties,
  getOpenBounties,
  getOwnBountyStats,
  getPlatformBountyStats,
  getRecentActivity,
  getRecentBountyActivities,
  getTopBountyTakers,
  getTopDevsByPRs,
  getUserBountyActivityStats,
} from "@/lib/stats";
import { cn } from "@/lib/utils";
import {
  getEntityDisplayName,
  getRepoOwnerPubkey,
} from "@/lib/utils/entity-resolver";
import {
  checkBridgeExists,
  getRepoStatus,
  getStatusBadgeStyle,
} from "@/lib/utils/repo-status";

import Link from "next/link";
import { nip19 } from "nostr-tools";

type Repo = {
  slug: string;
  entity?: string;
  repo?: string;
  name: string;
  sourceUrl?: string;
  createdAt: number;
  description?: string;
  entityDisplayName?: string;
  ownerPubkey?: string; // Full 64-char pubkey
  logoUrl?: string;
  files?: Array<{ type: string; path: string; size?: number }>;
  defaultBranch?: string;
  nostrEventId?: string;
  lastNostrEventId?: string;
  syncedFromNostr?: boolean;
  deleted?: boolean;
  archived?: boolean;
};

/** Clean labels from bulk GitHub→Nostr mirrors (kind 0 name often includes this suffix). */
function formatLeaderboardUserLabel(raw: string, meta?: Metadata): string {
  const identities = Array.isArray(meta?.identities) ? meta.identities : [];
  const githubHandle = identities.find(
    (i) => i?.platform === "github" && i?.identity
  )?.identity;
  if (/mirrored user from github/i.test(raw) && githubHandle) {
    return githubHandle;
  }
  return raw.replace(/\s*\(mirrored user from github\)\s*/gi, "").trim() || raw;
}

export type HomeInitialLeaderboard = {
  topRepos: RepoStats[];
  topUsers: UserStats[];
  recentRepos: PlatformRecentRepo[];
  recentActivities: PlatformRecentActivity[];
  snapshotAt: number;
} | null;

export default function HomePage({
  initialLeaderboard = null,
}: {
  initialLeaderboard?: HomeInitialLeaderboard;
}) {
  const { isLoggedIn, name, picture, banner } = useSession();
  const { pubkey } = useNostrContext();
  const [mounted, setMounted] = useState(false);

  // Prevent hydration mismatch by only showing personalized message after mount
  useEffect(() => {
    setMounted(true);
  }, []);

  const profileHref =
    mounted && pubkey && /^[0-9a-f]{64}$/i.test(pubkey)
      ? `/${nip19.npubEncode(pubkey)}`
      : null;
  const welcomeName = mounted && isLoggedIn && name ? name : null;
  const avatarSrc =
    mounted && picture && picture.trim() ? picture : "/logo.svg";
  const showBanner =
    mounted && isLoggedIn && typeof banner === "string" && banner.trim().length > 0
      ? banner.trim()
      : null;
  const [topRepos, setTopRepos] = useState<RepoStats[]>(
    () => initialLeaderboard?.topRepos ?? []
  );
  const [topDevs, setTopDevs] = useState<UserStats[]>([]);
  const [topBountyTakers, setTopBountyTakers] = useState<UserStats[]>([]);
  const [topUsers, setTopUsers] = useState<UserStats[]>(
    () => initialLeaderboard?.topUsers ?? []
  );
  const [latestBounties, setLatestBounties] = useState<any[]>([]);
  const [openBounties, setOpenBounties] = useState<any[]>([]);
  const [ownBountyStats, setOwnBountyStats] = useState<{
    totalPending: number;
    totalPaid: number;
    totalReleased: number;
    totalAmount: number;
    pendingAmount: number;
    paidAmount: number;
    releasedAmount: number;
  } | null>(null);
  const [recentBountyActivities, setRecentBountyActivities] = useState<
    Activity[]
  >([]);
  const [userBountyActivityStats, setUserBountyActivityStats] = useState<{
    bountiesSetOut: number;
    bountiesClaimed: number;
    totalSetOutAmount: number;
    totalClaimedAmount: number;
  } | null>(null);
  const [platformBountyStats, setPlatformBountyStats] = useState<{
    totalAvailable: number;
    pendingPayment: number;
    availableBounties: number;
    totalBounties: number;
    pendingCount: number;
    releasedCount: number;
    offlineCount: number;
  } | null>(null);
  const [recentActivity, setRecentActivity] = useState<Activity[]>([]);
  const [liveRecentRepos, setLiveRecentRepos] = useState<PlatformRecentRepo[]>(
    []
  );
  // If SSR already gave us a snapshot, don't show a long "Loading…" while live API catches up.
  const [liveRecentReposLoading, setLiveRecentReposLoading] = useState(
    () => !(initialLeaderboard?.recentRepos?.length)
  );
  const [platformRecentRepos, setPlatformRecentRepos] = useState<
    PlatformRecentRepo[]
  >(() => initialLeaderboard?.recentRepos ?? []);
  const [platformRecentActivities, setPlatformRecentActivities] = useState<
    PlatformRecentActivity[]
  >(() => initialLeaderboard?.recentActivities ?? []);
  const [statsLoaded, setStatsLoaded] = useState(false);
  const hasInitialLeaderboard =
    (initialLeaderboard?.topRepos.length ?? 0) > 0 ||
    (initialLeaderboard?.topUsers.length ?? 0) > 0;
  const [leaderboardReady, setLeaderboardReady] = useState(
    () => hasInitialLeaderboard
  );
  const [lbTopReposReady, setLbTopReposReady] = useState(
    () => (initialLeaderboard?.topRepos.length ?? 0) > 0
  );
  const [lbTopUsersReady, setLbTopUsersReady] = useState(
    () => (initialLeaderboard?.topUsers.length ?? 0) > 0
  );
  const [lbRecentReposReady, setLbRecentReposReady] = useState(
    () => (initialLeaderboard?.recentRepos.length ?? 0) > 0
  );
  const [lbRecentActivitiesReady, setLbRecentActivitiesReady] = useState(
    () => (initialLeaderboard?.recentActivities.length ?? 0) > 0
  );
  const leaderboardFetchGen = useRef(0);

  const applyLeaderboardPayload = useCallback(
    (data: {
      topRepos?: RepoStats[];
      topUsers?: UserStats[];
      recentRepos?: PlatformRecentRepo[];
      recentActivities?: PlatformRecentActivity[];
    }) => {
      const refreshing =
        typeof (data as { refreshing?: boolean }).refreshing === "boolean"
          ? (data as { refreshing?: boolean }).refreshing
          : false;

      if (Array.isArray(data.topRepos)) {
        const sortedRepos = [...data.topRepos].sort(
          (a, b) => (b.activityCount || 0) - (a.activityCount || 0)
        );
        setTopRepos(sortedRepos);
        if (sortedRepos.length > 0) setLbTopReposReady(true);
        if (sortedRepos.length > 0) {
          try {
            sessionStorage.setItem(
              "gittr_cached_topRepos",
              JSON.stringify(sortedRepos)
            );
          } catch {
            /* ignore */
          }
        }
      }
      let hasTopUsers = false;
      if (Array.isArray(data.topUsers)) {
        const sortedUsers = [...data.topUsers].sort(
          (a, b) => (b.activityCount || 0) - (a.activityCount || 0)
        );
        setTopUsers(sortedUsers);
        hasTopUsers = sortedUsers.length > 0;
        if (hasTopUsers) setLbTopUsersReady(true);
        if (hasTopUsers) {
          try {
            sessionStorage.setItem(
              "gittr_cached_topUsers",
              JSON.stringify(sortedUsers)
            );
          } catch {
            /* ignore */
          }
        }
      }
      if (Array.isArray(data.recentRepos)) {
        if (data.recentRepos.length > 0) {
          setPlatformRecentRepos(data.recentRepos);
          try {
            sessionStorage.setItem(
              "gittr_cached_recentRepos",
              JSON.stringify(data.recentRepos)
            );
          } catch {
            /* ignore */
          }
        }
        if (!refreshing || data.recentRepos.length > 0) {
          setLbRecentReposReady(true);
        }
      }
      if (Array.isArray(data.recentActivities)) {
        if (data.recentActivities.length > 0) {
          setPlatformRecentActivities(data.recentActivities);
          try {
            sessionStorage.setItem(
              "gittr_cached_recentActivities",
              JSON.stringify(data.recentActivities)
            );
          } catch {
            /* ignore */
          }
        }
        if (!refreshing || data.recentActivities.length > 0) {
          setLbRecentActivitiesReady(true);
        }
      }
      const hasDisplayData =
        (Array.isArray(data.topRepos) && data.topRepos.length > 0) ||
        (Array.isArray(data.topUsers) && data.topUsers.length > 0);
      // Show server snapshot immediately even while `refreshing: true` (do not wait 20s).
      if (hasDisplayData) {
        setLeaderboardReady(true);
      }
      if (!refreshing) {
        setLeaderboardReady(true);
        setLbTopReposReady(true);
        if (hasTopUsers) setLbTopUsersReady(true);
        setLbRecentReposReady(true);
        setLbRecentActivitiesReady(true);
      }
    },
    []
  );

  // Show last server snapshot instantly (same for logged-in / logged-out).
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const cachedRepos = sessionStorage.getItem("gittr_cached_topRepos");
      const cachedUsers = sessionStorage.getItem("gittr_cached_topUsers");
      const cachedRecentRepos = sessionStorage.getItem(
        "gittr_cached_recentRepos"
      );
      const cachedRecentActivities = sessionStorage.getItem(
        "gittr_cached_recentActivities"
      );
      if (cachedRepos) {
        const parsed = JSON.parse(cachedRepos) as RepoStats[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          setTopRepos(parsed);
          setLbTopReposReady(true);
        }
      }
      if (cachedUsers) {
        const parsed = JSON.parse(cachedUsers) as UserStats[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          setTopUsers(parsed);
          setLbTopUsersReady(true);
        }
      }
      if (cachedRecentRepos) {
        const parsed = JSON.parse(cachedRecentRepos) as PlatformRecentRepo[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          setPlatformRecentRepos(parsed);
          setLbRecentReposReady(true);
        }
      }
      if (cachedRecentActivities) {
        const parsed = JSON.parse(
          cachedRecentActivities
        ) as PlatformRecentActivity[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          setPlatformRecentActivities(parsed);
          setLbRecentActivitiesReady(true);
        }
      }
    } catch {
      /* ignore */
    }
  }, []);

  // Poll leaderboard until server relay refresh finishes; apply partial payloads as they arrive.
  useEffect(() => {
    const gen = ++leaderboardFetchGen.current;
    let cancelled = false;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      try {
        const res = await fetch("/api/stats/platform-leaderboard");
        if (!res.ok || cancelled || gen !== leaderboardFetchGen.current) return;
        const data = (await res.json()) as {
          topRepos?: RepoStats[];
          topUsers?: UserStats[];
          recentRepos?: PlatformRecentRepo[];
          recentActivities?: PlatformRecentActivity[];
          refreshing?: boolean;
        };
        if (cancelled || gen !== leaderboardFetchGen.current) return;
        applyLeaderboardPayload(data);
        const missingTopUsers =
          (data.topRepos?.length ?? 0) > 0 &&
          (data.topUsers?.length ?? 0) === 0;
        const hasBoth =
          (data.topRepos?.length ?? 0) > 0 && (data.topUsers?.length ?? 0) > 0;
        if ((data.refreshing || missingTopUsers) && !hasBoth) {
          pollTimer = setTimeout(poll, 2500);
        } else if (data.refreshing && hasBoth) {
          pollTimer = setTimeout(poll, 10000);
        }
      } catch (err) {
        console.warn("⚠️ [Home] Platform leaderboard fetch failed:", err);
        if (!cancelled && gen === leaderboardFetchGen.current) {
          setLeaderboardReady(true);
          setLbTopReposReady(true);
          setLbTopUsersReady(true);
          setLbRecentReposReady(true);
          setLbRecentActivitiesReady(true);
        }
      }
    };

    void poll();

    return () => {
      cancelled = true;
      if (pollTimer) clearTimeout(pollTimer);
    };
  }, [applyLeaderboardPayload]);

  // Live “Recent repositories” — not the 3h leaderboard snapshot (users check pushes here).
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const load = async () => {
      try {
        const res = await fetch("/api/stats/recent-repos", {
          signal: AbortSignal.timeout(6_000),
        });
        if (!res.ok || cancelled) {
          if (!cancelled) setLiveRecentReposLoading(false);
          return;
        }
        const data = (await res.json()) as { repos?: PlatformRecentRepo[] };
        if (Array.isArray(data.repos)) {
          setLiveRecentRepos(data.repos);
        }
      } catch (e) {
        console.warn("[Home] recent-repos fetch failed:", e);
      } finally {
        if (!cancelled) setLiveRecentReposLoading(false);
      }
    };

    void load();
    timer = setInterval(load, 45_000);

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, []);

  const bridgeCheckTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );

  // Check bridge status for repos that have event IDs but bridgeProcessed is not set
  // CRITICAL: Must respond to localStorage changes and repo creation/import events
  // so newly created/imported repos get their bridge status checked immediately
  const checkBridgeStatuses = useCallback(() => {
    if (!pubkey || !mounted) return;

    const repos = loadStoredRepos();
    const ownRepos = repos.filter((r: any) => r.ownerPubkey === pubkey);

    // Check bridge for repos that have event IDs but bridgeProcessed is not set
    ownRepos.forEach((r: any) => {
      const hasEventId = !!(
        r.nostrEventId ||
        r.lastNostrEventId ||
        r.stateEventId ||
        r.lastStateEventId
      );
      const bridgeProcessed = r.bridgeProcessed;
      const ownerPubkey = r.ownerPubkey;
      // CRITICAL: Use repositoryName from Nostr event (exact name used by git-nostr-bridge)
      // Priority: repositoryName > repo > slug
      const rAny = r;
      const repoName = rAny?.repositoryName || r.repo || r.slug;
      const entity = r.entity;

      // Only check if repo has event ID but bridgeProcessed is not explicitly true
      if (
        hasEventId &&
        bridgeProcessed !== true &&
        ownerPubkey &&
        /^[0-9a-f]{64}$/i.test(ownerPubkey) &&
        repoName &&
        entity
      ) {
        checkBridgeExists(ownerPubkey, repoName, entity)
          .then((bridgeProcessed) => {
            // After bridge check completes, reload repos to get updated bridgeProcessed flag
            // This ensures status badge updates from "Published, live soon" to "Live on Nostr"
          })
          .catch((err) => {
            console.warn(`[Home] Failed to check bridge for ${repoName}:`, err);
          });
      }
    });
  }, [pubkey, mounted]);

  useEffect(() => {
    // Initial check on mount
    checkBridgeStatuses();

    // Listen for repo updates from localStorage and repo creation/import events
    // Debounce to prevent excessive updates during sync
    const handleRepoUpdate = () => {
      if (bridgeCheckTimeoutRef.current) {
        clearTimeout(bridgeCheckTimeoutRef.current);
      }
      bridgeCheckTimeoutRef.current = setTimeout(() => {
        checkBridgeStatuses();
      }, 500); // Debounce by 500ms
    };

    window.addEventListener("storage", handleRepoUpdate);
    window.addEventListener("ngit:repo-created", handleRepoUpdate);
    window.addEventListener("ngit:repo-imported", handleRepoUpdate);

    return () => {
      if (bridgeCheckTimeoutRef.current) {
        clearTimeout(bridgeCheckTimeoutRef.current);
      }
      window.removeEventListener("storage", handleRepoUpdate);
      window.removeEventListener("ngit:repo-created", handleRepoUpdate);
      window.removeEventListener("ngit:repo-imported", handleRepoUpdate);
    };
  }, [checkBridgeStatuses]);

  // Backfill activities on first load (if not already done)
  useEffect(() => {
    try {
      // Check if activities exist - if not, force backfill even if flag is set
      const activities = JSON.parse(
        localStorage.getItem("gittr_activities") || "[]"
      );
      const backfilled = localStorage.getItem("ngit_activities_backfilled");

      // If no activities exist, force a backfill (even if flag was set before)
      if (activities.length === 0 || !backfilled) {
        console.log("Backfilling activities...");
        try {
          backfillActivities();
          localStorage.setItem("ngit_activities_backfilled", "true");
          // Trigger stats refresh after backfill completes
          setTimeout(() => {
            window.dispatchEvent(new CustomEvent("gittr:activity-recorded"));
          }, 1000);
        } catch (backfillError) {
          console.error("Error during backfill:", backfillError);
          // Don't crash - just mark as attempted
          localStorage.setItem("ngit_activities_backfilled", "true");
        }
      }
    } catch (error) {
      console.error("Error checking/backfilling activities:", error);
      // Don't crash the page
    }

    // Listen for new activities (personal stats only — not Most Active cards)
    const handleActivity = () => {
      try {
        // These are always platform-wide (not filtered by user access)
        setTopDevs(getTopDevsByPRs(10));
        setTopBountyTakers(getTopBountyTakers(10));
        setLatestBounties(getLatestBounties(5)); // Show all bounties (from all users)
        setOpenBounties(getOpenBounties(5)); // Show open/available bounties

        if (pubkey) {
          setOwnBountyStats(getOwnBountyStats(pubkey)); // Show user's own bounty stats
          setRecentBountyActivities(getRecentBountyActivities(pubkey, 5)); // Recent bounty activities
          setUserBountyActivityStats(getUserBountyActivityStats(pubkey)); // Bounty activity stats
          // Local fallback only — homepage prefers shared platformRecentActivities
          setRecentActivity(getRecentActivity(10, pubkey));
        } else {
          setRecentBountyActivities([]);
          setUserBountyActivityStats(null);
          setRecentActivity(getRecentActivity(10));
        }
        // Always load platform-wide bounty stats
        setPlatformBountyStats(getPlatformBountyStats());
      } catch (error) {
        console.error("Error loading stats:", error);
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
  }, [pubkey]); // Personal stats only; leaderboard is loadPlatformLeaderboard()

  // Prefer the shared platform feed so Firefox/Brave/etc. show the same homepage activity
  // (local gittr_activities differs per browser and used to make Recent Activity look "random").
  const displayRecentActivity = useMemo((): Activity[] => {
    if (platformRecentActivities.length > 0) {
      return platformRecentActivities.map((a) => ({
        id: a.id,
        type: a.type,
        timestamp: a.timestamp,
        user: a.user,
        entity: a.entity,
        repo: a.repo,
        repoName: a.repoName,
        metadata: a.metadata,
      }));
    }
    return recentActivity;
  }, [recentActivity, platformRecentActivities]);

  // Get metadata for user avatars (stats)
  const userPubkeys = useMemo(
    () =>
      [
        ...topDevs.map((d) => d.pubkey),
        ...topBountyTakers.map((b) => b.pubkey),
        ...topUsers.map((u) => u.pubkey),
      ].filter((p, i, arr) => arr.indexOf(p) === i),
    [topDevs, topBountyTakers, topUsers]
  );

  // Combine all pubkeys for metadata fetching
  // CRITICAL: Normalize all pubkeys to lowercase
  const allPubkeys = useMemo(() => {
    return Array.from(new Set(userPubkeys.map((p) => p.toLowerCase())));
  }, [userPubkeys]);

  const canCurrentUserSeeRepo = useCallback(
    (repoLike: any): boolean => {
      const isPrivate = repoLike?.publicRead === false;
      if (!isPrivate) return true;
      if (!pubkey) return false;

      const ownerPubkey = getRepoOwnerPubkey(repoLike, repoLike?.entity);
      return hasPrivateRepoAccess(
        pubkey,
        repoLike?.contributors || [],
        ownerPubkey,
        repoLike?.maintainers || []
      );
    },
    [pubkey]
  );

  const isValidRecentRepoCard = useCallback(
    (r: Repo) => {
      if (r.entity === "gittr.space") return false;
      if (r.entity && !r.entity.startsWith("npub")) return false;
      if (r.deleted || r.archived) return false;
      return canCurrentUserSeeRepo(r);
    },
    [canCurrentUserSeeRepo]
  );

  const mapPlatformRecentToRepo = useCallback(
    (p: PlatformRecentRepo): Repo => {
      const base: Repo = {
        slug: `${p.entity}/${p.repo}`,
        entity: p.entity,
        repo: p.repo,
        name: p.repoName,
        createdAt: p.lastActivity,
        ownerPubkey: p.ownerPubkey,
        description: p.description,
        syncedFromNostr: true,
      };
      // Merge local owner flags so HP badge matches My Repositories when possible
      try {
        if (typeof window === "undefined") return base;
        const stored = loadStoredRepos();
        const match = stored.find((r: any) => {
          const name = r.repositoryName || r.repo || r.slug || r.name;
          return (
            name === p.repo &&
            ((r.ownerPubkey &&
              p.ownerPubkey &&
              r.ownerPubkey.toLowerCase() === p.ownerPubkey.toLowerCase()) ||
              r.entity === p.entity)
          );
        });
        if (!match) return base;
        return {
          ...base,
          ...match,
          // Keep discovery identity / description from the live feed
          entity: p.entity,
          repo: p.repo,
          name: p.repoName || match.name || p.repo,
          description: p.description || match.description,
          ownerPubkey: p.ownerPubkey || match.ownerPubkey,
          syncedFromNostr: true,
          createdAt: p.lastActivity,
        };
      } catch {
        return base;
      }
    },
    []
  );

  // Same list for everyone: live API first, then SSR/leaderboard snapshot.
  // Never wait on liveRecentReposLoading to show the snapshot — that made
  // logged-out users stare at "Loading repositories..." for ~8s.
  const displayRecentRepos = useMemo(() => {
    const fromLive = liveRecentRepos
      .map(mapPlatformRecentToRepo)
      .filter(isValidRecentRepoCard);
    if (fromLive.length > 0) return fromLive.slice(0, 12);

    if (platformRecentRepos.length > 0) {
      return platformRecentRepos
        .map(mapPlatformRecentToRepo)
        .filter(isValidRecentRepoCard)
        .slice(0, 12);
    }

    return [];
  }, [
    liveRecentRepos,
    platformRecentRepos,
    mapPlatformRecentToRepo,
    isValidRecentRepoCard,
  ]);

  const recentRepoOwnerPubkeys = useMemo(() => {
    return displayRecentRepos
      .map((r) => {
        const ownerPubkey = getRepoOwnerPubkey(r as any, r.entity);
        if (ownerPubkey && /^[0-9a-f]{64}$/i.test(ownerPubkey)) {
          return ownerPubkey.toLowerCase();
        }
        return null;
      })
      .filter((p): p is string => p !== null);
  }, [displayRecentRepos]);

  const allPubkeysWithRecent = useMemo(() => {
    return Array.from(new Set([...allPubkeys, ...recentRepoOwnerPubkeys]));
  }, [allPubkeys, recentRepoOwnerPubkeys]);

  const userMetadata = useContributorMetadata(allPubkeysWithRecent);

  // CRITICAL: useContributorMetadata already loads from cache, but we need to ensure
  // it's available immediately. The hook loads from "nostr_metadata_cache" which is
  // the same cache used by useContributorMetadata, so metadata should be available.
  // However, we'll use userMetadata directly since the hook handles caching internally.

  const getDisplayName = (pubkey: string) => {
    const normalizedPubkey = pubkey.toLowerCase();
    const meta = userMetadata[normalizedPubkey] || userMetadata[pubkey];
    const raw = meta?.display_name || meta?.name;
    if (raw && raw.trim().length > 0) {
      const cleaned = formatLeaderboardUserLabel(raw, meta);
      if (cleaned) return cleaned;
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

    // Extract repo name from path (might include /issues/123 or /pulls/456).
    // Also strip mistaken "hexPubkey/repo" prefixes from broken NIP-34 d tags.
    const segments = repoPath.split("/").filter(Boolean);
    let start = 0;
    if (segments.length >= 2 && /^[0-9a-f]{64}$/i.test(segments[0] || "")) {
      start = 1;
    }
    const repoName = segments[start] || segments[0] || "";
    const subPath =
      segments.length > start + 1
        ? "/" + segments.slice(start + 1).join("/")
        : "";
    if (!repoName) return "#";

    // CRITICAL: Check if entity is a hex pubkey (64 chars) and convert to npub
    if (/^[0-9a-f]{64}$/i.test(entity)) {
      try {
        const npub = nip19.npubEncode(entity);
        return `/${npub}/${repoName}${subPath}`;
      } catch {
        // Fallback to lookup if encoding fails
      }
    }

    // Try to find the repo and get ownerPubkey
    try {
      const repos = loadStoredRepos();
      const foundRepo = repos.find((r) => {
        const rEntity = r.entity;
        const rRepo = r.repo || r.slug?.split("/")[1] || r.slug;
        return (
          (rEntity === entity ||
            (rEntity &&
              entity &&
              entity.length === 8 &&
              rEntity.toLowerCase().startsWith(entity.toLowerCase()))) &&
          (rRepo === repoName || r.slug === `${entity}/${repoName}`)
        );
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

    // Priority 2: Logo/repo image file from repo
    if (repo.files && repo.files.length > 0) {
      const repoName = (repo.repo || repo.slug || repo.name || "")
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");
      const imageExts = ["png", "jpg", "jpeg", "gif", "webp", "svg", "ico"];

      // Find all potential icon files:
      // 1. Files with "logo" in name (highest priority)
      // 2. Files named after the repo (e.g., "tides.png" for tides repo)
      // 3. Common icon names in root (repo.png, icon.png, etc.)
      const iconFiles = repo.files
        .map((f) => f.path)
        .filter((p) => {
          const fileName = p.split("/").pop() || "";
          const baseName = fileName.replace(/\.[^.]+$/, "").toLowerCase();
          const extension = fileName.split(".").pop()?.toLowerCase() || "";
          const isRoot = p.split("/").length === 1;

          if (!imageExts.includes(extension)) return false;

          // Match logo files
          if (baseName.includes("logo")) return true;

          // Match repo-name-based files (e.g., "tides.png" for tides repo)
          if (repoName && baseName === repoName) return true;

          // Match common icon names in root directory
          if (
            isRoot &&
            (baseName === "repo" ||
              baseName === "icon" ||
              baseName === "favicon")
          )
            return true;

          return false;
        });

      const logoFiles = iconFiles;

      if (logoFiles.length > 0) {
        const prioritized = logoFiles.sort((a, b) => {
          const aParts = a.split("/");
          const bParts = b.split("/");
          const aName =
            aParts[aParts.length - 1]?.replace(/\.[^.]+$/, "").toLowerCase() ||
            "";
          const bName =
            bParts[bParts.length - 1]?.replace(/\.[^.]+$/, "").toLowerCase() ||
            "";
          const aIsRoot = aParts.length === 1;
          const bIsRoot = bParts.length === 1;

          // Priority 1: Exact "logo" match
          if (aName === "logo" && bName !== "logo") return -1;
          if (bName === "logo" && aName !== "logo") return 1;

          // Priority 2: Repo-name-based files (e.g., "tides.png")
          if (
            repoName &&
            aName === repoName &&
            bName !== repoName &&
            bName !== "logo"
          )
            return -1;
          if (
            repoName &&
            bName === repoName &&
            aName !== repoName &&
            aName !== "logo"
          )
            return 1;

          // Priority 3: Root directory files
          if (aName === "logo" && bName === "logo") {
            if (aIsRoot && !bIsRoot) return -1;
            if (!aIsRoot && bIsRoot) return 1;
          }
          if (aIsRoot && !bIsRoot) return -1;
          if (!aIsRoot && bIsRoot) return 1;

          // Priority 4: Format preference
          const aExt = a.split(".").pop()?.toLowerCase() || "";
          const bExt = b.split(".").pop()?.toLowerCase() || "";
          const formatPriority = {
            png: 0,
            svg: 1,
            webp: 2,
            jpg: 3,
            jpeg: 3,
            gif: 4,
            ico: 5,
          };
          const aPrio =
            formatPriority[aExt as keyof typeof formatPriority] ?? 10;
          const bPrio =
            formatPriority[bExt as keyof typeof formatPriority] ?? 10;
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
                return `https://raw.githubusercontent.com/${owner}/${repoName}/${encodeURIComponent(
                  branch
                )}/${logoPath}`;
              }
            }
          } catch {}
        }

        // For native Nostr repos (without sourceUrl), use the API endpoint
        // CRITICAL: Construct API URL for logo files from native Nostr repos
        if (!repo.sourceUrl) {
          const ownerPubkey = repo.entity
            ? getRepoOwnerPubkey(repo as any, repo.entity)
            : null;
          const repoName = repo.repo || repo.slug || repo.name;
          if (ownerPubkey && /^[0-9a-f]{64}$/i.test(ownerPubkey) && repoName) {
            // Raw image bytes for <img>/Avatar (not JSON file-content)
            return `/api/og/repo-image?ownerPubkey=${encodeURIComponent(
              ownerPubkey
            )}&repo=${encodeURIComponent(repoName)}`;
          }
        }
      }
    }

    // Priority 3: Owner Nostr profile picture
    const ownerPubkey = repo.entity
      ? getRepoOwnerPubkey(repo as any, repo.entity)
      : null;
    if (ownerPubkey && /^[0-9a-f]{64}$/i.test(ownerPubkey)) {
      // CRITICAL: Normalize to lowercase for metadata lookup
      const normalizedPubkey = ownerPubkey.toLowerCase();
      const metadata =
        userMetadata[normalizedPubkey] || userMetadata[ownerPubkey];
      if (metadata?.picture) {
        const picture = metadata.picture;
        if (
          picture &&
          picture.trim().length > 0 &&
          picture.startsWith("http")
        ) {
          return picture;
        }
      }
    }

    return null;
  };

  return (
    <>
      {/* Kind-0 banner strip — same identity chrome as repo pages */}
      <div
        className="w-full h-[132px] bg-[var(--color-bg-secondary)] bg-cover bg-center relative"
        style={
          showBanner
            ? {
                backgroundImage: `linear-gradient(180deg, transparent 35%, var(--color-bg-primary)), url(${showBanner})`,
              }
            : {
                backgroundImage:
                  "linear-gradient(180deg, var(--color-bg-secondary), var(--color-bg-primary))",
              }
        }
        role="img"
        aria-label={
          showBanner
            ? "Your Nostr profile banner"
            : "Default gittr banner"
        }
      />

      <div className="container mx-auto max-w-[95%] xl:max-w-[90%] 2xl:max-w-[85%] px-6 pb-6 relative">
      <header className="mb-6">
        <div className="flex items-start gap-3 min-w-0">
          <div className="relative z-[2] -mt-10 h-[76px] w-[76px] flex-shrink-0 rounded-full overflow-hidden border-[3px] border-[var(--color-bg-primary)] bg-[var(--color-bg-secondary)] shadow-md">
            {profileHref ? (
              <Link href={profileHref} className="block h-full w-full">
                <img
                  src={avatarSrc}
                  alt={welcomeName || "You"}
                  className="h-full w-full object-cover"
                  onError={(e) => {
                    const target = e.currentTarget;
                    if (target.src !== "/logo.svg") target.src = "/logo.svg";
                  }}
                  referrerPolicy="no-referrer"
                  suppressHydrationWarning
                />
              </Link>
            ) : (
              <img
                src={avatarSrc}
                alt="gittr"
                className="h-full w-full object-cover"
                onError={(e) => {
                  const target = e.currentTarget;
                  if (target.src !== "/logo.svg") target.src = "/logo.svg";
                }}
                referrerPolicy="no-referrer"
                suppressHydrationWarning
              />
            )}
          </div>
          <div className="min-w-0 pt-1 flex-1">
            <h1
              className="text-2xl font-bold text-[var(--color-text-primary)]"
              suppressHydrationWarning
            >
              {welcomeName ? (
                <>
                  Welcome,{" "}
                  {profileHref ? (
                    <Link
                      href={profileHref}
                      className="text-[var(--color-accent-primary)] hover:underline"
                    >
                      {welcomeName}
                    </Link>
                  ) : (
                    welcomeName
                  )}
                </>
              ) : (
                "Welcome to gittr"
              )}
            </h1>
            <p
              className="mt-1 text-sm text-[var(--color-text-secondary)] max-w-2xl"
              suppressHydrationWarning
            >
              Import or create repos, announce them on Nostr, and discover code
              across the network.
            </p>
          </div>
        </div>
      </header>

      {/* Stats Cards */}
      {/* Top Row: Most Active Repos, Most Active Users, Open Bounties - Equal width row matching Recent repositories width */}
      <div className="mb-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Top Repos - Always show */}
        <div className="border border-[#383B42] rounded p-4 flex flex-col">
          <h3 className="font-semibold mb-3 text-purple-400">
            🔥 Most Active Repos
          </h3>
          <div className="space-y-2 flex-1">
            {topRepos.length > 0 ? (
              topRepos.slice(0, 5).map((repo, idx) => {
                // repoId is in format "entity/repo"
                const [entity, repoName] =
                  repo.repoId &&
                  typeof repo.repoId === "string" &&
                  repo.repoId.includes("/")
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
                      <span className="text-xs text-gray-500 ml-2">
                        {repo.activityCount}
                      </span>
                    </div>
                  </Link>
                );
              })
            ) : (
              <div className="text-sm text-gray-500 py-2">
                {leaderboardReady || lbTopReposReady
                  ? "No active repos yet"
                  : "Loading..."}
              </div>
            )}
          </div>
        </div>

        {/* Top Users - Always show */}
        <div className="border border-[#383B42] rounded p-4 flex flex-col">
          <h3 className="font-semibold mb-3 text-yellow-400">⭐ Most Active</h3>
          <div className="space-y-2 flex-1">
            {topUsers.length > 0 ? (
              topUsers.slice(0, 5).map((user, idx) => {
                // Convert hex pubkey to npub format for profile link
                let href = `/${user.pubkey}`;
                if (user.pubkey && /^[0-9a-f]{64}$/i.test(user.pubkey)) {
                  try {
                    const npub = nip19.npubEncode(user.pubkey);
                    href = `/${npub}`;
                  } catch (error) {
                    console.error("⚠️ [Home] Failed to encode npub for user:", {
                      pubkey: user.pubkey,
                      error,
                    });
                    // Fallback to hex pubkey if encoding fails
                    href = `/${user.pubkey}`;
                  }
                }
                return (
                  <Link
                    key={user.pubkey}
                    href={href}
                    className="block hover:bg-gray-800/50 rounded p-2 -m-2"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-yellow-300 truncate flex-1">
                        {idx + 1}. {getDisplayName(user.pubkey)}
                      </span>
                      <span className="text-xs text-gray-500 ml-2">
                        {user.activityCount}
                      </span>
                    </div>
                  </Link>
                );
              })
            ) : (
              <div className="text-sm text-gray-500 py-2">
                {leaderboardReady || lbTopUsersReady
                  ? "No active users yet"
                  : "Loading..."}
              </div>
            )}
          </div>
        </div>

        {/* Open Bounties - Always show */}
        <div className="border border-[#383B42] rounded p-4 flex flex-col">
          <h3 className="font-semibold mb-3 text-yellow-400 flex items-center justify-between">
            <span>💰 Open Bounties</span>
            <Link
              href="/bounty-hunt?status=paid"
              className="text-xs text-purple-400 hover:text-purple-300"
            >
              Hunt →
            </Link>
          </h3>
          <div className="space-y-2 flex-1">
            {openBounties.length > 0 ? (
              openBounties.slice(0, 5).map((bounty, idx) => {
                const href = getRepoUrl(
                  bounty.entity,
                  `${bounty.repoName}/issues/${bounty.issueId}`
                );
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
              <div className="text-sm text-gray-500 py-2">
                No open bounties available
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Other Stats Cards - Second Row */}
      <div className="mb-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-6 gap-4 auto-rows-fr">
        {/* Top Devs */}
        {topDevs.length > 0 && (
          <div className="border border-[#383B42] rounded p-4">
            <h3 className="font-semibold mb-3 text-green-400">
              ⚡ Active Mergers
            </h3>
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
                      <span className="text-xs text-gray-500 ml-2">
                        {dev.prMergedCount} PRs
                      </span>
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
            <h3 className="font-semibold mb-3 text-yellow-400">
              💰 Bounty Hunters
            </h3>
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
                      <span className="text-xs text-gray-500 ml-2">
                        {hunter.bountyClaimedCount}
                      </span>
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
              <Link
                href="/bounty-hunt"
                className="text-xs text-purple-400 hover:text-purple-300"
              >
                Hunt →
              </Link>
            </h3>
            <div className="space-y-2 text-sm">
              <Link
                href="/bounty-hunt?status=paid"
                className="block hover:bg-gray-800/50 rounded p-2 -m-2"
              >
                <div className="flex justify-between">
                  <span className="text-gray-400">Available:</span>
                  <span className="text-green-400 font-semibold">
                    {platformBountyStats.availableBounties} (
                    {platformBountyStats.totalAvailable.toLocaleString()} sats)
                  </span>
                </div>
              </Link>
              <Link
                href="/bounty-hunt?status=pending"
                className="block hover:bg-gray-800/50 rounded p-2 -m-2"
              >
                <div className="flex justify-between">
                  <span className="text-gray-400">Pending:</span>
                  <span className="text-yellow-400 font-semibold">
                    {platformBountyStats.pendingCount} (
                    {platformBountyStats.pendingPayment.toLocaleString()} sats)
                  </span>
                </div>
              </Link>
              <Link
                href="/bounty-hunt?status=released"
                className="block hover:bg-gray-800/50 rounded p-2 -m-2"
              >
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
        {isLoggedIn &&
          ownBountyStats &&
          (ownBountyStats.totalPending > 0 ||
            ownBountyStats.totalPaid > 0 ||
            ownBountyStats.totalReleased > 0) && (
            <div className="border border-[#383B42] rounded p-4">
              <h3 className="font-semibold mb-3 text-yellow-400">
                💰 Your Bounties
              </h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-400">Pending Payment:</span>
                  <span className="text-yellow-400 font-semibold">
                    {ownBountyStats.totalPending} (
                    {ownBountyStats.pendingAmount.toLocaleString()} sats)
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Available:</span>
                  <span className="text-green-400 font-semibold">
                    {ownBountyStats.totalPaid} (
                    {ownBountyStats.paidAmount.toLocaleString()} sats)
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Claimed:</span>
                  <span className="text-purple-400 font-semibold">
                    {ownBountyStats.totalReleased} (
                    {ownBountyStats.releasedAmount.toLocaleString()} sats)
                  </span>
                </div>
                <div className="pt-2 border-t border-[#383B42] flex justify-between">
                  <span className="text-gray-300 font-semibold">Total:</span>
                  <span className="text-yellow-300 font-bold">
                    {ownBountyStats.totalAmount.toLocaleString()} sats
                  </span>
                </div>
              </div>
              <Link
                href="/settings/bounties"
                className="block mt-3 text-xs text-purple-400 hover:text-purple-300"
              >
                Manage bounties →
              </Link>
            </div>
          )}

        {/* Latest Bounties */}
        {latestBounties.length > 0 && (
          <div className="border border-[#383B42] rounded p-4">
            <h3 className="font-semibold mb-3 text-yellow-400">
              💎 Latest Bounties
            </h3>
            <div className="space-y-2">
              {latestBounties.slice(0, 5).map((bounty, idx) => {
                const href = getRepoUrl(
                  bounty.entity,
                  `${bounty.repoName}/issues/${bounty.issueId}`
                );
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
                      <div className="text-[10px] text-gray-500 mt-1">
                        Pending payment
                      </div>
                    )}
                  </Link>
                );
              })}
            </div>
            <Link
              href="/bounty-hunt"
              className="block mt-3 text-xs text-purple-400 hover:text-purple-300"
            >
              View all bounties →
            </Link>
          </div>
        )}

        {/* Your Bounty Activities (if logged in) */}
        {isLoggedIn &&
          userBountyActivityStats &&
          (userBountyActivityStats.bountiesSetOut > 0 ||
            userBountyActivityStats.bountiesClaimed > 0 ||
            recentBountyActivities.length > 0) && (
            <div className="border border-[#383B42] rounded p-4">
              <h3 className="font-semibold mb-3 text-yellow-400">
                ⚡ Your Bounty Activity
              </h3>

              {/* Quick Stats */}
              {(userBountyActivityStats.bountiesSetOut > 0 ||
                userBountyActivityStats.bountiesClaimed > 0) && (
                <div className="mb-3 space-y-1.5 text-xs">
                  {userBountyActivityStats.bountiesSetOut > 0 && (
                    <div className="flex justify-between">
                      <span className="text-gray-400">Bounties Set Out:</span>
                      <span className="text-yellow-300 font-semibold">
                        {userBountyActivityStats.bountiesSetOut} (
                        {userBountyActivityStats.totalSetOutAmount.toLocaleString()}{" "}
                        sats)
                      </span>
                    </div>
                  )}
                  {userBountyActivityStats.bountiesClaimed > 0 && (
                    <div className="flex justify-between">
                      <span className="text-gray-400">Bounties Claimed:</span>
                      <span className="text-green-300 font-semibold">
                        {userBountyActivityStats.bountiesClaimed} (
                        {userBountyActivityStats.totalClaimedAmount.toLocaleString()}{" "}
                        sats)
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* Recent Activities */}
              {recentBountyActivities.length > 0 && (
                <>
                  <div className="text-xs text-gray-400 mb-2">
                    Recent Activity
                  </div>
                  <div className="space-y-1.5">
                    {recentBountyActivities.slice(0, 3).map((activity) => {
                      const href =
                        activity.entity && activity.repo
                          ? getRepoUrl(
                              activity.entity,
                              activity.repo.split("/").pop() || activity.repo
                            )
                          : "#";

                      // Use mounted state to prevent hydration mismatch
                      const timeAgo = mounted
                        ? Math.floor(
                            (Date.now() - activity.timestamp) / 1000 / 60
                          )
                        : 0;
                      const timeStr = !mounted
                        ? ""
                        : timeAgo < 1
                        ? "just now"
                        : timeAgo < 60
                        ? `${timeAgo}m ago`
                        : timeAgo < 1440
                        ? `${Math.floor(timeAgo / 60)}h ago`
                        : `${Math.floor(timeAgo / 1440)}d ago`;

                      const activityText =
                        activity.type === "bounty_created"
                          ? `Set bounty on ${
                              activity.repoName || activity.repo
                            }`
                          : `Claimed bounty on ${
                              activity.repoName || activity.repo
                            }`;

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
                              <div
                                className="text-[10px] text-gray-500 mt-0.5"
                                suppressHydrationWarning
                              >
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
                <Link
                  href="/bounty-hunt"
                  className="text-xs text-purple-400 hover:text-purple-300"
                >
                  Hunt bounties →
                </Link>
                {ownBountyStats &&
                  (ownBountyStats.totalPending > 0 ||
                    ownBountyStats.totalPaid > 0) && (
                    <Link
                      href="/settings/bounties"
                      className="text-xs text-purple-400 hover:text-purple-300"
                    >
                      Manage →
                    </Link>
                  )}
              </div>
            </div>
          )}

      </div>

      {/* Recent Activity - Full Width - Hidden on mobile */}
      {(statsLoaded || displayRecentActivity.length > 0) && (
        <div className="hidden md:block mb-6 border border-[#383B42] rounded p-4">
          <h3 className="font-semibold mb-4 text-purple-400">
            ⚡ Recent Activity
          </h3>
          {displayRecentActivity.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3">
              {displayRecentActivity.slice(0, 12).map((activity) => {
                const getActivityIcon = () => {
                  switch (activity.type) {
                    case "pr_merged":
                      return "🔀";
                    case "commit_created":
                      // Platform feed uses repo state events as commit_created; package reads clearer than the note.
                      return "📦";
                    case "repo_zapped":
                      return "⚡";
                    case "issue_created":
                      return "📌";
                    case "release_created":
                      return "🏷️";
                    case "repo_created":
                      return "📦";
                    case "repo_imported":
                      return "⬇️";
                    case "bounty_claimed":
                      return "💰";
                    default:
                      return "•";
                  }
                };

                const getActivityText = () => {
                  switch (activity.type) {
                    case "pr_merged":
                      return `Merged PR in ${
                        activity.repoName || activity.repo
                      }`;
                    case "commit_created":
                      return `New commit in ${
                        activity.repoName || activity.repo
                      }`;
                    case "repo_zapped":
                      return `Zapped ${activity.repoName || activity.repo}`;
                    case "issue_created":
                      return `New issue in ${
                        activity.repoName || activity.repo
                      }`;
                    case "release_created":
                      return `Release in ${activity.repoName || activity.repo}`;
                    case "repo_created":
                      return `Created ${activity.repoName || activity.repo}`;
                    case "repo_imported":
                      return `Imported ${activity.repoName || activity.repo}`;
                    case "bounty_claimed":
                      return `Bounty claimed in ${
                        activity.repoName || activity.repo
                      }`;
                    default:
                      return `${activity.type} in ${
                        activity.repoName || activity.repo
                      }`;
                  }
                };

                const href =
                  activity.entity && activity.repo
                    ? getRepoUrl(
                        activity.entity,
                        activity.repo.split("/").pop() || activity.repo
                      )
                    : "#";

                // Use mounted state to prevent hydration mismatch
                const timeAgo = mounted
                  ? Math.floor((Date.now() - activity.timestamp) / 1000 / 60)
                  : 0;
                const timeStr = !mounted
                  ? ""
                  : timeAgo < 1
                  ? "just now"
                  : timeAgo < 60
                  ? `${timeAgo}m ago`
                  : timeAgo < 1440
                  ? `${Math.floor(timeAgo / 60)}h ago`
                  : `${Math.floor(timeAgo / 1440)}d ago`;

                return (
                  <Link
                    key={activity.id}
                    href={href}
                    className="block hover:bg-gray-800/50 rounded p-3 border border-[#383B42] transition-colors"
                  >
                    <div className="flex items-start gap-2">
                      <span className="text-base flex-shrink-0">
                        {getActivityIcon()}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-gray-300 truncate">
                          {getActivityText()}
                        </div>
                        <div
                          className="text-xs text-gray-500 mt-1"
                          suppressHydrationWarning
                        >
                          {timeStr}
                        </div>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          ) : (
            <div className="text-gray-400">
              {!lbRecentActivitiesReady && platformRecentActivities.length === 0
                ? "Loading recent activity..."
                : "No recent activity yet."}
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <section className="lg:col-span-2 border border-[#383B42] rounded p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold">Recent repositories</h2>
            <Link
              href="/explore"
              className="text-sm text-purple-500 hover:underline"
            >
              See all repos
            </Link>
          </div>
          {displayRecentRepos.length === 0 ? (
            <div className="text-gray-400">
              {liveRecentReposLoading
                ? "Loading repositories..."
                : "No repositories yet. Create or import one to get started."}
            </div>
          ) : (
            <ul className="divide-y divide-[#383B42]">
              {displayRecentRepos.map((r, index) => {
                const entity = r.entity;
                // Bare repo id only — never embed hex/path from broken d tags
                const rawRepo = String(r.repo || "");
                const repo = rawRepo.includes("/")
                  ? rawRepo.split("/").filter(Boolean).pop() || rawRepo
                  : rawRepo;
                if (!entity || entity === "user") return null;

                // CRITICAL: Resolve full owner pubkey and convert to npub format
                const ownerPubkey = getRepoOwnerPubkey(r as any, entity);
                let href: string;

                // Always ensure we have a valid href - never use "#"
                if (!entity || !repo) {
                  console.error("⚠️ [Home] Missing entity or repo:", {
                    entity,
                    repo,
                    r,
                  });
                  href = `/explore`; // Fallback to explore page
                } else if (ownerPubkey && /^[0-9a-f]{64}$/i.test(ownerPubkey)) {
                  try {
                    const npub = nip19.npubEncode(ownerPubkey);
                    href = `/${npub}/${repo}`;
                  } catch (error) {
                    console.error("⚠️ [Home] Failed to encode npub:", {
                      ownerPubkey,
                      error,
                    });
                    href = `/${entity}/${repo}`;
                  }
                } else {
                  // Use entity format as fallback (route handler accepts both)
                  href = `/${entity}/${repo}`;
                }

                // Get display name from metadata
                // CRITICAL: Normalize pubkey to lowercase for metadata lookup
                const normalizedOwnerPubkey =
                  ownerPubkey && /^[0-9a-f]{64}$/i.test(ownerPubkey)
                    ? ownerPubkey.toLowerCase()
                    : null;
                // CRITICAL: Use userMetadata (which includes cache) for lookup
                const metadata = normalizedOwnerPubkey
                  ? userMetadata[normalizedOwnerPubkey] ||
                    (ownerPubkey
                      ? userMetadata[ownerPubkey.toLowerCase()]
                      : undefined)
                  : undefined;
                const displayName =
                  metadata?.name || metadata?.display_name
                    ? metadata.name || metadata.display_name
                    : normalizedOwnerPubkey
                    ? getEntityDisplayName(
                        normalizedOwnerPubkey,
                        userMetadata,
                        entity
                      )
                    : r.entityDisplayName || entity;

                // Resolve icons - always show fallback if icon fails
                let iconUrl: string | null = null;
                let ownerPicture: string | undefined = undefined;
                try {
                  iconUrl = resolveRepoIcon(r);
                  // CRITICAL: Use userMetadata for picture lookup (normalized to lowercase)
                  if (metadata?.picture) {
                    ownerPicture = metadata.picture;
                  } else if (normalizedOwnerPubkey) {
                    ownerPicture =
                      userMetadata[normalizedOwnerPubkey]?.picture ||
                      (ownerPubkey
                        ? userMetadata[ownerPubkey.toLowerCase()]?.picture
                        : undefined);
                  }
                } catch (error) {
                  console.error("⚠️ [Home] Error resolving icons:", error);
                }

                return (
                  <li key={`${entity}-${repo}`} className="py-3">
                    <Link
                      href={href}
                      className="flex items-center gap-3 sm:gap-4 hover:bg-gray-800/50 rounded p-2 -m-2 cursor-pointer"
                    >
                      {/* Icon priority: repo icon -> user icon -> platform default (all circular) */}
                      {iconUrl ? (
                        // Priority 1: Repo icon (circular like Avatar)
                        <Avatar className="h-8 w-8 sm:h-10 sm:w-10 flex-shrink-0 ring-1 ring-gray-700">
                          <AvatarImage src={iconUrl} alt="" loading="lazy" />
                          {/* Never nest a remote <img> here — dead Blossom URLs show as broken icon + alt text */}
                          <AvatarFallback className="bg-[#22262C]">
                            <img
                              src="/logo.svg"
                              alt=""
                              className="h-full w-full object-contain p-1"
                            />
                          </AvatarFallback>
                        </Avatar>
                      ) : ownerPicture ? (
                        // Priority 2: Owner profile picture (circular)
                        <Avatar className="h-8 w-8 sm:h-10 sm:w-10 flex-shrink-0 ring-1 ring-gray-700">
                          <AvatarImage src={ownerPicture} alt="" />
                          <AvatarFallback className="bg-[#22262C]">
                            <img
                              src="/logo.svg"
                              alt=""
                              className="h-full w-full object-contain p-1"
                            />
                          </AvatarFallback>
                        </Avatar>
                      ) : (
                        // Priority 3: Platform default icon (circular)
                        <Avatar className="h-8 w-8 sm:h-10 sm:w-10 flex-shrink-0 ring-1 ring-gray-700">
                          <AvatarFallback className="bg-[#22262C]">
                            <img
                              src="/logo.svg"
                              alt=""
                              className="h-full w-full object-contain p-1"
                            />
                          </AvatarFallback>
                        </Avatar>
                      )}
                      <div className="flex-1 min-w-0 min-w-[0]">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <div className="text-purple-500 hover:underline font-semibold truncate min-w-0">
                            {displayName}/{r.name || repo}
                          </div>
                          {/* Status badge */}
                          {pubkey &&
                            (r as any).ownerPubkey === pubkey &&
                            (() => {
                              const status = getRepoStatus(r);
                              const style = getStatusBadgeStyle(status);
                              return (
                                <span
                                  className={`text-xs px-2 py-0.5 rounded ${style.bg} ${style.text} flex-shrink-0`}
                                >
                                  {style.label}
                                </span>
                              );
                            })()}
                        </div>
                        {(() => {
                          const cardDesc = repoCardDescriptionText(
                            r.description,
                            r.name || repo
                          );
                          return cardDesc ? (
                            <div className="text-sm opacity-60 mt-1 truncate">
                              {cardDesc}
                            </div>
                          ) : null;
                        })()}
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
                <Button className="w-full" variant="default">
                  Create repository
                </Button>
              </Link>
              <Link href="/explore">
                <Button className="w-full" variant="outline">
                  Repos
                </Button>
              </Link>
              <a
                className={cn(
                  buttonVariants({ variant: "outline", className: "w-full" })
                )}
                href="/pages"
                rel="noopener noreferrer"
                target="_blank"
              >
                Explore pages
              </a>
              <Link href="/repositories">
                <Button className="w-full" variant="outline">
                  Your repositories
                </Button>
              </Link>
              <Link href="/settings">
                <Button className="w-full" variant="outline">
                  Settings
                </Button>
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
            amount={21}
            comment="Donation to gittr.space"
            recipientMetadata={{
              lud16: "arbadacarba@btip.nl",
              // LNURL provided as fallback for older wallets that don't support LUD-16
              lnurl:
                "LNURL1DP68GURN8GHJ7CN5D9CZUMNV9UH8WETVDSKKKMN0WAHZ7MRWW4EXCUP0X9UXGDEEXQ6XVVM9XUMXGDFCXY6NQS43TRV",
            }}
            variant="outline"
            size="sm"
            className="text-sm"
            label="Donate to this project"
          />
        </div>
      </div>
    </div>
    </>
  );
}
