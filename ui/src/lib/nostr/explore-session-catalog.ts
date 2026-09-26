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
let pendingSessionList: ExploreCatalogRow[] | null = null;
let sessionWriteTimer: ReturnType<typeof setTimeout> | null = null;
/** Full-catalog sessionStorage write failed once — don't retry it on every event. */
let sessionFullWriteBlocked = false;
let pagehideHooked = false;

const SESSION_WRITE_MS = 500;

function slimSessionRow(row: ExploreCatalogRow): ExploreCatalogRow {
  const description =
    typeof row.description === "string"
      ? row.description.slice(0, 160)
      : undefined;
  return {
    entity: row.entity,
    repo: row.repo,
    slug: row.slug,
    name: typeof row.name === "string" ? row.name : undefined,
    ownerPubkey: row.ownerPubkey,
    description,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastNostrEventCreatedAt: row.lastNostrEventCreatedAt,
    nostrEventId:
      typeof row.nostrEventId === "string" ? row.nostrEventId : undefined,
    syncedFromNostr: row.syncedFromNostr === true ? true : undefined,
    fromNostr: row.fromNostr === true ? true : undefined,
    hasUnpushedEdits: row.hasUnpushedEdits === true ? true : undefined,
    status: typeof row.status === "string" ? row.status : undefined,
  };
}

function hookSessionPagehide(): void {
  if (pagehideHooked || typeof window === "undefined") return;
  pagehideHooked = true;
  window.addEventListener("pagehide", () => {
    flushExploreSessionCatalogWrites();
  });
}

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
  if (!sessionFullWriteBlocked) {
    try {
      sessionStorage.setItem(EXPLORE_SESSION_STORAGE_KEY, JSON.stringify(list));
      return;
    } catch {
      sessionFullWriteBlocked = true;
    }
  }
  try {
    const slim = list.slice(0, 400).map(slimSessionRow);
    sessionStorage.setItem(EXPLORE_SESSION_STORAGE_KEY, JSON.stringify(slim));
  } catch {
    /* quota — memory catalog still wins for this document */
  }
}

/** Write the latest catalog now. Tests and pagehide use this; events are coalesced. */
export function flushExploreSessionCatalogWrites(): void {
  if (sessionWriteTimer) {
    clearTimeout(sessionWriteTimer);
    sessionWriteTimer = null;
  }
  const list = pendingSessionList;
  pendingSessionList = null;
  if (!list) return;
  writeSessionStorageCatalog(list);
}

export function peekExploreSessionCatalog(): ExploreCatalogRow[] | null {
  if (sessionCatalog) return sessionCatalog;
  sessionCatalog = readSessionStorageCatalog();
  return sessionCatalog;
}

export function writeExploreSessionCatalog(list: ExploreCatalogRow[]): void {
  sessionCatalog = list;
  pendingSessionList = list;
  hookSessionPagehide();
  if (typeof sessionStorage === "undefined") return;
  // One stringify per burst. Per-event writes of the whole catalog froze Explore.
  if (sessionWriteTimer) return;
  sessionWriteTimer = setTimeout(() => {
    flushExploreSessionCatalogWrites();
  }, SESSION_WRITE_MS);
}

/** Test-only: drop the module catalog so cases do not leak into each other. */
export function resetExploreSessionCatalogForTests(): void {
  sessionCatalog = null;
  pendingSessionList = null;
  sessionFullWriteBlocked = false;
  if (sessionWriteTimer) {
    clearTimeout(sessionWriteTimer);
    sessionWriteTimer = null;
  }
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
