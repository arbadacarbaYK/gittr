/**
 * When merging Nostr `repoData` into local storage, empty arrays are truthy in JS
 * (`[] || fallback` keeps `[]`). Use this so an empty list from the wire does not
 * wipe richer local data (e.g. GitHub-imported releases stripped before a fix).
 */
export function coalesceMetadataList<T>(
  incoming: T[] | undefined | null,
  fallback: T[] | undefined | null
): T[] {
  if (Array.isArray(incoming) && incoming.length > 0) return incoming;
  if (Array.isArray(fallback) && fallback.length > 0) return fallback;
  if (Array.isArray(incoming)) return incoming;
  if (Array.isArray(fallback)) return fallback;
  return [];
}
