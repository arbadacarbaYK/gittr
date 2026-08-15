/**
 * Shared builder for homepage platform leaderboard snapshot.
 * Used by standalone systemd job (preferred) and emergency API path.
 */

import {
  PLATFORM_STATS_RELAYS,
  withRelayPoolSubscribe,
} from "@/lib/nostr/server-relay-subscribe";
import {
  type LeaderboardSnapshot,
  hasAnyLeaderboardData,
  savePlatformLeaderboardSnapshot,
} from "@/lib/platform-leaderboard-snapshot";
import {
  getLiveRecentReposFromNostr,
  getRecentPlatformActivitiesFromNostr,
  getTopReposFromNostr,
  getTopUsersFromNostr,
} from "@/lib/stats";

export async function buildAndSavePlatformLeaderboard(): Promise<LeaderboardSnapshot> {
  const working: LeaderboardSnapshot = {
    at: 0,
    topRepos: [],
    topUsers: [],
    recentRepos: [],
    recentActivities: [],
  };

  await withRelayPoolSubscribe(PLATFORM_STATS_RELAYS, async (subscribe) => {
    working.topRepos = await getTopReposFromNostr(
      subscribe,
      PLATFORM_STATS_RELAYS,
      10
    );
    working.at = Date.now();

    working.topUsers = await getTopUsersFromNostr(
      subscribe,
      PLATFORM_STATS_RELAYS,
      10
    );
    working.at = Date.now();

    const [recentRepos, recentActivities] = await Promise.all([
      getLiveRecentReposFromNostr(subscribe, PLATFORM_STATS_RELAYS, 12),
      getRecentPlatformActivitiesFromNostr(
        subscribe,
        PLATFORM_STATS_RELAYS,
        12
      ),
    ]);
    working.recentRepos = recentRepos;
    working.recentActivities = recentActivities;
    working.at = Date.now();
  });

  if (!hasAnyLeaderboardData(working)) {
    throw new Error("leaderboard discovery returned empty snapshot");
  }
  return savePlatformLeaderboardSnapshot(working);
}
