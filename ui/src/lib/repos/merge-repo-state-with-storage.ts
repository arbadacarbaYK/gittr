/**
 * Overlay in-memory repo state on the stored row.
 * `pagesSiteSlug` is Pages-only (not on kind 30617). Hydrate objects often omit
 * the key; that must not wipe a custom site name. An explicit empty string means
 * the owner cleared the custom name.
 */
export function mergeRepoStateWithStorage<T extends object>(
  repoData: T | null | undefined,
  repoFromStorage: T | null | undefined
): T | null {
  if (repoData && repoFromStorage) {
    const merged = { ...repoFromStorage, ...repoData } as T & {
      pagesSiteSlug?: string;
    };
    applyPreservedPagesSiteSlug(merged, repoData, repoFromStorage);
    return merged;
  }
  return repoData ?? repoFromStorage ?? null;
}

export function applyPreservedPagesSiteSlug(
  target: { pagesSiteSlug?: string },
  live: object,
  stored?: object | null
): void {
  if (Object.prototype.hasOwnProperty.call(live, "pagesSiteSlug")) {
    const liveSlug = (live as { pagesSiteSlug?: string }).pagesSiteSlug;
    if (typeof liveSlug === "string" && liveSlug.trim()) {
      target.pagesSiteSlug = liveSlug.trim();
    } else {
      delete target.pagesSiteSlug;
    }
    return;
  }
  const storedSlug = (stored as { pagesSiteSlug?: string } | null | undefined)
    ?.pagesSiteSlug;
  if (typeof storedSlug === "string" && storedSlug.trim()) {
    target.pagesSiteSlug = storedSlug.trim();
  }
}

/** Copy a custom Pages slug onto a freshly built repo object that omitted it. */
export function withPreservedPagesSiteSlug<T extends Record<string, unknown>>(
  next: T,
  ...fallbacks: Array<{ pagesSiteSlug?: string } | null | undefined>
): T {
  if (Object.prototype.hasOwnProperty.call(next, "pagesSiteSlug")) {
    return next;
  }
  for (const f of fallbacks) {
    const s = f?.pagesSiteSlug;
    if (typeof s === "string" && s.trim()) {
      return { ...next, pagesSiteSlug: s.trim() };
    }
  }
  return next;
}
