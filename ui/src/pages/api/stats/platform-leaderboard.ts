import {
  PLATFORM_STATS_RELAYS,
} from "@/lib/nostr/server-relay-subscribe";
import {
  type LeaderboardSnapshot,
  hasAnyLeaderboardData,
  loadPlatformLeaderboardSnapshot,
} from "@/lib/platform-leaderboard-snapshot";
import { buildAndSavePlatformLeaderboard } from "@/lib/stats/build-platform-leaderboard";

import type { NextApiRequest, NextApiResponse } from "next";

/** Short in-memory mirror of the disk snapshot (no relay work). */
const MEMORY_CACHE_MS = 2 * 60 * 1000;

type LeaderboardSnapshotWritable = LeaderboardSnapshot;

let cache: LeaderboardSnapshotWritable | null = null;
let cacheLoadedAt = 0;

export type PlatformLeaderboardResponse = {
  topRepos: LeaderboardSnapshot["topRepos"];
  topUsers: LeaderboardSnapshot["topUsers"];
  recentRepos: LeaderboardSnapshot["recentRepos"];
  recentActivities: LeaderboardSnapshot["recentActivities"];
  cached: boolean;
  refreshing: boolean;
  relayCount: number;
  snapshotAt?: number;
};

function cloneSnapshot(snap: LeaderboardSnapshot): LeaderboardSnapshotWritable {
  return {
    at: snap.at,
    topRepos: [...snap.topRepos],
    topUsers: [...snap.topUsers],
    recentRepos: [...snap.recentRepos],
    recentActivities: [...snap.recentActivities],
  };
}

async function ensureCacheFromDisk(force = false): Promise<void> {
  const now = Date.now();
  if (
    !force &&
    cache &&
    hasAnyLeaderboardData(cache) &&
    now - cacheLoadedAt < MEMORY_CACHE_MS
  ) {
    return;
  }
  const disk = await loadPlatformLeaderboardSnapshot();
  if (disk && hasAnyLeaderboardData(disk)) {
    cache = cloneSnapshot(disk);
    cacheLoadedAt = now;
  }
}

/**
 * Homepage platform leaderboard.
 *
 * Normal GETs are disk/memory only. Heavy Nostr refresh is the standalone
 * `scripts/refresh-platform-leaderboard.mts` systemd job.
 * `?refresh=1` remains an emergency in-process rebuild (avoid on a sick box).
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<PlatformLeaderboardResponse | { error: string }>
) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const forceRefresh = req.query.refresh === "1";
  if (forceRefresh) {
    try {
      const snap = await buildAndSavePlatformLeaderboard();
      cache = cloneSnapshot(snap);
      cacheLoadedAt = Date.now();
    } catch (e) {
      console.error("[platform-leaderboard] emergency refresh failed", e);
      return res.status(503).json({
        error:
          e instanceof Error
            ? e.message
            : "Leaderboard refresh failed — try systemctl start gittr-leaderboard-refresh.service",
      });
    }
  } else {
    await ensureCacheFromDisk();
  }

  if (!cache || !hasAnyLeaderboardData(cache)) {
    return res.status(503).json({
      error:
        "No leaderboard snapshot yet — wait for gittr-leaderboard-refresh.timer or run the oneshot",
    });
  }

  const now = Date.now();
  const memoryFresh = cache.at > 0 && now - cacheLoadedAt < MEMORY_CACHE_MS;
  res.setHeader(
    "Cache-Control",
    "public, max-age=120, stale-while-revalidate=3600"
  );
  return res.status(200).json({
    topRepos: cache.topRepos,
    topUsers: cache.topUsers,
    recentRepos: cache.recentRepos,
    recentActivities: cache.recentActivities,
    cached: memoryFresh,
    refreshing: false,
    relayCount: PLATFORM_STATS_RELAYS.length,
    snapshotAt: cache.at > 0 ? cache.at : undefined,
  });
}
