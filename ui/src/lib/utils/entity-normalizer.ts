/**
 * Entity Normalization Utilities
 *
 * Normalizes entity identifiers for consistent use in:
 * - localStorage keys
 * - URL generation
 * - Repo lookups
 *
 * CRITICAL: We use npub format (GRASP protocol standard) everywhere.
 * No 8-char prefixes - they cause confusion and mapping issues.
 */
import { nip19 } from "nostr-tools";

/**
 * Normalizes an entity identifier to npub format for localStorage
 *
 * @param entity - Entity identifier (npub, or full pubkey)
 * @returns npub format for consistent storage
 */
export function normalizeEntityForStorage(
  entity: string | undefined | null
): string {
  if (!entity) return "";

  // If already npub, return as-is
  if (entity.startsWith("npub")) {
    return entity;
  }

  // If full pubkey (64-char), encode to npub
  if (/^[0-9a-f]{64}$/i.test(entity)) {
    try {
      return nip19.npubEncode(entity);
    } catch {
      // Invalid pubkey, fall through
    }
  }

  // Fallback: use entity as-is (might be GitHub username or other format)
  return entity;
}

/**
 * Generates a consistent localStorage key for repo-related data
 * Uses npub format (GRASP protocol standard)
 *
 * @param prefix - Key prefix (e.g., "gittr_issues", "gittr_prs")
 * @param entity - Entity identifier (npub or full pubkey)
 * @param repo - Repository name
 * @returns Normalized localStorage key
 */
export function getRepoStorageKey(
  prefix: string,
  entity: string,
  repo: string
): string {
  const normalizedEntity = normalizeEntityForStorage(entity);
  return `${prefix}__${normalizedEntity}__${repo}`;
}

/**
 * Fuzzy match for repo slug across URL segments, GitHub import names, and bridge:
 * case-insensitive; hyphens and underscores equivalent (e.g. `foo-bar` vs `foo_bar`).
 */
export function normalizeRepoSlugForMatch(repo: string): string {
  return repo.trim().toLowerCase().replace(/-/g, "_").replace(/_+/g, "_");
}

function issueStableMergeKey(row: unknown): string {
  if (!row || typeof row !== "object") return `invalid:${String(row)}`;
  const r = row as Record<string, unknown>;
  const id = r.id;
  if (typeof id === "string" && /^[0-9a-f]{64}$/i.test(id)) {
    return id.toLowerCase();
  }
  const num = r.number;
  if (typeof num === "string" || typeof num === "number") {
    return `num:${String(num)}`;
  }
  return `anon:${JSON.stringify(row).slice(0, 120)}`;
}

/** All localStorage keys that may hold this repo's gittr-only issues (hex vs npub routes). */
export function collectGittrIssuesStorageKeys(
  entity: string,
  repo: string
): string[] {
  const seen = new Set<string>();
  const add = (k: string) => {
    if (k) seen.add(k);
  };
  const canonical = getRepoStorageKey("gittr_issues", entity, repo);
  add(canonical);
  add(`gittr_issues__${entity}__${repo}`);
  if (/^[0-9a-f]{64}$/i.test(entity)) {
    const hex = entity.toLowerCase();
    add(`gittr_issues__${hex}__${repo}`);
    try {
      add(`gittr_issues__${nip19.npubEncode(hex)}__${repo}`);
    } catch {
      /* ignore */
    }
  }
  if (entity.startsWith("npub")) {
    try {
      const d = nip19.decode(entity);
      if (d.type === "npub" && typeof d.data === "string") {
        add(`gittr_issues__${(d.data as string).toLowerCase()}__${repo}`);
      }
    } catch {
      /* ignore */
    }
  }
  return [...seen];
}

function readIssuesArrayRaw(storageKey: string): unknown[] {
  try {
    const raw = localStorage.getItem(storageKey);
    const list = raw ? (JSON.parse(raw) as unknown[]) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/**
 * Read per-repo issues from localStorage using the canonical key (npub-normalized entity).
 * Merges rows from legacy keys (hex entity in URL vs npub route, older single-key writes)
 * so list, detail, and close/reopen always see one combined list and one canonical bucket.
 */
export function readRepoIssuesFromLocalStorage(
  entity: string,
  repo: string
): unknown[] {
  if (typeof window === "undefined") return [];
  const canonicalKey = getRepoStorageKey("gittr_issues", entity, repo);
  const keys = collectGittrIssuesStorageKeys(entity, repo);
  const merged = new Map<string, unknown>();

  for (const k of keys) {
    for (const row of readIssuesArrayRaw(k)) {
      merged.set(issueStableMergeKey(row), row);
    }
  }

  const out = Array.from(merged.values()) as Array<Record<string, unknown>>;
  out.sort((a, b) => {
    const na = parseInt(String(a.number ?? "0"), 10) || 0;
    const nb = parseInt(String(b.number ?? "0"), 10) || 0;
    return na - nb;
  });

  const sortForCompare = (list: unknown[]) =>
    [...list].sort((a, b) =>
      issueStableMergeKey(a).localeCompare(issueStableMergeKey(b))
    );

  try {
    const prev = readIssuesArrayRaw(canonicalKey);
    const changed =
      JSON.stringify(sortForCompare(out)) !==
      JSON.stringify(sortForCompare(prev));
    if (changed && out.length >= 0) {
      localStorage.setItem(canonicalKey, JSON.stringify(out));
      for (const k of keys) {
        if (k !== canonicalKey) {
          localStorage.removeItem(k);
        }
      }
    }
  } catch {
    /* quota or private mode */
  }

  return out;
}
