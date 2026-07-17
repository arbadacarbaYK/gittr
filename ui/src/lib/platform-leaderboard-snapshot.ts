import type {
  PlatformRecentActivity,
  PlatformRecentRepo,
  RepoStats,
  UserStats,
} from "@/lib/stats";

import path from "path";

import fs from "fs/promises";

export const PLATFORM_LEADERBOARD_SNAPSHOT_PATH = path.join(
  process.cwd(),
  "data",
  "platform-leaderboard-snapshot.json"
);

/** Disk snapshot is served up to this age (stale-while-revalidate). */
export const DISK_SERVE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type LeaderboardSnapshot = {
  at: number;
  topRepos: RepoStats[];
  topUsers: UserStats[];
  recentRepos: PlatformRecentRepo[];
  recentActivities: PlatformRecentActivity[];
};

export function hasAnyLeaderboardData(snap: LeaderboardSnapshot): boolean {
  return (
    snap.topRepos.length > 0 ||
    snap.topUsers.length > 0 ||
    snap.recentRepos.length > 0 ||
    snap.recentActivities.length > 0
  );
}

export function snapshotMissingTopUsers(
  snap: LeaderboardSnapshot | null
): boolean {
  return !!snap && snap.topRepos.length > 0 && snap.topUsers.length === 0;
}

export async function loadPlatformLeaderboardSnapshot(): Promise<LeaderboardSnapshot | null> {
  try {
    const raw = await fs.readFile(PLATFORM_LEADERBOARD_SNAPSHOT_PATH, "utf8");
    const parsed = JSON.parse(raw) as LeaderboardSnapshot;
    if (!parsed || typeof parsed.at !== "number") return null;
    if (Date.now() - parsed.at > DISK_SERVE_MAX_AGE_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}
