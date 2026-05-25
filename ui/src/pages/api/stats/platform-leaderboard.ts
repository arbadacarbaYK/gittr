import type { NextApiRequest, NextApiResponse } from "next";
import fs from "fs/promises";
import path from "path";

import {
  withRelayPoolSubscribe,
  PLATFORM_STATS_RELAYS,
} from "@/lib/nostr/server-relay-subscribe";
import {
  hasAnyLeaderboardData,
  loadPlatformLeaderboardSnapshot,
  PLATFORM_LEADERBOARD_SNAPSHOT_PATH,
  snapshotMissingTopUsers,
  type LeaderboardSnapshot,
} from "@/lib/platform-leaderboard-snapshot";
import {
  getLiveRecentReposFromNostr,
  getRecentPlatformActivitiesFromNostr,
  getTopReposFromNostr,
  getTopUsersFromNostr,
  type PlatformRecentActivity,
  type PlatformRecentRepo,
  type RepoStats,
  type UserStats,
} from "@/lib/stats";

/** In-memory cache after a successful relay refresh (short TTL). */
const MEMORY_CACHE_MS = 2 * 60 * 1000;
/** Disk snapshot is served immediately; background refresh if older than this. */
const DISK_REFRESH_AFTER_MS = 3 * 60 * 60 * 1000;

type LeaderboardSnapshotWritable = LeaderboardSnapshot;

let cache: LeaderboardSnapshotWritable | null = null;
let refreshInFlight: Promise<void> | null = null;
let diskLoaded = false;

export type PlatformLeaderboardResponse = {
  topRepos: RepoStats[];
  topUsers: UserStats[];
  recentRepos: PlatformRecentRepo[];
  recentActivities: PlatformRecentActivity[];
  cached: boolean;
  refreshing: boolean;
  relayCount: number;
  snapshotAt?: number;
};

function emptySnapshot(): LeaderboardSnapshotWritable {
  return {
    at: 0,
    topRepos: [],
    topUsers: [],
    recentRepos: [],
    recentActivities: [],
  };
}

function cloneSnapshot(snap: LeaderboardSnapshot): LeaderboardSnapshotWritable {
  return {
    at: snap.at,
    topRepos: [...snap.topRepos],
    topUsers: [...snap.topUsers],
    recentRepos: [...snap.recentRepos],
    recentActivities: [...snap.recentActivities],
  };
}

async function persistDiskSnapshot(snap: LeaderboardSnapshot): Promise<void> {
  try {
    await fs.mkdir(path.dirname(PLATFORM_LEADERBOARD_SNAPSHOT_PATH), {
      recursive: true,
    });
    await fs.writeFile(
      PLATFORM_LEADERBOARD_SNAPSHOT_PATH,
      JSON.stringify(snap),
      "utf8"
    );
  } catch (e) {
    console.error("[platform-leaderboard] failed to write disk snapshot", e);
  }
}

async function ensureCacheFromDisk(): Promise<void> {
  if (diskLoaded) return;
  diskLoaded = true;
  const disk = await loadPlatformLeaderboardSnapshot();
  if (disk && hasAnyLeaderboardData(disk)) {
    cache = cloneSnapshot(disk);
  }
}

/**
 * Refresh relays without clearing the in-memory snapshot first.
 * Guests must keep seeing the last good disk/memory data while refresh runs.
 */
async function refreshLeaderboardCache(): Promise<void> {
  const working =
    cache && hasAnyLeaderboardData(cache)
      ? cloneSnapshot(cache)
      : emptySnapshot();

  await withRelayPoolSubscribe(PLATFORM_STATS_RELAYS, async (subscribe) => {
    working.topRepos = await getTopReposFromNostr(
      subscribe,
      PLATFORM_STATS_RELAYS,
      10
    );
    working.at = Date.now();
    cache = cloneSnapshot(working);

    working.topUsers = await getTopUsersFromNostr(
      subscribe,
      PLATFORM_STATS_RELAYS,
      10
    );
    working.at = Date.now();
    cache = cloneSnapshot(working);

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
    cache = cloneSnapshot(working);
  });

  if (hasAnyLeaderboardData(working)) {
    cache = cloneSnapshot(working);
    await persistDiskSnapshot(working);
  }
}

function scheduleBackgroundRefresh(force = false): void {
  if (refreshInFlight) return;
  const now = Date.now();
  const repairUsers = snapshotMissingTopUsers(cache);
  if (
    !force &&
    !repairUsers &&
    cache &&
    cache.at > 0 &&
    now - cache.at < DISK_REFRESH_AFTER_MS
  ) {
    return;
  }
  refreshInFlight = refreshLeaderboardCache()
    .catch((e) => console.error("[platform-leaderboard] background refresh", e))
    .finally(() => {
      refreshInFlight = null;
    });
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<PlatformLeaderboardResponse | { error: string }>
) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  await ensureCacheFromDisk();

  const forceRefresh = req.query.refresh === "1";
  const now = Date.now();
  const memoryFresh =
    cache && cache.at > 0 && now - cache.at < MEMORY_CACHE_MS;
  const diskNeedsRefresh =
    !cache || cache.at === 0 || now - cache.at >= DISK_REFRESH_AFTER_MS;

  const respond = (cached: boolean, refreshing: boolean) => {
    if (!cache) {
      return res
        .status(500)
        .json({ error: "Failed to load platform leaderboard" });
    }
    res.setHeader(
      "Cache-Control",
      "public, max-age=120, stale-while-revalidate=3600"
    );
    return res.status(200).json({
      topRepos: cache.topRepos,
      topUsers: cache.topUsers,
      recentRepos: cache.recentRepos,
      recentActivities: cache.recentActivities,
      cached,
      refreshing,
      relayCount: PLATFORM_STATS_RELAYS.length,
      snapshotAt: cache.at > 0 ? cache.at : undefined,
    });
  };

  const missingTopUsers = snapshotMissingTopUsers(cache);

  if (forceRefresh || diskNeedsRefresh || missingTopUsers) {
    scheduleBackgroundRefresh(forceRefresh || missingTopUsers);
  }

  if (!cache || !hasAnyLeaderboardData(cache)) {
    scheduleBackgroundRefresh(true);
    return respond(false, true);
  }

  if (missingTopUsers) {
    return respond(true, true);
  }

  return respond(memoryFresh || !diskNeedsRefresh, !!refreshInFlight);
}
