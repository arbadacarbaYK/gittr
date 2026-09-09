import { isRenderableRepoName } from "../repos/renderable-repo-name";

import { nostrTimestampToMs } from "./nostr-created-at";

/**
 * Merge the disk SEO snapshot into Explore's in-memory catalog.
 *
 * A large localStorage / session list of gittr-bridge "locals" must not skip
 * the snapshot — that list is a subset. Search only filters this catalog, so
 * missing seed rows means Nostr-wide names never match until live relays fill.
 *
 * Re-merge on every Explore visit: a catalog that already has thousands of
 * `fromSeoSnapshot` rows can still be poisoned (fake "now" timestamps, hex
 * d-tags, names deleted from the SEO file). Skipping that refetch left the
 * page showing junk until the user cleared cache.
 */

export const EXPLORE_SEED_FETCH_LIMIT = 3000;
export const EXPLORE_SEED_CACHE_CAP = 3000;

export type ExploreCatalogSeedRow = {
  entity?: string;
  repo?: string;
  slug?: string;
  name?: string;
  repositoryName?: string;
  ownerPubkey?: string;
  description?: string;
  createdAt?: number;
  lastNostrEventCreatedAt?: number;
  fromSeoSnapshot?: boolean;
  syncedFromNostr?: boolean;
  [key: string]: unknown;
};

export type ExploreSeedInput = {
  entity: string;
  repo: string;
  repoName?: string;
  ownerPubkey: string;
  lastActivity?: number;
  description?: string;
};

export function exploreCatalogRepoKey(row: {
  entity?: string;
  repo?: string;
  slug?: string;
  repositoryName?: string;
  name?: string;
}): string | null {
  const entity = String(row.entity || "").toLowerCase();
  const name = String(
    row.repo || row.slug || row.repositoryName || row.name || ""
  ).toLowerCase();
  if (!entity || !name) return null;
  return `${entity}/${name}`;
}

function catalogRepoName(row: ExploreCatalogSeedRow): string {
  return String(
    row.repo || row.slug || row.repositoryName || row.name || ""
  ).trim();
}

function activityToMs(lastActivity: number): number {
  if (!Number.isFinite(lastActivity) || lastActivity <= 0) return 0;
  return lastActivity;
}

function activityToNostrSeconds(lastActivity: number): number | undefined {
  if (!Number.isFinite(lastActivity) || lastActivity <= 0) return undefined;
  return Math.floor(lastActivity > 1e12 ? lastActivity / 1000 : lastActivity);
}

function rowRankMs(row: ExploreCatalogSeedRow): number {
  const fromNostr = nostrTimestampToMs(row.lastNostrEventCreatedAt as number);
  if (fromNostr > 0) return fromNostr;
  return nostrTimestampToMs(row.createdAt as number) || 0;
}

function evictOneForSeed(
  byKey: Map<string, ExploreCatalogSeedRow>,
  protect: Set<string>
): boolean {
  let worstKey: string | null = null;
  let worst = Infinity;
  for (const [key, row] of byKey) {
    if (protect.has(key)) continue;
    if (row.syncedFromNostr) continue;
    if (!row.fromSeoSnapshot) continue;
    const rank = rowRankMs(row);
    if (rank <= worst) {
      worst = rank;
      worstKey = key;
    }
  }
  if (!worstKey) {
    for (const [key, row] of byKey) {
      if (protect.has(key)) continue;
      if (row.syncedFromNostr) continue;
      const rank = rowRankMs(row);
      if (rank <= worst) {
        worst = rank;
        worstKey = key;
      }
    }
  }
  if (!worstKey) return false;
  byKey.delete(worstKey);
  return true;
}

function seedRowFromInput(s: ExploreSeedInput): ExploreCatalogSeedRow {
  const entity = String(s.entity || "").trim();
  const name = String(s.repo || s.repoName || "").trim();
  const activity = activityToMs(s.lastActivity || 0);
  return {
    entity,
    repo: name,
    slug: name,
    name,
    repositoryName: name,
    ownerPubkey: s.ownerPubkey,
    description: s.description || "",
    createdAt: activity || undefined,
    lastNostrEventCreatedAt: activityToNostrSeconds(activity),
    fromSeoSnapshot: true,
    syncedFromNostr: false,
  };
}

export function seoSeedRowCount(
  rows: Array<{ fromSeoSnapshot?: boolean }>
): number {
  return rows.filter((r) => r.fromSeoSnapshot === true).length;
}

/**
 * Always refetch. Locals-only lists need the snapshot; a large already-seeded
 * catalog still needs a reconcile against the current SEO file.
 */
export function shouldFetchExploreSeed(
  _existing?: Array<{ fromSeoSnapshot?: boolean }>
): boolean {
  return true;
}

export function mergeExploreSeedIntoCatalog(
  existing: ExploreCatalogSeedRow[],
  seed: ExploreSeedInput[],
  cap: number = EXPLORE_SEED_CACHE_CAP
): {
  list: ExploreCatalogSeedRow[];
  added: number;
  updated: number;
  removed: number;
} {
  const byKey = new Map<string, ExploreCatalogSeedRow>();
  for (const r of existing) {
    const name = catalogRepoName(r);
    if (!isRenderableRepoName(name)) continue;
    const key = exploreCatalogRepoKey({ ...r, repo: name });
    if (key) byKey.set(key, r);
  }

  const rankedSeed = [...seed].sort(
    (a, b) => (b.lastActivity || 0) - (a.lastActivity || 0)
  );
  const seedKeys = new Set<string>();
  for (const s of rankedSeed) {
    const entity = String(s.entity || "").trim();
    const name = String(s.repo || s.repoName || "").trim();
    if (!entity || !name || !isRenderableRepoName(name)) continue;
    seedKeys.add(`${entity.toLowerCase()}/${name.toLowerCase()}`);
  }

  let added = 0;
  let updated = 0;
  let removed = 0;
  for (const [key, row] of [...byKey.entries()]) {
    if (seedKeys.has(key)) continue;
    if (row.syncedFromNostr) continue;
    if (!row.fromSeoSnapshot) continue;
    byKey.delete(key);
    removed++;
  }

  for (const s of rankedSeed) {
    const entity = String(s.entity || "").trim();
    const name = String(s.repo || s.repoName || "").trim();
    if (!entity || !name) continue;
    if (!isRenderableRepoName(name)) continue;
    const key = `${entity.toLowerCase()}/${name.toLowerCase()}`;
    const prev = byKey.get(key);
    if (!prev) {
      while (byKey.size >= cap && evictOneForSeed(byKey, seedKeys)) {
        removed += 1;
      }
      if (byKey.size >= cap) continue;
      byKey.set(key, seedRowFromInput(s));
      added++;
      continue;
    }

    const next = { ...prev };
    if (!next.description && s.description) next.description = s.description;
    if (!next.ownerPubkey && s.ownerPubkey) next.ownerPubkey = s.ownerPubkey;

    const activity = activityToMs(s.lastActivity || 0);
    if (activity > 0) {
      const nextSec = activityToNostrSeconds(activity);
      if (
        prev.createdAt !== activity ||
        prev.lastNostrEventCreatedAt !== nextSec
      ) {
        next.createdAt = activity;
        next.lastNostrEventCreatedAt = nextSec;
        updated++;
      }
    }
    byKey.set(key, next);
  }

  let list = Array.from(byKey.values());
  if (list.length > cap) {
    list = list
      .slice()
      .sort((a, b) => rowRankMs(b) - rowRankMs(a))
      .slice(0, cap);
  }

  return { list, added, updated, removed };
}
