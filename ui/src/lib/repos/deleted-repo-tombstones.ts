/**
 * Local delete tombstones (`gittr_deleted_repos`) hide repos on My Repos /
 * Explore / Profile after Settings → Delete (intentional hide).
 *
 * "Flush my own repos cache" clears the browser catalog *and* lifts this
 * owner's tombstones so Nostr / profile-repos can refill.
 *
 * A new live 30617 must be *newer than deletedAt* to clear a tombstone after
 * an intentional delete. Older announcements still on relays must not undo it.
 * Explicit user recreate / re-import / publish clears without a time check.
 */
import { nip19 } from "nostr-tools";

export type DeletedRepoTombstone = {
  entity?: string;
  repo?: string;
  ownerPubkey?: string;
  deletedAt?: number;
};

function tombstoneMatches(
  d: DeletedRepoTombstone,
  opts: { repo: string; entity?: string; ownerPubkey?: string }
): boolean {
  const targetRepo = (opts.repo || "").trim().toLowerCase();
  const dRepo = (d.repo || "").trim().toLowerCase();
  if (!targetRepo || dRepo !== targetRepo) return false;

  const entity = (opts.entity || "").trim().toLowerCase();
  const owner = (opts.ownerPubkey || "").trim().toLowerCase();
  const dEntity = (d.entity || "").trim().toLowerCase();
  const dOwner = (d.ownerPubkey || "").trim().toLowerCase();

  if (owner && dOwner && dOwner === owner) return true;
  if (entity && dEntity && dEntity === entity) return true;

  if (owner && dEntity.startsWith("npub")) {
    try {
      const decoded = nip19.decode(d.entity!);
      if (
        decoded.type === "npub" &&
        String(decoded.data).toLowerCase() === owner
      ) {
        return true;
      }
    } catch {
      /* ignore */
    }
  }

  if (owner && /^[0-9a-f]{64}$/i.test(dEntity) && dEntity === owner) {
    return true;
  }

  return false;
}

function readTombstones(): DeletedRepoTombstone[] {
  try {
    const existing = JSON.parse(
      localStorage.getItem("gittr_deleted_repos") || "[]"
    ) as DeletedRepoTombstone[];
    return Array.isArray(existing) ? existing : [];
  } catch {
    return [];
  }
}

/**
 * True when a matching tombstone should still hide this repo.
 * If `announcedAtMs` is newer than `deletedAt`, returns false (reopen allowed).
 */
export function isDeletedRepoTombstoned(opts: {
  repo: string;
  entity?: string;
  ownerPubkey?: string;
  /** Relay event created_at in ms (created_at * 1000). */
  announcedAtMs?: number;
}): boolean {
  if (typeof window === "undefined") return false;
  const targetRepo = (opts.repo || "").trim().toLowerCase();
  if (!targetRepo) return false;

  const deletedRepos = readTombstones();
  const match = deletedRepos.find((d) => tombstoneMatches(d, opts));
  if (!match) return false;

  const deletedAt =
    typeof match.deletedAt === "number" && Number.isFinite(match.deletedAt)
      ? match.deletedAt
      : 0;
  const announcedAt =
    typeof opts.announcedAtMs === "number" &&
    Number.isFinite(opts.announcedAtMs)
      ? opts.announcedAtMs
      : undefined;

  // Only a newer announcement beats the flush/delete tombstone.
  if (announcedAt !== undefined && announcedAt > deletedAt) {
    return false;
  }
  return true;
}

export function addDeletedRepoTombstones(
  repos: Array<{ entity?: string; repo?: string; ownerPubkey?: string }>
): number {
  if (typeof window === "undefined" || !repos || repos.length === 0) return 0;
  try {
    const existing = readTombstones();
    const now = Date.now();
    let changed = 0;

    for (const repo of repos) {
      const entity = (repo.entity || "").trim();
      const repoName = (repo.repo || "").trim();
      if (!repoName) continue;

      const idx = existing.findIndex((d) =>
        tombstoneMatches(d, {
          entity,
          repo: repoName,
          ownerPubkey: repo.ownerPubkey,
        })
      );
      if (idx >= 0) {
        // Re-flush refreshes deletedAt so older relay 30617s stay hidden.
        const prev = existing[idx];
        if (!prev) continue;
        existing[idx] = {
          ...prev,
          entity: entity || prev.entity,
          repo: repoName || prev.repo,
          ownerPubkey: repo.ownerPubkey || prev.ownerPubkey,
          deletedAt: now,
        };
        changed++;
        continue;
      }

      existing.push({
        entity: repo.entity,
        repo: repo.repo,
        ownerPubkey: repo.ownerPubkey,
        deletedAt: now,
      });
      changed++;
    }

    if (changed > 0) {
      localStorage.setItem("gittr_deleted_repos", JSON.stringify(existing));
    }
    return changed;
  } catch {
    return 0;
  }
}

export function clearDeletedRepoTombstones(opts: {
  repo: string;
  entity?: string;
  ownerPubkey?: string;
  /**
   * Relay sync only: clear when this announcement (ms) is newer than deletedAt.
   * Omit for explicit user recreate / import / publish (always clear).
   */
  announcedAtMs?: number;
}): number {
  if (typeof window === "undefined") return 0;
  const targetRepo = (opts.repo || "").trim().toLowerCase();
  if (!targetRepo) return 0;

  try {
    const deletedRepos = readTombstones();
    if (deletedRepos.length === 0) return 0;

    const announcedAt =
      typeof opts.announcedAtMs === "number" &&
      Number.isFinite(opts.announcedAtMs)
        ? opts.announcedAtMs
        : undefined;

    const nextDeleted = deletedRepos.filter((d) => {
      if (!tombstoneMatches(d, opts)) return true;

      if (announcedAt !== undefined) {
        const deletedAt =
          typeof d.deletedAt === "number" && Number.isFinite(d.deletedAt)
            ? d.deletedAt
            : 0;
        // Keep tombstone when the relay event is older than (or equal to) flush.
        if (announcedAt <= deletedAt) return true;
      }

      return false;
    });

    if (nextDeleted.length !== deletedRepos.length) {
      localStorage.setItem("gittr_deleted_repos", JSON.stringify(nextDeleted));
      return deletedRepos.length - nextDeleted.length;
    }
  } catch {
    /* ignore */
  }
  return 0;
}

/**
 * Drop every tombstone owned by this pubkey (npub / hex / ownerPubkey field).
 * Used by "flush my own repos cache" so Nostr can refill the catalog.
 */
export function clearDeletedRepoTombstonesForOwner(ownerPubkey: string): number {
  if (typeof window === "undefined") return 0;
  const owner = (ownerPubkey || "").trim().toLowerCase();
  if (!owner || !/^[0-9a-f]{64}$/i.test(owner)) return 0;

  try {
    const deletedRepos = readTombstones();
    if (deletedRepos.length === 0) return 0;

    const nextDeleted = deletedRepos.filter((d) => {
      const dOwner = (d.ownerPubkey || "").trim().toLowerCase();
      if (dOwner && dOwner === owner) return false;

      const dEntity = (d.entity || "").trim().toLowerCase();
      if (dEntity === owner) return false;
      if (dEntity.startsWith("npub")) {
        try {
          const decoded = nip19.decode(d.entity!);
          if (
            decoded.type === "npub" &&
            String(decoded.data).toLowerCase() === owner
          ) {
            return false;
          }
        } catch {
          /* keep */
        }
      }
      return true;
    });

    if (nextDeleted.length !== deletedRepos.length) {
      localStorage.setItem("gittr_deleted_repos", JSON.stringify(nextDeleted));
      return deletedRepos.length - nextDeleted.length;
    }
  } catch {
    /* ignore */
  }
  return 0;
}
