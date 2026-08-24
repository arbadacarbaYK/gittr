/**
 * Canonical live kind-30617 lookup for a repo.
 *
 * File fetch, Star, Public/Private, forge hydrate, Fork, and Commits must all
 * use this instead of a defaultRelays-only subscribe. `/api/nostr/profile-repos`
 * already queries NIP-34 discovery relays (ngit / NostrHub / shakespeare).
 *
 * Does not change how files are fetched — only shares announcement identity.
 */
import { broadcastRepoAnnouncementEventId } from "../nostr/repo-stars";

import {
  type ProfileRepoCloneHints,
  fetchRepoCloneHintsFromProfile,
} from "./hydrate-clone-from-profile-repos";
import { persistRepoAnnouncementMeta } from "./repo-github-hub";

export async function resolveLiveRepoAnnouncement(opts: {
  ownerPubkey: string;
  repoName: string;
  entity?: string;
  persist?: boolean;
  broadcast?: boolean;
}): Promise<ProfileRepoCloneHints | null> {
  const hints = await fetchRepoCloneHintsFromProfile(
    opts.ownerPubkey,
    opts.repoName
  );
  if (!hints) return null;

  const entity = opts.entity?.trim();
  if (entity && opts.broadcast !== false && hints.lastNostrEventId) {
    broadcastRepoAnnouncementEventId({
      eventId: hints.lastNostrEventId,
      entity,
      repo: opts.repoName,
      ownerPubkey: opts.ownerPubkey,
    });
  }
  if (entity && opts.persist !== false) {
    try {
      persistRepoAnnouncementMeta({
        entity,
        repo: opts.repoName,
        lastNostrEventId: hints.lastNostrEventId,
        sourceUrl: hints.sourceUrl,
        clone: hints.clone,
        forkedFrom: hints.forkedFrom,
        description: hints.description,
        ownerPubkey: opts.ownerPubkey,
        publicRead: hints.publicRead,
      });
    } catch {
      /* localStorage quota / SSR */
    }
  }
  return hints;
}
