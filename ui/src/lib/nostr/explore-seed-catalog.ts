/**
 * Merge the disk SEO snapshot into Explore's in-memory catalog.
 *
 * A large localStorage / session list of gittr-bridge "locals" must not skip
 * the snapshot — that list is a subset. Search only filters this catalog, so
 * missing seed rows means Nostr-wide names never match until live relays fill.
 */

export const EXPLORE_SEED_FETCH_LIMIT = 3000;
export const EXPLORE_SEED_CACHE_CAP = 3000;
/** Skip a refetch only when this many rows already came from the SEO snapshot. */
export const EXPLORE_SEED_SKIP_IF_SEO_ROWS = 2000;

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

export function seoSeedRowCount(
  rows: Array<{ fromSeoSnapshot?: boolean }>
): number {
  return rows.filter((r) => r.fromSeoSnapshot === true).length;
}

/** Locals / live relay rows do not count — only an actual SEO merge. */
export function shouldFetchExploreSeed(
  existing: Array<{ fromSeoSnapshot?: boolean }>
): boolean {
  return seoSeedRowCount(existing) < EXPLORE_SEED_SKIP_IF_SEO_ROWS;
}

export function mergeExploreSeedIntoCatalog(
  existing: ExploreCatalogSeedRow[],
  seed: ExploreSeedInput[],
  cap: number = EXPLORE_SEED_CACHE_CAP
): { list: ExploreCatalogSeedRow[]; added: number } {
  const byKey = new Map<string, ExploreCatalogSeedRow>();
  for (const r of existing) {
    const key = exploreCatalogRepoKey(r);
    if (key) byKey.set(key, r);
  }

  const rankedSeed = [...seed].sort(
    (a, b) => (b.lastActivity || 0) - (a.lastActivity || 0)
  );
  let added = 0;
  for (const s of rankedSeed) {
    const entity = String(s.entity || "").trim();
    const name = String(s.repo || s.repoName || "").trim();
    if (!entity || !name) continue;
    const key = `${entity.toLowerCase()}/${name.toLowerCase()}`;
    if (byKey.has(key)) continue;
    byKey.set(key, {
      entity,
      repo: name,
      slug: name,
      name,
      repositoryName: name,
      ownerPubkey: s.ownerPubkey,
      description: s.description || "",
      createdAt: s.lastActivity || Date.now(),
      lastNostrEventCreatedAt: s.lastActivity
        ? Math.floor(s.lastActivity / 1000)
        : undefined,
      fromSeoSnapshot: true,
      syncedFromNostr: false,
    });
    added++;
    if (byKey.size >= cap) break;
  }

  return { list: Array.from(byKey.values()), added };
}
