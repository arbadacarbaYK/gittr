/**
 * Unique-repo counts for browser-cache flush.
 * Kept free of `@/` imports so vitest can cover “popup number ≠ cards”.
 */

export type FlushableRepo = {
  entity?: string;
  ownerPubkey?: string;
  repositoryName?: string;
  repo?: string;
  name?: string;
  slug?: string;
  hasUnpushedEdits?: boolean;
  status?: string;
  lastNostrEventCreatedAt?: number;
  updatedAt?: number;
  createdAt?: number;
};

export type ForeignFlushClassification<T extends FlushableRepo> = {
  unique: T[];
  keptRepos: T[];
  foreignRepos: T[];
  keptOwnRepos: number;
  keptForeignLocal: number;
  duplicateRowsCollapsed: number;
};

export type OwnFlushClassification<T extends FlushableRepo> = {
  unique: T[];
  ownRepos: T[];
  keptRepos: T[];
  duplicateRowsCollapsed: number;
};

function repoLabel(repo: FlushableRepo): string {
  const label =
    (typeof repo.repositoryName === "string" && repo.repositoryName.trim()) ||
    (typeof repo.repo === "string" && repo.repo.trim()) ||
    (typeof repo.name === "string" && repo.name.trim()) ||
    (typeof repo.slug === "string" && repo.slug.includes("/")
      ? repo.slug.slice(repo.slug.lastIndexOf("/") + 1)
      : repo.slug) ||
    "";
  return label.toLowerCase().replace(/_/g, "-");
}

function ownerKey(repo: FlushableRepo): string {
  if (repo.ownerPubkey && /^[0-9a-f]{64}$/i.test(repo.ownerPubkey)) {
    return repo.ownerPubkey.toLowerCase();
  }
  if (repo.entity && /^[0-9a-f]{64}$/i.test(repo.entity)) {
    return repo.entity.toLowerCase();
  }
  return String(repo.entity || "").toLowerCase();
}

function recency(repo: FlushableRepo): number {
  if (typeof repo.lastNostrEventCreatedAt === "number") {
    return repo.lastNostrEventCreatedAt * 1000;
  }
  return Number(repo.updatedAt || repo.createdAt || 0);
}

/** Collapse duplicate catalog rows (same owner + repo name) to one card. */
export function uniqueReposByOwnerAndName<T extends FlushableRepo>(
  repos: T[]
): T[] {
  if (!Array.isArray(repos) || repos.length < 2) return repos || [];
  const map = new Map<string, T>();
  let orphan = 0;
  for (const repo of repos) {
    const owner = ownerKey(repo);
    const label = repoLabel(repo);
    const key =
      owner && label ? `${owner}::${label}` : `__orphan__::${orphan++}`;
    const prev = map.get(key);
    if (!prev || recency(repo) >= recency(prev)) {
      map.set(key, repo);
    }
  }
  return Array.from(map.values());
}

export function repoHasLocalFlushEdits(repo: FlushableRepo): boolean {
  return repo.hasUnpushedEdits === true || repo.status === "local";
}

export function classifyForeignReposForFlush<T extends FlushableRepo>(
  repos: T[],
  isOwned: (repo: T) => boolean,
  options?: { preserveUnpushedEdits?: boolean }
): ForeignFlushClassification<T> {
  const preserveUnpushedEdits = options?.preserveUnpushedEdits ?? true;
  const unique = uniqueReposByOwnerAndName(repos);
  const keptRepos = unique.filter((repo) => {
    if (isOwned(repo)) return true;
    if (preserveUnpushedEdits && repoHasLocalFlushEdits(repo)) return true;
    return false;
  });
  const foreignRepos = unique.filter((repo) => !keptRepos.includes(repo));
  const keptOwnRepos = keptRepos.filter((repo) => isOwned(repo)).length;
  return {
    unique,
    keptRepos,
    foreignRepos,
    keptOwnRepos,
    keptForeignLocal: keptRepos.length - keptOwnRepos,
    duplicateRowsCollapsed: Math.max(0, repos.length - unique.length),
  };
}

export function classifyOwnReposForFlush<T extends FlushableRepo>(
  repos: T[],
  isOwned: (repo: T) => boolean
): OwnFlushClassification<T> {
  const unique = uniqueReposByOwnerAndName(repos);
  const ownRepos = unique.filter((repo) => isOwned(repo));
  const keptRepos = unique.filter((repo) => !isOwned(repo));
  return {
    unique,
    ownRepos,
    keptRepos,
    duplicateRowsCollapsed: Math.max(0, repos.length - unique.length),
  };
}
