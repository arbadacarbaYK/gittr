import { isPublisherBlocklisted } from "@/lib/moderation/publisher-blocklist";
import { loadPlatformLeaderboardSnapshot } from "@/lib/platform-leaderboard-snapshot";
import { loadLauncherApps } from "@/lib/widgets/launcher-apps";
import { buildLauncherWidgetFeed } from "@/lib/widgets/launcher-feed";
import { fetchWidgetHops } from "@/lib/widgets/widget-wot";

import type { NextApiRequest, NextApiResponse } from "next";

/**
 * Trust marks for one saved npub. Empty when the key is missing or the
 * oracle cannot answer. Never reports "outside" as a badge.
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const from = typeof req.query.from === "string" ? req.query.from.trim() : "";
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "private, no-store");
  if (!from) return res.status(200).json({ hops: {} });

  try {
    const [leaderboard, apps] = await Promise.all([
      loadPlatformLeaderboardSnapshot(),
      loadLauncherApps(),
    ]);
    const feed = buildLauncherWidgetFeed({
      origin: "https://gittr.space",
      topRepos: leaderboard?.topRepos,
      topUsers: leaderboard?.topUsers,
      recentRepos: leaderboard?.recentRepos,
      apps,
      isBlocked: isPublisherBlocklisted,
    });
    const set = req.query.set === "apps" ? "apps" : "git";
    const targets =
      set === "apps"
        ? feed.apps.map((row) => row.pubkey)
        : [
            ...feed.repos.map((row) => row.pubkey),
            ...feed.people.map((row) => row.pubkey),
          ];
    const hops = await fetchWidgetHops(from, targets);
    return res.status(200).json({ hops });
  } catch (error) {
    console.error("[widgets/wot]", error);
    return res.status(200).json({ hops: {} });
  }
}
