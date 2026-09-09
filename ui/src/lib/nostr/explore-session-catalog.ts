/**
 * Explore’s in-memory catalog survives leaving `/explore`. The page used to
 * keep it in a component ref, so remount painted ~32 localStorage rows and
 * re-subscribed from scratch while ngit / Shakespeare / NostrHub cards waited.
 */

export type ExploreCatalogRow = {
  entity?: string;
  repo?: string;
  slug?: string;
  ownerPubkey?: string;
  [key: string]: unknown;
};

let sessionCatalog: ExploreCatalogRow[] | null = null;

export function peekExploreSessionCatalog(): ExploreCatalogRow[] | null {
  return sessionCatalog;
}

export function writeExploreSessionCatalog(list: ExploreCatalogRow[]): void {
  sessionCatalog = list;
}

/** Test-only: drop the module catalog so cases do not leak into each other. */
export function resetExploreSessionCatalogForTests(): void {
  sessionCatalog = null;
}

/** Prefer the live session list when quota blocked persist (LS is a subset). */
export function hydrateExploreSessionCatalog(
  fromLocalStorage: ExploreCatalogRow[]
): ExploreCatalogRow[] {
  if (sessionCatalog && sessionCatalog.length > fromLocalStorage.length) {
    return sessionCatalog;
  }
  sessionCatalog = fromLocalStorage;
  return sessionCatalog;
}
