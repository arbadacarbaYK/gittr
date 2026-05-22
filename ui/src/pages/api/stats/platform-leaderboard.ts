import type { NextApiRequest, NextApiResponse } from "next";
import fs from "fs/promises";
import path from "path";

import {
  withRelayPoolSubscribe,
  PLATFORM_STATS_RELAYS,
} from "@/lib/nostr/server-relay-subscribe";
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
/** Still return disk data up to this age (stale-while-revalidate). */
const DISK_SERVE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const SNAPSHOT_PATH = path.join(
  process.cwd(),
  "data",
  "platform-leaderboard-snapshot.json"
);

type LeaderboardSnapshot = {
  at: number;
  topRepos: RepoStats[];
  topUsers: UserStats[];
  recentRepos: PlatformRecentRepo[];
  recentActivities: PlatformRecentActivity[];
};

let cache: LeaderboardSnapshot | null = null;
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

function emptySnapshot(): LeaderboardSnapshot {
  return {
    at: 0,
    topRepos: [],
    topUsers: [],
    recentRepos: [],
    recentActivities: [],
  };
}

function hasAnyLeaderboardData(snap: LeaderboardSnapshot): boolean {
  return (
    snap.topRepos.length > 0 ||
    snap.topUsers.length > 0 ||
    snap.recentRepos.length > 0 ||
    snap.recentActivities.length > 0
  );
}

async function loadDiskSnapshot(): Promise<LeaderboardSnapshot | null> {
  try {
    const raw = await fs.readFile(SNAPSHOT_PATH, "utf8");
    const parsed = JSON.parse(raw) as LeaderboardSnapshot;
    if (!parsed || typeof parsed.at !== "number") return null;
    if (Date.now() - parsed.at > DISK_SERVE_MAX_AGE_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function persistDiskSnapshot(snap: LeaderboardSnapshot): Promise<void> {
  try {
    await fs.mkdir(path.dirname(SNAPSHOT_PATH), { recursive: true });
    await fs.writeFile(SNAPSHOT_PATH, JSON.stringify(snap), "utf8");
  } catch (e) {
    console.error("[platform-leaderboard] failed to write disk snapshot", e);
  }
}

async function ensureCacheFromDisk(): Promise<void> {
  if (diskLoaded) return;
  diskLoaded = true;
  const disk = await loadDiskSnapshot();
  if (disk && hasAnyLeaderboardData(disk)) {
    cache = disk;
  }
}

/** Fills cache as each relay query completes so GET can return partial data immediately. */
async function refreshLeaderboardCache(): Promise<void> {
  const snap = emptySnapshot();
  cache = snap;

  await withRelayPoolSubscribe(PLATFORM_STATS_RELAYS, async (subscribe) => {
    await Promise.all([
      getTopReposFromNostr(subscribe, PLATFORM_STATS_RELAYS, 10).then(
        (topRepos) => {
          snap.topRepos = topRepos;
          snap.at = Date.now();
        }
      ),
      getTopUsersFromNostr(subscribe, PLATFORM_STATS_RELAYS, 10).then(
        (topUsers) => {
          snap.topUsers = topUsers;
          snap.at = Date.now();
        }
      ),
      getLiveRecentReposFromNostr(subscribe, PLATFORM_STATS_RELAYS, 12).then(
        (recentRepos) => {
          snap.recentRepos = recentRepos;
          snap.at = Date.now();
        }
      ),
      getRecentPlatformActivitiesFromNostr(
        subscribe,
        PLATFORM_STATS_RELAYS,
        12
      ).then((recentActivities) => {
        snap.recentActivities = recentActivities;
        snap.at = Date.now();
      }),
    ]);
  });

  if (hasAnyLeaderboardData(snap)) {
    await persistDiskSnapshot(snap);
  }
}

function scheduleBackgroundRefresh(): void {
  if (refreshInFlight) return;
  const now = Date.now();
  if (cache && cache.at > 0 && now - cache.at < DISK_REFRESH_AFTER_MS) {
    return;
  }
  if (!cache) cache = emptySnapshot();
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

  if (forceRefresh || diskNeedsRefresh) {
    scheduleBackgroundRefresh();
  }

  if (!cache || !hasAnyLeaderboardData(cache)) {
    scheduleBackgroundRefresh();
    return respond(false, true);
  }

  return respond(memoryFresh || !diskNeedsRefresh, !!refreshInFlight);
}
