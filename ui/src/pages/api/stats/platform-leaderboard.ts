import type { NextApiRequest, NextApiResponse } from "next";

import {
  withRelayPoolSubscribe,
  PLATFORM_STATS_RELAYS,
} from "@/lib/nostr/server-relay-subscribe";
import {
  getRecentPlatformActivitiesFromNostr,
  getRecentReposFromNostr,
  getTopReposFromNostr,
  getTopUsersFromNostr,
  type PlatformRecentActivity,
  type PlatformRecentRepo,
  type RepoStats,
  type UserStats,
} from "@/lib/stats";

const CACHE_MS = 5 * 60 * 1000;

let cache: {
  at: number;
  topRepos: RepoStats[];
  topUsers: UserStats[];
  recentRepos: PlatformRecentRepo[];
  recentActivities: PlatformRecentActivity[];
} | null = null;

let refreshInFlight: Promise<void> | null = null;

export type PlatformLeaderboardResponse = {
  topRepos: RepoStats[];
  topUsers: UserStats[];
  recentRepos: PlatformRecentRepo[];
  recentActivities: PlatformRecentActivity[];
  cached: boolean;
  /** True while a relay refresh is still running (client may poll). */
  refreshing: boolean;
  relayCount: number;
};

function emptySnapshot() {
  return {
    at: Date.now(),
    topRepos: [] as RepoStats[],
    topUsers: [] as UserStats[],
    recentRepos: [] as PlatformRecentRepo[],
    recentActivities: [] as PlatformRecentActivity[],
  };
}

/** Fills cache as each relay query completes so GET can return partial data immediately. */
async function refreshLeaderboardCache(): Promise<void> {
  const snap = emptySnapshot();
  cache = snap;

  await Promise.all([
    withRelayPoolSubscribe(PLATFORM_STATS_RELAYS, (subscribe) =>
      getTopReposFromNostr(subscribe, PLATFORM_STATS_RELAYS, 10)
    ).then((topRepos) => {
      snap.topRepos = topRepos;
      snap.at = Date.now();
    }),
    withRelayPoolSubscribe(PLATFORM_STATS_RELAYS, (subscribe) =>
      getTopUsersFromNostr(subscribe, PLATFORM_STATS_RELAYS, 10)
    ).then((topUsers) => {
      snap.topUsers = topUsers;
      snap.at = Date.now();
    }),
    withRelayPoolSubscribe(PLATFORM_STATS_RELAYS, (subscribe) =>
      getRecentReposFromNostr(subscribe, PLATFORM_STATS_RELAYS, 12)
    ).then((recentRepos) => {
      snap.recentRepos = recentRepos;
      snap.at = Date.now();
    }),
    withRelayPoolSubscribe(PLATFORM_STATS_RELAYS, (subscribe) =>
      getRecentPlatformActivitiesFromNostr(
        subscribe,
        PLATFORM_STATS_RELAYS,
        12
      )
    ).then((recentActivities) => {
      snap.recentActivities = recentActivities;
      snap.at = Date.now();
    }),
  ]);
}

function scheduleBackgroundRefresh(): void {
  if (refreshInFlight) return;
  if (cache && Date.now() - cache.at < CACHE_MS) return;
  if (!cache) cache = emptySnapshot();
  refreshInFlight = refreshLeaderboardCache()
    .catch((e) => console.error("[platform-leaderboard] background refresh", e))
    .finally(() => {
      refreshInFlight = null;
    });
}

// Warm cache when the API module loads so Home is instant after deploy/dev start.
if (!cache) {
  scheduleBackgroundRefresh();
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<PlatformLeaderboardResponse | { error: string }>
) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const forceRefresh = req.query.refresh === "1";
  const now = Date.now();
  const cacheStale = cache && now - cache.at >= CACHE_MS;

  const respond = (cached: boolean, refreshing: boolean) => {
    if (!cache) {
      return res
        .status(500)
        .json({ error: "Failed to load platform leaderboard" });
    }
    res.setHeader(
      "Cache-Control",
      cached
        ? "public, max-age=60, stale-while-revalidate=300"
        : "public, max-age=15, stale-while-revalidate=120"
    );
    return res.status(200).json({
      topRepos: cache.topRepos,
      topUsers: cache.topUsers,
      recentRepos: cache.recentRepos,
      recentActivities: cache.recentActivities,
      cached,
      refreshing,
      relayCount: PLATFORM_STATS_RELAYS.length,
    });
  };

  if (forceRefresh) {
    if (!refreshInFlight) scheduleBackgroundRefresh();
    return respond(!!cache, true);
  }

  if (!cache) {
    scheduleBackgroundRefresh();
    return respond(true, true);
  }

  if (cacheStale) scheduleBackgroundRefresh();

  return respond(true, !!refreshInFlight);
}
