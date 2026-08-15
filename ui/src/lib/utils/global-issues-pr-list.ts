/**
 * Shared prefs + grouping for global /issues and /pulls aggregate lists.
 * Replaces decorative Visibility / Organization / Sort stubs with real controls.
 */

export type AggregateListSource = "all" | "originals" | "forks";
export type AggregateListGroup = "flat" | "repo";
export type AggregateListSort = "newest" | "oldest" | "updated";

export type AggregateListPrefs = {
  source: AggregateListSource;
  group: AggregateListGroup;
  sort: AggregateListSort;
};

const DEFAULT_PREFS: AggregateListPrefs = {
  source: "all",
  group: "repo",
  sort: "updated",
};

function storageKey(kind: "issues" | "pulls", suffix: string): string {
  return `gittr_${kind}_list_${suffix}`;
}

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore quota */
  }
}

export function loadAggregateListPrefs(
  kind: "issues" | "pulls"
): AggregateListPrefs {
  const source = readJson<AggregateListSource>(
    storageKey(kind, "source"),
    DEFAULT_PREFS.source
  );
  const group = readJson<AggregateListGroup>(
    storageKey(kind, "group"),
    DEFAULT_PREFS.group
  );
  const sort = readJson<AggregateListSort>(
    storageKey(kind, "sort"),
    DEFAULT_PREFS.sort
  );
  return {
    source:
      source === "originals" || source === "forks" || source === "all"
        ? source
        : DEFAULT_PREFS.source,
    group: group === "flat" || group === "repo" ? group : DEFAULT_PREFS.group,
    sort:
      sort === "newest" || sort === "oldest" || sort === "updated"
        ? sort
        : DEFAULT_PREFS.sort,
  };
}

export function saveAggregateListPrefs(
  kind: "issues" | "pulls",
  prefs: Partial<AggregateListPrefs>
): void {
  if (prefs.source) writeJson(storageKey(kind, "source"), prefs.source);
  if (prefs.group) writeJson(storageKey(kind, "group"), prefs.group);
  if (prefs.sort) writeJson(storageKey(kind, "sort"), prefs.sort);
}

export function loadCollapsedRepoKeys(kind: "issues" | "pulls"): Set<string> {
  const arr = readJson<string[]>(storageKey(kind, "collapsed"), []);
  return new Set(Array.isArray(arr) ? arr.map((k) => k.toLowerCase()) : []);
}

export function saveCollapsedRepoKeys(
  kind: "issues" | "pulls",
  keys: Set<string>
): void {
  writeJson(storageKey(kind, "collapsed"), Array.from(keys));
}

export function repoKeyForAggregateItem(item: {
  entity?: string;
  repo?: string;
}): string {
  return `${item.entity || ""}/${item.repo || ""}`.toLowerCase();
}

/** True when the stored repo is a fork/import (has forkedFrom). */
export function repoIsFork(repo: { forkedFrom?: unknown } | null | undefined): boolean {
  if (!repo) return false;
  const f = repo.forkedFrom;
  if (typeof f === "string") return f.trim().length > 0;
  return Boolean(f);
}

export function filterByAggregateSource<
  T extends { isFork?: boolean }
>(items: T[], source: AggregateListSource): T[] {
  if (source === "originals") return items.filter((i) => !i.isFork);
  if (source === "forks") return items.filter((i) => !!i.isFork);
  return items;
}

export type AggregateRepoGroup<T> = {
  key: string;
  entity: string;
  repo: string;
  items: T[];
};

export function groupAggregateItemsByRepo<
  T extends { entity?: string; repo?: string }
>(items: T[]): AggregateRepoGroup<T>[] {
  const map = new Map<string, AggregateRepoGroup<T>>();
  for (const item of items) {
    const entity = item.entity || "";
    const repo = item.repo || "";
    const key = `${entity}/${repo}`.toLowerCase();
    let g = map.get(key);
    if (!g) {
      g = { key, entity, repo, items: [] };
      map.set(key, g);
    }
    g.items.push(item);
  }
  return Array.from(map.values()).sort((a, b) => {
    const an = `${a.entity}/${a.repo}`.toLowerCase();
    const bn = `${b.entity}/${b.repo}`.toLowerCase();
    return an.localeCompare(bn);
  });
}

export function sourceMenuLabel(source: AggregateListSource): string {
  if (source === "originals") return "Hide forks";
  if (source === "forks") return "Forks only";
  return "Source";
}

export function groupMenuLabel(group: AggregateListGroup): string {
  return group === "repo" ? "By repo" : "Flat";
}

export function sortMenuLabel(sort: AggregateListSort): string {
  if (sort === "oldest") return "Oldest";
  if (sort === "updated") return "Updated";
  return "Newest";
}
