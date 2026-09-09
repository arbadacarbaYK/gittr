import { filterRepoPathLinesByPublisherBlocklist } from "@/lib/moderation/publisher-blocklist";
import {
  type ExploreSeedRepo,
  buildExploreSeedRepos,
  mergeExploreSeedPaths,
} from "@/lib/seo/explore-seed-repos";
import { loadNostrPushedRepoPaths } from "@/lib/seo/nostr-pushed-repos";
import {
  loadNostrSeoReposSnapshot,
  snapshotIsStale,
} from "@/lib/seo/nostr-seo-repos-snapshot";

import type { NextApiRequest, NextApiResponse } from "next";

export type { ExploreSeedRepo };

type OkBody = {
  ok: true;
  repos: ExploreSeedRepo[];
  snapshotAt?: number;
  pathCount: number;
  stale?: boolean;
};

type ErrBody = { ok: false; error: string };

/**
 * Cold-start list for /explore.
 * Reads the daily SEO Nostr snapshot (same file as sitemap) plus optional
 * `nostr-pushed-repos.txt`. A snapshot older than 14 days is still served —
 * throwing it away left Explore on localStorage-only until live relays filled.
 * No live relay round-trip. Does not run ?refresh=1 discovery.
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<OkBody | ErrBody>
) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const snap = await loadNostrSeoReposSnapshot({ allowStale: true });
    const extraPaths = filterRepoPathLinesByPublisherBlocklist(
      loadNostrPushedRepoPaths()
    );
    const now = Date.now();
    const pathToActivity = mergeExploreSeedPaths(
      snap?.paths || {},
      extraPaths,
      now
    );

    if (pathToActivity.size === 0) {
      res.setHeader(
        "Cache-Control",
        "public, max-age=30, stale-while-revalidate=60"
      );
      return res.status(200).json({ ok: true, repos: [], pathCount: 0 });
    }

    const limitRaw = Number(req.query.limit);
    const limit =
      Number.isFinite(limitRaw) && limitRaw > 0
        ? Math.min(Math.floor(limitRaw), 5000)
        : 3000;

    const repos = buildExploreSeedRepos(pathToActivity, limit);

    res.setHeader(
      "Cache-Control",
      "public, max-age=60, stale-while-revalidate=300"
    );
    return res.status(200).json({
      ok: true,
      repos,
      snapshotAt: snap?.at,
      pathCount: pathToActivity.size,
      stale: snap ? snapshotIsStale(snap.at, now) : undefined,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[explore/seed]", e);
    return res.status(500).json({ ok: false, error: msg });
  }
}
