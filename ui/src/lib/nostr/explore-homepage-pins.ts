/**
 * Explore’s first cards must match Home “Recent repositories” order
 * (live 30617 via /api/stats/recent-repos). Catalog timestamps are a
 * 3000-row cache and cannot be the ranking for those names.
 */

export type ExploreHomepagePin = {
  entity: string;
  repo: string;
  ownerPubkey?: string;
  lastActivity?: number;
  description?: string;
};

export const EXPLORE_HOMEPAGE_PINS_STORAGE_KEY = "gittr_explore_homepage_pins";

const MAX_HOMEPAGE_PINS = 12;

function pinRepoName(row: {
  repo?: string;
  slug?: string;
  name?: string;
}): string {
  return String(row.repo || row.slug || row.name || "")
    .trim()
    .toLowerCase();
}

function normalizePin(raw: unknown): ExploreHomepagePin | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const entity = String(row.entity || "").trim();
  const repo = String(row.repo || row.repoName || "").trim();
  if (!entity || !repo) return null;
  const ownerPubkey = String(row.ownerPubkey || "").trim();
  const lastActivity = Number(row.lastActivity);
  const description = String(row.description || "").trim();
  return {
    entity,
    repo,
    ...(ownerPubkey ? { ownerPubkey } : {}),
    ...(Number.isFinite(lastActivity) && lastActivity > 0
      ? { lastActivity }
      : {}),
    ...(description ? { description } : {}),
  };
}

export function sanitizeHomepagePins(raw: unknown): ExploreHomepagePin[] {
  if (!Array.isArray(raw)) return [];
  const out: ExploreHomepagePin[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const pin = normalizePin(item);
    if (!pin) continue;
    const key = `${pin.ownerPubkey || pin.entity}/${pin.repo}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(pin);
    if (out.length >= MAX_HOMEPAGE_PINS) break;
  }
  return out;
}

/** Last Home list so Explore’s first paint is not the poisoned cache sort. */
export function readStoredHomepagePins(): ExploreHomepagePin[] {
  if (typeof window === "undefined") return [];
  try {
    const raw =
      window.sessionStorage.getItem(EXPLORE_HOMEPAGE_PINS_STORAGE_KEY) ||
      window.localStorage.getItem(EXPLORE_HOMEPAGE_PINS_STORAGE_KEY);
    return sanitizeHomepagePins(JSON.parse(raw || "[]"));
  } catch {
    return [];
  }
}

export function writeStoredHomepagePins(pins: ExploreHomepagePin[]): void {
  if (typeof window === "undefined") return;
  const clean = sanitizeHomepagePins(pins);
  const json = JSON.stringify(clean);
  try {
    window.sessionStorage.setItem(EXPLORE_HOMEPAGE_PINS_STORAGE_KEY, json);
  } catch {
    /* quota */
  }
  try {
    window.localStorage.setItem(EXPLORE_HOMEPAGE_PINS_STORAGE_KEY, json);
  } catch {
    /* quota */
  }
}

export function homepagePinToCatalogSeed(pin: ExploreHomepagePin): {
  entity: string;
  repo: string;
  repoName: string;
  ownerPubkey: string;
  lastActivity?: number;
  description?: string;
} {
  return {
    entity: pin.entity,
    repo: pin.repo,
    repoName: pin.repo,
    ownerPubkey: pin.ownerPubkey || "",
    lastActivity: pin.lastActivity,
    description: pin.description,
  };
}

/** Card row when Home listed a repo Explore’s 3000-row cache does not have. */
export function homepagePinToExploreRow(pin: ExploreHomepagePin): {
  entity: string;
  repo: string;
  slug: string;
  name: string;
  ownerPubkey?: string;
  description?: string;
  createdAt?: number;
  lastNostrEventCreatedAt?: number;
  syncedFromNostr: boolean;
} {
  const activity = pin.lastActivity || 0;
  const sec =
    activity > 1e12 ? Math.floor(activity / 1000) : activity > 0 ? activity : 0;
  return {
    entity: pin.entity,
    repo: pin.repo,
    slug: pin.repo,
    name: pin.repo,
    ownerPubkey: pin.ownerPubkey,
    description: pin.description,
    createdAt:
      activity > 0 ? (activity > 1e12 ? activity : activity * 1000) : undefined,
    lastNostrEventCreatedAt: sec > 0 ? sec : undefined,
    syncedFromNostr: true,
  };
}

/**
 * Put Home’s 12 first, in Home order. Missing catalog rows become stubs so a
 * brand-new announce still appears on Explore.
 */
export function applyHomepagePinsToFront<
  T extends {
    entity?: string;
    repo?: string;
    slug?: string;
    name?: string;
    ownerPubkey?: string;
  }
>(repos: T[], pins: ExploreHomepagePin[]): T[] {
  if (!pins.length) return repos;
  const used = new Set<T>();
  const front: T[] = [];
  for (const pin of pins) {
    const found = repos.find(
      (row) => homepageRecentPinRank(row, [pin]) === 0 && !used.has(row)
    );
    if (found) {
      front.push(found);
      used.add(found);
    } else {
      front.push(homepagePinToExploreRow(pin) as unknown as T);
    }
  }
  const rest = repos.filter((row) => homepageRecentPinRank(row, pins) < 0);
  return [...front, ...rest];
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
