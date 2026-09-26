/**
 * Pure helpers for shrinking gittr_repos when the browser quota is full.
 * No app imports — vitest in this repo does not resolve the `@/` alias.
 */

export type QuotaKeepRepo = {
  hasUnpushedEdits?: boolean;
  status?: string;
  ownerPubkey?: string;
  lastNostrEventCreatedAt?: number;
  updatedAt?: number;
  createdAt?: number;
};

export const QUOTA_KEEP_CAPS = [800, 400, 200, 100, 40];

export function isQuotaProtectedRepo(
  repo: QuotaKeepRepo,
  preferOwnerPubkey?: string
): boolean {
  if (repo.hasUnpushedEdits || repo.status === "local") return true;
  const prefer = preferOwnerPubkey?.toLowerCase();
  const owner = repo.ownerPubkey?.toLowerCase();
  return !!(prefer && owner && owner === prefer);
}

function rankScore(repo: QuotaKeepRepo, preferOwnerPubkey?: string): number {
  const prefer = preferOwnerPubkey?.toLowerCase();
  const owner = String(repo.ownerPubkey || "").toLowerCase();
  const ownedBoost = prefer && owner && owner === prefer ? 1e16 : 0;
  return (
    ownedBoost +
    (repo.hasUnpushedEdits || repo.status === "local" ? 1e15 : 0) +
    (repo.lastNostrEventCreatedAt
      ? repo.lastNostrEventCreatedAt * 1000
      : repo.updatedAt || repo.createdAt || 0)
  );
}

/** Protected rows always stay. The rest fill up to `cap`, newest first. */
export function quotaKeepList<T extends QuotaKeepRepo>(
  rows: T[],
  cap: number,
  preferOwnerPubkey?: string
): T[] {
  const ranked = [...rows].sort(
    (a, b) => rankScore(b, preferOwnerPubkey) - rankScore(a, preferOwnerPubkey)
  );
  const protectedRows: T[] = [];
  const flexible: T[] = [];
  for (const repo of ranked) {
    if (isQuotaProtectedRepo(repo, preferOwnerPubkey)) protectedRows.push(repo);
    else flexible.push(repo);
  }
  const room = Math.max(0, cap - protectedRows.length);
  return [...protectedRows, ...flexible.slice(0, room)];
}

type QuotaStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

/**
 * Replace a key. If the browser counts the old value and the new value
 * together, drop the old value first so a smaller payload can land.
 */
export function setItemReplacingQuota(
  storage: QuotaStorage,
  key: string,
  value: string
): boolean {
  try {
    storage.setItem(key, value);
    return true;
  } catch {
    /* try again without the previous blob */
  }
  let previous: string | null = null;
  try {
    previous = storage.getItem(key);
  } catch {
    previous = null;
  }
  try {
    storage.removeItem(key);
  } catch {
    /* ignore */
  }
  try {
    storage.setItem(key, value);
    return true;
  } catch {
    if (previous != null) {
      try {
        storage.setItem(key, previous);
      } catch {
        /* previous blob no longer fits */
      }
    }
    return false;
  }
}
