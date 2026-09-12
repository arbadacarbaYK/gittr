/**
 * Homepage “Recent Activity” is the public Nostr/network feed — same idea as
 * Recent repositories. Do not paint this browser’s gittr_activities here.
 *
 * Lanes: live 30617 repos, NIP-82 apps, gittr Pages, plus leaderboard
 * issues/PRs/commits when the snapshot has them.
 */
import type { Activity, ActivityType } from "@/lib/activity-tracking";
import type { GatewayStatusSiteRow } from "@/lib/gittr-pages/parse-gateway-status-html";

import { nip19 } from "nostr-tools";

import type { PlatformRecentRepo } from "./live-recent-repos";

function hexToNpub(pubkey: string): string {
  const hex = (pubkey || "").trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hex)) return pubkey;
  try {
    return nip19.npubEncode(hex);
  } catch {
    return hex.slice(0, 8);
  }
}

export type HomepageActivityRow = {
  id: string;
  type: ActivityType;
  timestamp: number;
  user: string;
  entity: string;
  repo: string;
  repoName: string;
  metadata?: Activity["metadata"];
};

export type HomepageActivityApp = {
  pubkey: string;
  appId: string;
  name: string;
  createdAt: number;
  gittrRepoPath?: string;
};

export function pageUpdatedMs(site: {
  updatedIso?: string;
  updatedLabel?: string;
}): number {
  const iso = (site.updatedIso || "").trim();
  if (iso) {
    const t = Date.parse(iso);
    if (Number.isFinite(t)) return t;
  }
  return 0;
}

export function activitiesFromRecentRepos(
  repos: PlatformRecentRepo[] | null | undefined
): HomepageActivityRow[] {
  const out: HomepageActivityRow[] = [];
  for (const r of repos || []) {
    const repo = (r.repo || r.repoName || "").trim();
    const entity = (r.entity || "").trim();
    const ts = Number(r.lastActivity) || 0;
    if (!repo || !entity || ts <= 0) continue;
    const user = (r.ownerPubkey || "").toLowerCase();
    out.push({
      id: `repo:${user || entity}:${repo.toLowerCase()}`,
      type: "repo_created",
      timestamp: ts,
      user,
      entity,
      repo,
      repoName: (r.repoName || repo).trim(),
    });
  }
  return out;
}

export function activitiesFromSoftwareApps(
  apps: HomepageActivityApp[] | null | undefined
): HomepageActivityRow[] {
  const out: HomepageActivityRow[] = [];
  for (const app of apps || []) {
    const name = (app.name || "").trim();
    const pubkey = (app.pubkey || "").toLowerCase();
    const createdSec = Number(app.createdAt) || 0;
    if (!name || !pubkey || createdSec <= 0) continue;
    const entity = hexToNpub(pubkey);
    const href =
      typeof app.gittrRepoPath === "string" && app.gittrRepoPath.startsWith("/")
        ? app.gittrRepoPath
        : "/apps";
    out.push({
      id: `app:${pubkey}:${(app.appId || name).toLowerCase()}`,
      type: "app_published",
      timestamp: createdSec * 1000,
      user: pubkey,
      entity,
      repo: app.appId || name,
      repoName: name,
      metadata: { href },
    });
  }
  return out;
}

export function activitiesFromPagesSites(
  sites: GatewayStatusSiteRow[] | null | undefined
): HomepageActivityRow[] {
  const out: HomepageActivityRow[] = [];
  for (const site of sites || []) {
    const ts = pageUpdatedMs(site);
    const url = (site.siteUrl || "").trim();
    const title = (site.title || "").trim() || url;
    if (!url || ts <= 0) continue;
    const user = (site.authorPubkeyHex || "").toLowerCase();
    const entity = user ? hexToNpub(user) : "pages";
    out.push({
      id: `page:${url.toLowerCase()}`,
      type: "page_published",
      timestamp: ts,
      user,
      entity,
      repo: url,
      repoName: title,
      metadata: { href: url },
    });
  }
  return out;
}

function lane(type: ActivityType | string): "repo" | "app" | "page" {
  if (type === "app_published") return "app";
  if (type === "page_published") return "page";
  return "repo";
}

/**
 * Newest public activity. Caps so a 30617 flood cannot hide apps/pages.
 */
export function mergeHomepageRecentActivity(input: {
  leaderboard?: HomepageActivityRow[] | null;
  recentRepos?: PlatformRecentRepo[] | null;
  apps?: HomepageActivityApp[] | null;
  pages?: GatewayStatusSiteRow[] | null;
  count?: number;
}): HomepageActivityRow[] {
  const count = input.count ?? 12;
  const byId = new Map<string, HomepageActivityRow>();
  const push = (row: HomepageActivityRow) => {
    if (!row?.id || byId.has(row.id)) return;
    byId.set(row.id, row);
  };
  for (const row of input.leaderboard || []) push(row);
  for (const row of activitiesFromRecentRepos(input.recentRepos)) push(row);
  for (const row of activitiesFromSoftwareApps(input.apps)) push(row);
  for (const row of activitiesFromPagesSites(input.pages)) push(row);

  const sorted = Array.from(byId.values()).sort(
    (a, b) => b.timestamp - a.timestamp
  );
  const caps = { repo: 8, app: 3, page: 3 };
  const used = { repo: 0, app: 0, page: 0 };
  const picked: HomepageActivityRow[] = [];
  const leftover: HomepageActivityRow[] = [];

  for (const row of sorted) {
    const k = lane(row.type);
    if (picked.length >= count) break;
    if (used[k] < caps[k]) {
      picked.push(row);
      used[k] += 1;
    } else {
      leftover.push(row);
    }
  }
  for (const row of leftover) {
    if (picked.length >= count) break;
    picked.push(row);
  }
  return picked.sort((a, b) => b.timestamp - a.timestamp);
}

export function platformActivityToFeedItem(a: HomepageActivityRow): Activity {
  return {
    id: a.id,
    type: a.type,
    timestamp: a.timestamp,
    user: a.user,
    entity: a.entity,
    repo: a.repo,
    repoName: a.repoName,
    metadata: a.metadata,
  };
}
