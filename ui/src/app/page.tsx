import HomePageClient from "./home-page-client";
import {
  hasAnyLeaderboardData,
  loadPlatformLeaderboardSnapshot,
} from "@/lib/platform-leaderboard-snapshot";

/**
 * Segment config must live in a Server Component. A `"use client"` page ignores
 * `dynamic` / `revalidate`, which left `/` statically prerendered with long
 * `s-maxage` — social crawlers often saw stale HTML and missing/wrong cards.
 */
export const dynamic = "force-dynamic";

export default async function Page() {
  const snapshot = await loadPlatformLeaderboardSnapshot();
  const initialLeaderboard =
    snapshot && hasAnyLeaderboardData(snapshot)
      ? {
          topRepos: snapshot.topRepos,
          topUsers: snapshot.topUsers,
          recentRepos: snapshot.recentRepos,
          recentActivities: snapshot.recentActivities,
          snapshotAt: snapshot.at,
        }
      : null;

  return <HomePageClient initialLeaderboard={initialLeaderboard} />;
}
