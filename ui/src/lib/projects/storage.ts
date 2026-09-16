import { nip19 } from "nostr-tools";

export type StoredProject = {
  id: string;
  name: string;
  description?: string;
  status: "active" | "completed" | "archived";
  items: unknown[];
  createdAt: number;
  view: "kanban" | "roadmap";
  source?: "github" | "local";
  githubProjectId?: string;
};

function normalizeEntityForProjectKey(entity: string): string {
  if (!entity) return "";
  if (entity.startsWith("npub")) return entity;
  if (/^[0-9a-f]{64}$/i.test(entity)) {
    try {
      return nip19.npubEncode(entity.toLowerCase());
    } catch {
      return entity.toLowerCase();
    }
  }
  return entity;
}

export function isGithubProject(p: { source?: string; id?: string }): boolean {
  return p.source === "github" || Boolean(p.id?.startsWith("gh-project-"));
}

export function canonicalProjectsStorageKey(
  entity: string,
  repo: string
): string {
  return `gittr_projects__${normalizeEntityForProjectKey(entity)}__${repo}`;
}

export function collectProjectStorageKeys(
  entity: string,
  repo: string
): string[] {
  const seen = new Set<string>();
  const add = (k: string) => {
    if (k) seen.add(k);
  };
  add(canonicalProjectsStorageKey(entity, repo));
  add(`gittr_projects_${entity}_${repo}`);
  add(`gittr_projects__${entity}__${repo}`);
  if (/^[0-9a-f]{64}$/i.test(entity)) {
    const hex = entity.toLowerCase();
    add(`gittr_projects_${hex}_${repo}`);
    add(`gittr_projects__${hex}__${repo}`);
    try {
      const npub = nip19.npubEncode(hex);
      add(`gittr_projects_${npub}_${repo}`);
      add(`gittr_projects__${npub}__${repo}`);
    } catch {
      /* ignore */
    }
  }
  if (entity.startsWith("npub")) {
    try {
      const decoded = nip19.decode(entity);
      if (decoded.type === "npub" && typeof decoded.data === "string") {
        const hex = decoded.data.toLowerCase();
        add(`gittr_projects_${hex}_${repo}`);
        add(`gittr_projects__${hex}__${repo}`);
      }
    } catch {
      /* ignore */
    }
  }
  return [...seen];
}

function parseProjectArray(raw: string | null): StoredProject[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as StoredProject[]) : [];
  } catch {
    return [];
  }
}

function mergeProjectsById(rows: StoredProject[]): StoredProject[] {
  const byId = new Map<string, StoredProject>();
  for (const row of rows) {
    if (!row?.id) continue;
    const prev = byId.get(row.id);
    if (!prev) {
      byId.set(row.id, row);
      continue;
    }
    const richer =
      (row.items?.length || 0) >= (prev.items?.length || 0) ? row : prev;
    byId.set(row.id, richer);
  }
  return [...byId.values()];
}

export function loadProjects(entity: string, repo: string): StoredProject[] {
  if (typeof window === "undefined") return [];
  try {
    const merged: StoredProject[] = [];
    for (const key of collectProjectStorageKeys(entity, repo)) {
      merged.push(...parseProjectArray(localStorage.getItem(key)));
    }
    return mergeProjectsById(merged);
  } catch {
    return [];
  }
}

export function persistProjects(
  entity: string,
  repo: string,
  list: StoredProject[]
): boolean {
  if (typeof window === "undefined") return false;
  const canonical = canonicalProjectsStorageKey(entity, repo);
  try {
    localStorage.setItem(canonical, JSON.stringify(list));
  } catch {
    return false;
  }
  for (const key of collectProjectStorageKeys(entity, repo)) {
    if (key === canonical) continue;
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }
  return true;
}

export function mergeGithubProjectsIntoLocal(
  local: StoredProject[],
  fromGithub: StoredProject[]
): StoredProject[] {
  const keptLocal = local.filter((p) => !isGithubProject(p));
  return [...fromGithub, ...keptLocal];
}

/** Forge-backed tabs show GitHub boards only; Nostr-only tabs keep local boards. */
export function projectsForTab(
  list: StoredProject[],
  mode: "forge-readonly" | "nostr-local"
): StoredProject[] {
  if (mode === "forge-readonly") {
    return list.filter((p) => isGithubProject(p));
  }
  return list.filter((p) => !isGithubProject(p));
}
