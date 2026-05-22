import type { NextApiRequest, NextApiResponse } from "next";

import {
  withRelayPoolSubscribe,
  PLATFORM_STATS_RELAYS,
} from "@/lib/nostr/server-relay-subscribe";
import {
  getLiveRecentReposFromNostr,
  type PlatformRecentRepo,
} from "@/lib/stats";

const CACHE_MS = 45_000;
let cache: { at: number; repos: PlatformRecentRepo[] } | null = null;
let inflight: Promise<PlatformRecentRepo[]> | null = null;

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<{ repos: PlatformRecentRepo[]; cached: boolean } | { error: string }>
) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const now = Date.now();
  if (cache && now - cache.at < CACHE_MS) {
    res.setHeader("Cache-Control", "public, max-age=30, stale-while-revalidate=60");
    return res.status(200).json({ repos: cache.repos, cached: true });
  }

  try {
    if (!inflight) {
      inflight = withRelayPoolSubscribe(PLATFORM_STATS_RELAYS, (subscribe) =>
        getLiveRecentReposFromNostr(subscribe, PLATFORM_STATS_RELAYS, 12)
      ).finally(() => {
        inflight = null;
      });
    }
    const repos = await inflight;
    cache = { at: Date.now(), repos };
    res.setHeader("Cache-Control", "public, max-age=30, stale-while-revalidate=60");
    return res.status(200).json({ repos, cached: false });
  } catch (e) {
    console.error("[recent-repos]", e);
    if (cache?.repos.length) {
      return res.status(200).json({ repos: cache.repos, cached: true });
    }
    return res.status(500).json({ error: "Failed to load recent repositories" });
  }
}
