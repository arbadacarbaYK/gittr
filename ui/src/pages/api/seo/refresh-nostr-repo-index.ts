import {
  loadNostrSeoReposSnapshot,
  saveNostrSeoReposSnapshot,
} from "@/lib/seo/nostr-seo-repos-snapshot";
import {
  fetchAndBuildSeoRepoIndex,
  getSeoDiscoveryRelayUrls,
} from "@/lib/seo/nostr-sitemap-repos";

import type { NextApiRequest, NextApiResponse } from "next";

export const config = {
  maxDuration: 300,
};

type OkBody = {
  ok: true;
  refreshed: boolean;
  pathCount: number;
  snapshotAt?: number;
  relayCount: number;
  durationMs?: number;
};

type ErrBody = { ok: false; error: string };

/**
 * SEO repo index for `/sitemap.xml`.
 *
 * - GET — status of on-disk snapshot (`ui/data/nostr-seo-repos-snapshot.json`)
 * - GET ?refresh=1 — re-query Nostr (default + GRASP relays), rewrite snapshot
 *   (deletions / private / blocklist applied). Intended for daily systemd timer.
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<OkBody | ErrBody>
) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const relayCount = getSeoDiscoveryRelayUrls().length;
  const forceRefresh = req.query.refresh === "1";

  if (!forceRefresh) {
    const snap = await loadNostrSeoReposSnapshot();
    return res.status(200).json({
      ok: true,
      refreshed: false,
      pathCount: snap ? Object.keys(snap.paths).length : 0,
      snapshotAt: snap?.at,
      relayCount,
    });
  }

  const started = Date.now();
  try {
    const paths = await fetchAndBuildSeoRepoIndex();
    if (paths.size === 0) {
      return res.status(503).json({
        ok: false,
        error:
          "Nostr discovery returned 0 paths — leaving previous snapshot untouched",
      });
    }
    const snap = await saveNostrSeoReposSnapshot(paths);
    return res.status(200).json({
      ok: true,
      refreshed: true,
      pathCount: Object.keys(snap.paths).length,
      snapshotAt: snap.at,
      relayCount,
      durationMs: Date.now() - started,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[seo/refresh-nostr-repo-index]", e);
    return res.status(500).json({ ok: false, error: msg });
  }
}
