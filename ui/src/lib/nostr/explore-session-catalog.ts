/**
 * Explore’s catalog survives leaving `/explore` and hard search navigations.
 * The page used to keep it in a component ref, so remount painted ~32
 * localStorage rows and re-subscribed from scratch while ngit / Shakespeare /
 * NostrHub cards waited. Module memory dies on `location.assign`; sessionStorage
 * keeps the same-tab list through those reloads.
 */

export type ExploreCatalogRow = {
  entity?: string;
  repo?: string;
  slug?: string;
  ownerPubkey?: string;
  [key: string]: unknown;
};

export const EXPLORE_SESSION_STORAGE_KEY = "gittr_explore_session_catalog";

let sessionCatalog: ExploreCatalogRow[] | null = null;

function readSessionStorageCatalog(): ExploreCatalogRow[] | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(EXPLORE_SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ExploreCatalogRow[]) : null;
  } catch {
    return null;
  }
}

function writeSessionStorageCatalog(list: ExploreCatalogRow[]): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(EXPLORE_SESSION_STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* quota — memory catalog still wins for this document */
  }
}

export function peekExploreSessionCatalog(): ExploreCatalogRow[] | null {
  if (sessionCatalog) return sessionCatalog;
  sessionCatalog = readSessionStorageCatalog();
  return sessionCatalog;
}

export function writeExploreSessionCatalog(list: ExploreCatalogRow[]): void {
  sessionCatalog = list;
  writeSessionStorageCatalog(list);
}

/** Test-only: drop the module catalog so cases do not leak into each other. */
export function resetExploreSessionCatalogForTests(): void {
  sessionCatalog = null;
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.removeItem(EXPLORE_SESSION_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/** Test-only: forget memory but keep sessionStorage (simulates a document reload). */
export function dropExploreSessionCatalogMemoryForTests(): void {
  sessionCatalog = null;
}

/** Prefer the live session list when quota blocked persist (LS is a subset). */
export function hydrateExploreSessionCatalog(
  fromLocalStorage: ExploreCatalogRow[]
): ExploreCatalogRow[] {
  if (!sessionCatalog) {
    sessionCatalog = readSessionStorageCatalog();
  }
  if (sessionCatalog && sessionCatalog.length > fromLocalStorage.length) {
    return sessionCatalog;
  }
  sessionCatalog = fromLocalStorage;
  writeSessionStorageCatalog(sessionCatalog);
  return sessionCatalog;
}
