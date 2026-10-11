import { PLATFORM_STATS_RELAYS } from "@/lib/nostr/server-relay-subscribe";
import {
  type LeaderboardSnapshot,
  PLATFORM_LEADERBOARD_SNAPSHOT_PATH,
  hasAnyLeaderboardData,
  loadPlatformLeaderboardSnapshot,
} from "@/lib/platform-leaderboard-snapshot";
import { buildAndSavePlatformLeaderboard } from "@/lib/stats/build-platform-leaderboard";

import type { NextApiRequest, NextApiResponse } from "next";

import fs from "fs/promises";

/** Short in-memory mirror of the disk snapshot (no relay work). */
const MEMORY_CACHE_MS = 2 * 60 * 1000;

type LeaderboardSnapshotWritable = LeaderboardSnapshot;

let cache: LeaderboardSnapshotWritable | null = null;
let cacheLoadedAt = 0;
let cacheMtimeMs = 0;

export type PlatformLeaderboardResponse = {
  topRepos: LeaderboardSnapshot["topRepos"];
  topUsers: LeaderboardSnapshot["topUsers"];
  recentRepos: LeaderboardSnapshot["recentRepos"];
  recentActivities: LeaderboardSnapshot["recentActivities"];
  cached: boolean;
  refreshing: boolean;
  relayCount: number;
  snapshotAt?: number;
  windowDays?: number;
};

function cloneSnapshot(snap: LeaderboardSnapshot): LeaderboardSnapshotWritable {
  return {
    at: snap.at,
    topRepos: [...snap.topRepos],
    topUsers: [...snap.topUsers],
    recentRepos: [...snap.recentRepos],
    recentActivities: [...snap.recentActivities],
    windowDays: snap.windowDays,
  };
}

async function ensureCacheFromDisk(force = false): Promise<void> {
  const now = Date.now();
  let mtimeMs = 0;
  try {
    const st = await fs.stat(PLATFORM_LEADERBOARD_SNAPSHOT_PATH);
    mtimeMs = st.mtimeMs;
  } catch {
    mtimeMs = 0;
  }
  if (
    !force &&
    cache &&
    hasAnyLeaderboardData(cache) &&
    mtimeMs === cacheMtimeMs &&
    now - cacheLoadedAt < MEMORY_CACHE_MS
  ) {
    return;
  }
  const disk = await loadPlatformLeaderboardSnapshot();
  if (disk && hasAnyLeaderboardData(disk)) {
    cache = cloneSnapshot(disk);
    cacheLoadedAt = now;
    cacheMtimeMs = mtimeMs;
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
      try {
        const st = await fs.stat(PLATFORM_LEADERBOARD_SNAPSHOT_PATH);
        cacheMtimeMs = st.mtimeMs;
      } catch {
        cacheMtimeMs = 0;
      }
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
    windowDays: cache.windowDays,
  });
}
