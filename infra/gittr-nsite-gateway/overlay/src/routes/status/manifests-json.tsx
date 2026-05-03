import type { Context } from "@hono/hono";
import { naddrEncode, npubEncode } from "applesauce-core/helpers";
import { formatAgeFromUnix } from "../../helpers/format.ts";
import { formatNsiteSubdomain } from "../../helpers/nsite-host.ts";
import { NAMED_SITE_MANIFEST_KIND } from "../../helpers/site-manifest.ts";
import { buildIndexedSites } from "../../helpers/site-index.ts";
import type { StatusSite } from "../../pages/status.tsx";
import { getHitCount } from "../../services/analytics.ts";
import { eventStore, getUserProfile } from "../../services/nostr.ts";

function getStatusSites(host: string, protocol: string): StatusSite[] {
  const manifests = buildIndexedSites(eventStore.getTimeline({}));
  const sites: StatusSite[] = [];

  for (const site of manifests) {
    const subdomain = formatNsiteSubdomain(site.pubkey, site.identifier);
    const siteHostname = subdomain ? `${subdomain}.${host}` : undefined;
    sites.push({
      key: site.key,
      pubkey: site.pubkey,
      identifier: site.identifier,
      title: site.title,
      description: site.description,
      pathCount: site.pathCount,
      manifestId: site.manifestId,
      createdAt: site.createdAt,
      hostname: siteHostname,
      href: siteHostname ? `${protocol}//${siteHostname}/` : undefined,
      npub: npubEncode(site.pubkey),
      snapshotCount: site.snapshots.length,
      latestSnapshotId: site.snapshots[0]?.id,
      latestSnapshotCreatedAt: site.snapshots[0]?.createdAt,
    });
  }

  return sites.sort((a, b) => {
    if (b.createdAt !== a.createdAt) return b.createdAt - a.createdAt;
    return a.key.localeCompare(b.key);
  });
}

function toHttps(url: string): string {
  if (url.startsWith("http://")) {
    return `https://${url.slice("http://".length)}`;
  }
  return url;
}

export async function statusManifestsJsonRoute(c: Context) {
  const url = new URL(c.req.url);
  const base = `${url.protocol}//${url.host}`.replace(/\/$/, "");
  const sites = getStatusSites(url.host, url.protocol);

  const uniquePubkeys = [...new Set(sites.map((s) => s.pubkey))];
  const profileResults = await Promise.all(
    uniquePubkeys.map(
      async (pubkey) =>
        [pubkey, await getUserProfile(pubkey, 5_000)] as const
    )
  );
  const profiles = new Map(profileResults);

  const hitResults = await Promise.all(
    sites.map(
      async (site) =>
        [site.key, await getHitCount(site.pubkey, site.identifier)] as const
    )
  );
  const hits = new Map(hitResults);

  for (const site of sites) {
    const profile = profiles.get(site.pubkey);
    if (profile) {
      site.authorName = profile.display_name || profile.name;
    }
    site.hits = hits.get(site.key) ?? 0;
  }

  const now = Date.now();
  const rows = sites
    .filter((site) => site.href)
    .map((site) => {
      const namedId = site.identifier?.trim();
      const statusAddress = namedId
        ? naddrEncode({
            pubkey: site.pubkey,
            identifier: namedId,
            kind: NAMED_SITE_MANIFEST_KIND,
          })
        : site.npub;
      const pathsStatusUrl = `${base}/status/${statusAddress}`;
      const ts = site.latestSnapshotCreatedAt ?? site.createdAt;
      return {
        title:
          site.title?.trim() ||
          namedId ||
          `${site.npub.slice(0, 12)}…${site.npub.slice(-6)}`,
        description: site.description,
        siteUrl: toHttps(site.href!),
        authorDisplay: (site.authorName || site.npub).trim(),
        authorPubkeyHex: site.pubkey,
        pathCount: site.pathCount,
        pathsStatusUrl,
        snapshots: site.snapshotCount,
        hits: site.hits ?? 0,
        updatedLabel: formatAgeFromUnix(ts, now),
        updatedIso: new Date(ts * 1000).toISOString().replace(".000Z", "Z"),
      };
    });

  return c.json(
    {
      generatedAt: new Date().toISOString().replace(".000Z", "Z"),
      siteCount: rows.length,
      sites: rows,
    },
    200,
    {
      "Cache-Control": "public, max-age=120",
    }
  );
}
