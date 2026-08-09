/**
 * Local delete tombstones (`gittr_deleted_repos`) hide repos on My Repos /
 * Explore / Profile after Settings → Delete. Recreate / re-import / a new live
 * 30617 under the same owner+name must clear them or HP (relay-fed) shows the
 * repo while those pages keep hiding it forever.
 */

import { nip19 } from "nostr-tools";

export type DeletedRepoTombstone = {
  entity?: string;
  repo?: string;
  ownerPubkey?: string;
  deletedAt?: number;
};

export function clearDeletedRepoTombstones(opts: {
  repo: string;
  entity?: string;
  ownerPubkey?: string;
}): number {
  if (typeof window === "undefined") return 0;
  const targetRepo = (opts.repo || "").trim().toLowerCase();
  if (!targetRepo) return 0;
  const entity = (opts.entity || "").trim().toLowerCase();
  const owner = (opts.ownerPubkey || "").trim().toLowerCase();

  try {
    const deletedRepos = JSON.parse(
      localStorage.getItem("gittr_deleted_repos") || "[]"
    ) as DeletedRepoTombstone[];
    if (!Array.isArray(deletedRepos) || deletedRepos.length === 0) return 0;

    const nextDeleted = deletedRepos.filter((d) => {
      const dRepo = (d.repo || "").trim().toLowerCase();
      if (dRepo !== targetRepo) return true;

      if (
        owner &&
        d.ownerPubkey &&
        d.ownerPubkey.trim().toLowerCase() === owner
      ) {
        return false;
      }

      const dEntity = (d.entity || "").trim().toLowerCase();
      if (entity && dEntity && dEntity === entity) return false;

      if (owner && dEntity.startsWith("npub")) {
        try {
          const decoded = nip19.decode(d.entity!);
          if (
            decoded.type === "npub" &&
            String(decoded.data).toLowerCase() === owner
          ) {
            return false;
          }
        } catch {
          /* ignore */
        }
      }

      if (owner && /^[0-9a-f]{64}$/i.test(dEntity) && dEntity === owner) {
        return false;
      }

      return true;
    });

    if (nextDeleted.length !== deletedRepos.length) {
      localStorage.setItem(
        "gittr_deleted_repos",
        JSON.stringify(nextDeleted)
      );
      return deletedRepos.length - nextDeleted.length;
    }
  } catch {
    /* ignore */
  }
  return 0;
}
