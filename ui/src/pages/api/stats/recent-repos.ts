import {
  PROFILE_REPOS_RELAYS,
  withRelayPoolSubscribe,
} from "@/lib/nostr/server-relay-subscribe";
import {
  type PlatformRecentRepo,
  getLiveRecentReposFromNostr,
} from "@/lib/stats";

import type { NextApiRequest, NextApiResponse } from "next";

const CACHE_MS = 45_000;
let cache: { at: number; repos: PlatformRecentRepo[] } | null = null;
let inflight: Promise<PlatformRecentRepo[]> | null = null;

function sendRepos(
  res: NextApiResponse<
    { repos: PlatformRecentRepo[]; cached: boolean } | { error: string }
  >,
  repos: PlatformRecentRepo[],
  cached: boolean
) {
  // The browser must not keep this JSON. The 45s copy lives in this process
  // only, and a stale copy is returned immediately while a refresh runs.
  res.setHeader("Cache-Control", "private, no-store");
  return res.status(200).json({ repos, cached });
}

function refreshRecentRepos(): Promise<PlatformRecentRepo[]> {
  if (inflight) return inflight;
  inflight = withRelayPoolSubscribe(PROFILE_REPOS_RELAYS, (subscribe) =>
    getLiveRecentReposFromNostr(subscribe, PROFILE_REPOS_RELAYS, 12)
  )
    .then((repos) => {
      if (repos.length > 0) cache = { at: Date.now(), repos };
      return repos;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<
    { repos: PlatformRecentRepo[]; cached: boolean } | { error: string }
  >
) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const now = Date.now();
  if (cache?.repos.length) {
    if (now - cache.at >= CACHE_MS) void refreshRecentRepos();
    return sendRepos(res, cache.repos, true);
  }

  try {
    const repos = await refreshRecentRepos();
    return sendRepos(res, repos, false);
  } catch (e) {
    console.error("[recent-repos]", e);
    if (cache?.repos.length) return sendRepos(res, cache.repos, true);
    return res
      .status(500)
      .json({ error: "Failed to load recent repositories" });
  }
}
