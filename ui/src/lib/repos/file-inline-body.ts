/**
 * Detect file rows that only have path/size metadata (no bytes) vs rows
 * that can actually be pushed or shown.
 *
 * Import/Refetch often leaves hollow `dist/*` (and similar) in the local
 * index. Those extra paths made the Code tab look “richer” than GitHub or
 * the bridge, so persist/apply skipped the real 7-file tree.
 */
import { isOverrideIdbMarker } from "./overrides-idb";

export type PathishRepoFile = {
  path?: string;
  content?: string;
  data?: string;
};

export function normalizeRepoFilePath(path: string | undefined | null): string {
  return String(path || "")
    .replace(/^\//, "")
    .replace(/\\/g, "/")
    .toLowerCase();
}

function nonEmptyBody(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/** True when this row has bytes (or an IndexedDB override pointer), not just a path. */
export function fileHasInlineBody(
  file: PathishRepoFile | null | undefined
): boolean {
  if (!file || typeof file !== "object") return false;
  if (isOverrideIdbMarker(file.content) || isOverrideIdbMarker(file.data)) {
    return true;
  }
  return nonEmptyBody(file.content) || nonEmptyBody(file.data);
}

/**
 * Every local-only path (not in `remote`) lacks an inline body.
 * Vacuous true when there are no local-only paths.
 */
export function localExtrasAreHollowOnly<T extends PathishRepoFile>(
  local: T[] | null | undefined,
  remote: T[] | null | undefined
): boolean {
  const remotePaths = new Set(
    (remote || []).map((f) => normalizeRepoFilePath(f.path)).filter(Boolean)
  );
  for (const row of local || []) {
    const key = normalizeRepoFilePath(row.path);
    if (!key || remotePaths.has(key)) continue;
    if (fileHasInlineBody(row)) return false;
  }
  return true;
}

/**
 * Remote listing is the base. Keep local-only rows that have bytes (real
 * uploads). Overlay override bodies onto matching remote paths. Drop hollow
 * local-only stubs (`dist/frame-00.png` with no content, etc.).
 */
export function overlayLocalBodiesOnRemoteTree<T extends PathishRepoFile>(
  remote: T[] | null | undefined,
  local: T[] | null | undefined,
  overridePaths?: Iterable<string> | null
): T[] {
  const overrideSet = new Set<string>();
  if (overridePaths) {
    for (const p of overridePaths) {
      const k = normalizeRepoFilePath(p);
      if (k) overrideSet.add(k);
    }
  }

  const byPath = new Map<string, T>();
  for (const row of remote || []) {
    const key = normalizeRepoFilePath(row.path);
    if (!key) continue;
    byPath.set(key, row);
  }

  for (const row of local || []) {
    const key = normalizeRepoFilePath(row.path);
    if (!key || !fileHasInlineBody(row)) continue;
    const existing = byPath.get(key);
    if (!existing) {
      byPath.set(key, row);
      continue;
    }
    if (overrideSet.has(key)) {
      byPath.set(key, { ...existing, ...row });
    }
  }

  return Array.from(byPath.values());
}
