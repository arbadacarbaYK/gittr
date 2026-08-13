import { loadNostrSeoReposSnapshot } from "@/lib/seo/nostr-seo-repos-snapshot";

import type { NextApiRequest, NextApiResponse } from "next";
import { nip19 } from "nostr-tools";

export type ExploreSeedRepo = {
  entity: string;
  repo: string;
  repoName: string;
  ownerPubkey: string;
  lastActivity: number;
  /** Thin seed from SEO sitemap snapshot — Nostr sync may enrich later. */
  fromSeoSnapshot?: boolean;
};

type OkBody = {
  ok: true;
  repos: ExploreSeedRepo[];
  snapshotAt?: number;
  pathCount: number;
};

type ErrBody = { ok: false; error: string };

/**
 * Cold-start list for /explore when browser localStorage is empty.
 * Reads the daily SEO Nostr snapshot (same file as sitemap) — no live relay
 * round-trip. Does not run ?refresh=1 discovery.
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
    const snap = await loadNostrSeoReposSnapshot();
    if (!snap?.paths) {
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

    const entries = Object.entries(snap.paths)
      .sort((a, b) => (b[1] || 0) - (a[1] || 0))
      .slice(0, limit);

    const repos: ExploreSeedRepo[] = [];
    for (const [pathKey, lastActivity] of entries) {
      const slash = pathKey.indexOf("/");
      if (slash <= 0) continue;
      const entity = pathKey.slice(0, slash).trim();
      const repo = pathKey.slice(slash + 1).trim();
      if (!entity.startsWith("npub1") || !repo) continue;
      let ownerPubkey = "";
      try {
        const decoded = nip19.decode(entity);
        if (decoded.type === "npub" && typeof decoded.data === "string") {
          ownerPubkey = decoded.data.toLowerCase();
        }
      } catch {
        continue;
      }
      if (!/^[0-9a-f]{64}$/.test(ownerPubkey)) continue;
      repos.push({
        entity,
        repo,
        repoName: repo,
        ownerPubkey,
        lastActivity: typeof lastActivity === "number" ? lastActivity : 0,
        fromSeoSnapshot: true,
      });
    }

    res.setHeader(
      "Cache-Control",
      "public, max-age=60, stale-while-revalidate=300"
    );
    return res.status(200).json({
      ok: true,
      repos,
      snapshotAt: snap.at,
      pathCount: Object.keys(snap.paths).length,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[explore/seed]", e);
    return res.status(500).json({ ok: false, error: msg });
  }
}
