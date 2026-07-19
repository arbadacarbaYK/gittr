/**
 * gittr soft-delete for kind 30617 (replaceable repo announcements).
 *
 * Settings delete republishes 30617 with the same `d` tag and either:
 * - content JSON: `{ "deleted": true, ... }` (NIP-07 path historically), and/or
 * - tags: `["deleted","true"]` / `["archived","true"]` / `["status","deleted"]`
 *
 * Core NIP-34 leaves content empty; clients must still honor gittr's markers
 * so clearing localStorage does not resurrect deleted repos from relays.
 */

export type RepoDeletionMarkers = {
  deleted?: boolean;
  archived?: boolean;
};

function truthyFlag(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    return v === "true" || v === "1" || v === "yes";
  }
  return false;
}

/** Parse deletion/archive markers from tags and/or JSON content. */
export function deletionMarkersFromEvent(event: {
  content?: string;
  tags?: string[][] | null;
}): RepoDeletionMarkers {
  const out: RepoDeletionMarkers = {};

  if (Array.isArray(event.tags)) {
    for (const t of event.tags) {
      if (!Array.isArray(t) || typeof t[0] !== "string") continue;
      const name = t[0].toLowerCase();
      const value = typeof t[1] === "string" ? t[1] : "";
      if (name === "deleted" && truthyFlag(value || true)) {
        out.deleted = true;
      } else if (name === "archived" && truthyFlag(value || true)) {
        out.archived = true;
      } else if (name === "status") {
        const status = value.trim().toLowerCase();
        if (status === "deleted") out.deleted = true;
        if (status === "archived") out.archived = true;
      }
    }
  }

  const trimmed = (event.content || "").trim();
  if (trimmed.startsWith("{")) {
    try {
      const data = JSON.parse(trimmed) as {
        deleted?: unknown;
        archived?: unknown;
      };
      if (truthyFlag(data.deleted)) out.deleted = true;
      if (truthyFlag(data.archived)) out.archived = true;
    } catch {
      /* ignore non-JSON content */
    }
  }

  return out;
}

/** True when the announcement should be hidden from discovery/lists. */
export function isRepoAnnouncementDeleted(event: {
  content?: string;
  tags?: string[][] | null;
}): boolean {
  const m = deletionMarkersFromEvent(event);
  return m.deleted === true || m.archived === true;
}

/** Merge deletion markers onto a mutable repo-shaped object. */
export function applyDeletionMarkersToRepoData(
  repoData: RepoDeletionMarkers,
  event: { content?: string; tags?: string[][] | null }
): void {
  const m = deletionMarkersFromEvent(event);
  if (m.deleted) repoData.deleted = true;
  if (m.archived) repoData.archived = true;
}
