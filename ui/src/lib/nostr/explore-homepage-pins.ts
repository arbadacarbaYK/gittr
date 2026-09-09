/**
 * Explore’s first cards must match Home “Recent repositories” order
 * (live 30617 via /api/stats/recent-repos). Catalog timestamps are a
 * 3000-row cache and cannot be the ranking for those names.
 */

export type ExploreHomepagePin = {
  entity: string;
  repo: string;
  ownerPubkey?: string;
};

function pinRepoName(row: {
  repo?: string;
  slug?: string;
  name?: string;
}): string {
  return String(row.repo || row.slug || row.name || "")
    .trim()
    .toLowerCase();
}

/** -1 = not in the homepage list. Else 0 = first recent card. */
export function homepageRecentPinRank(
  row: {
    entity?: string;
    repo?: string;
    slug?: string;
    name?: string;
    ownerPubkey?: string;
  },
  pins: ExploreHomepagePin[]
): number {
  if (!pins.length) return -1;
  const repo = pinRepoName(row);
  if (!repo) return -1;
  const entity = String(row.entity || "")
    .trim()
    .toLowerCase();
  const pk = String(row.ownerPubkey || "")
    .trim()
    .toLowerCase();
  return pins.findIndex((p) => {
    if (
      String(p.repo || "")
        .trim()
        .toLowerCase() !== repo
    )
      return false;
    const pPk = String(p.ownerPubkey || "")
      .trim()
      .toLowerCase();
    if (pk && pPk && pk === pPk) return true;
    return entity.length > 0 && entity === String(p.entity || "").toLowerCase();
  });
}

export function compareExploreReposWithHomepagePins<
  T extends {
    entity?: string;
    repo?: string;
    slug?: string;
    name?: string;
    ownerPubkey?: string;
  }
>(
  a: T,
  b: T,
  pins: ExploreHomepagePin[],
  timeDesc: (x: T, y: T) => number
): number {
  const ia = homepageRecentPinRank(a, pins);
  const ib = homepageRecentPinRank(b, pins);
  const aPinned = ia >= 0;
  const bPinned = ib >= 0;
  if (aPinned && bPinned) return ia - ib;
  if (aPinned !== bPinned) return aPinned ? -1 : 1;
  return timeDesc(a, b);
}
