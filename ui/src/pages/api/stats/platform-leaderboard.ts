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
  relayCount: number;
};

async function refreshLeaderboardCache(): Promise<void> {
  const [topRepos, topUsers, recentRepos, recentActivities] =
    await Promise.all([
      withRelayPoolSubscribe(PLATFORM_STATS_RELAYS, (subscribe) =>
        getTopReposFromNostr(subscribe, PLATFORM_STATS_RELAYS, 10)
      ),
      withRelayPoolSubscribe(PLATFORM_STATS_RELAYS, (subscribe) =>
        getTopUsersFromNostr(subscribe, PLATFORM_STATS_RELAYS, 10)
      ),
      withRelayPoolSubscribe(PLATFORM_STATS_RELAYS, (subscribe) =>
        getRecentReposFromNostr(subscribe, PLATFORM_STATS_RELAYS, 12)
      ),
      withRelayPoolSubscribe(PLATFORM_STATS_RELAYS, (subscribe) =>
        getRecentPlatformActivitiesFromNostr(
          subscribe,
          PLATFORM_STATS_RELAYS,
          12
        )
      ),
    ]);
  cache = {
    at: Date.now(),
    topRepos,
    topUsers,
    recentRepos,
    recentActivities,
  };
}

function scheduleBackgroundRefresh(): void {
  if (refreshInFlight) return;
  if (cache && Date.now() - cache.at < CACHE_MS) return;
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
  const cacheIncomplete =
    cache && cache.topRepos.length > 0 && cache.topUsers.length === 0;

  // Never block on nocache — return last good snapshot immediately, refresh in background.
  if (cache && !forceRefresh && !cacheIncomplete) {
    if (cacheStale) scheduleBackgroundRefresh();
    res.setHeader(
      "Cache-Control",
      "public, max-age=60, stale-while-revalidate=300"
    );
    return res.status(200).json({
      topRepos: cache.topRepos,
      topUsers: cache.topUsers,
      recentRepos: cache.recentRepos,
      recentActivities: cache.recentActivities,
      cached: true,
      relayCount: PLATFORM_STATS_RELAYS.length,
    });
  }

  try {
    if (refreshInFlight) {
      await refreshInFlight;
    } else {
      await refreshLeaderboardCache();
    }
    if (!cache) {
      return res.status(500).json({ error: "Failed to load platform leaderboard" });
    }
    res.setHeader("Cache-Control", "public, max-age=300");
    return res.status(200).json({
      topRepos: cache.topRepos,
      topUsers: cache.topUsers,
      recentRepos: cache.recentRepos,
      recentActivities: cache.recentActivities,
      cached: false,
      relayCount: PLATFORM_STATS_RELAYS.length,
    });
  } catch (e) {
    console.error("[platform-leaderboard]", e);
    if (cache) {
      scheduleBackgroundRefresh();
      return res.status(200).json({
        topRepos: cache.topRepos,
        topUsers: cache.topUsers,
        recentRepos: cache.recentRepos,
        recentActivities: cache.recentActivities,
        cached: true,
        relayCount: PLATFORM_STATS_RELAYS.length,
      });
    }
    return res.status(500).json({ error: "Failed to load platform leaderboard" });
  }
}
