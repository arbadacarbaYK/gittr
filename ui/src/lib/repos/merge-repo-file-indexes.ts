/**
 * Merge two `gittr_files` index snapshots keyed by path.
 * Kept separate from storage.ts so unit tests do not pull browser/localStorage deps.
 */

export type MergeableRepoFile = {
  path: string;
  type?: string;
  size?: number;
  sha?: string;
  content?: string;
};

const normIndexedPath = (p: string) =>
  String(p || "")
    .replace(/^\//, "")
    .toLowerCase();

const indexedBodyLen = (row: MergeableRepoFile): number => {
  const c = row.content;
  return typeof c === "string" ? c.length : 0;
};

/**
 * When both rows exist, keep the one with longer `content` so a large path-only
 * tree under one slug cannot replace README bodies stored under a storage alias.
 * If the incoming row has no body but a different `size`/`sha`, drop the stale
 * body so callers refetch (GitHub listings are path+size only).
 * If prev has body but no size, overlay size/sha from the listing.
 */
export function mergeRepoFileIndexes<T extends MergeableRepoFile>(
  a: T[],
  b: T[]
): T[] {
  if (!a.length) return b.slice();
  if (!b.length) return a.slice();
  const by = new Map<string, T>();
  for (const rows of [a, b]) {
    for (const row of rows) {
      const key = normIndexedPath(row.path || "");
      if (!key) continue;
      const prev = by.get(key);
      if (!prev) {
        by.set(key, row);
        continue;
      }
      const pl = indexedBodyLen(prev);
      const nl = indexedBodyLen(row);
      if (nl > pl) {
        by.set(key, row);
      } else if (nl === 0 && pl > 0) {
        const sizeChanged =
          row.size != null && prev.size != null && row.size !== prev.size;
        const shaChanged = !!(row.sha && prev.sha && row.sha !== prev.sha);
        if (sizeChanged || shaChanged) {
          by.set(key, { ...row });
        } else if (row.size != null && prev.size == null) {
          by.set(key, { ...prev, size: row.size, sha: row.sha || prev.sha });
        }
      } else if (nl === pl && nl === 0) {
        const prevMeta = (prev.size ?? 0) + String(prev.sha || "").length;
        const nextMeta = (row.size ?? 0) + String(row.sha || "").length;
        if (nextMeta > prevMeta) by.set(key, row);
      }
    }
  }
  return Array.from(by.values());
}
