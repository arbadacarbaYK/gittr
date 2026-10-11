import { isPublisherBlocklisted } from "@/lib/moderation/publisher-blocklist";
import { loadPlatformLeaderboardSnapshot } from "@/lib/platform-leaderboard-snapshot";
import { siteOriginFallback } from "@/lib/repos/enrich-repo-links";
import { loadLauncherApps } from "@/lib/widgets/launcher-apps";
import { loadLauncherEnrichCache } from "@/lib/widgets/launcher-enrich-cache";
import { buildLauncherWidgetFeed } from "@/lib/widgets/launcher-feed";
import { resolveDisplayNames } from "@/lib/widgets/launcher-names";

import type { NextApiRequest, NextApiResponse } from "next";

/**
 * Home-screen feed for the Omalauncher tiles.
 * Disk and a short name cache only. Relay and GitHub work happens in the
 * leaderboard refresh job, which writes the enrich file.
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const [leaderboard, apps, enrich] = await Promise.all([
      loadPlatformLeaderboardSnapshot(),
      loadLauncherApps(),
      loadLauncherEnrichCache(),
    ]);
    const pubkeys = [
      ...(leaderboard?.topRepos || []).map((repo) => repo.entity),
      ...(leaderboard?.topUsers || []).map((user) => user.pubkey),
    ];
    const names = await resolveDisplayNames(pubkeys);
    const body = buildLauncherWidgetFeed({
      origin: siteOriginFallback(),
      at: leaderboard?.at || enrich?.at || 0,
      topRepos: leaderboard?.topRepos,
      topUsers: leaderboard?.topUsers,
      recentRepos: leaderboard?.recentRepos,
      apps,
      names,
      repoFacts: enrich?.repos,
      appFacts: enrich?.apps,
      isBlocked: isPublisherBlocklisted,
    });
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader(
      "Cache-Control",
      "public, s-maxage=120, stale-while-revalidate=600"
    );
    return res.status(200).json(body);
  } catch (error) {
    console.error("[widgets/launcher]", error);
    return res.status(500).json({ error: "Widget feed failed" });
  }
}
