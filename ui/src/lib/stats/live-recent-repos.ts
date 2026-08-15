import { nip19 } from "nostr-tools";

import { isPublisherBlocklisted } from "../moderation/publisher-blocklist";
import {
  normalizeNip34RepoIdentifier,
  shouldHideNip34EventForUnusableClones,
} from "../nostr/clone-url-quality";
import { isRepoAnnouncementDeleted } from "../nostr/repo-deleted";
import { isPublicReadFromEvent } from "../nostr/repo-public-read";

const KIND_REPOSITORY_NIP34 = 30617;

/** Home "Recent repositories" card — npub entity for links */
export type PlatformRecentRepo = {
  entity: string;
  repo: string;
  repoName: string;
  ownerPubkey: string;
  lastActivity: number;
  description?: string;
};

export function hexPubkeyToNpub(pubkey: string): string {
  const hex = (pubkey || "").trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hex)) return pubkey;
  try {
    return nip19.npubEncode(hex);
  } catch {
    return hex.slice(0, 8);
  }
}

function repoIdToNpubEntity(repoId: string, fallbackHex: string): string {
  const parts = repoId.split("/");
  const hex = parts[0] || fallbackHex;
  return hexPubkeyToNpub(hex);
}

export type LiveRecentSubscribe = (
  filters: any[],
  relays: string[],
  onEvent: (event: any, isAfterEose: boolean, relayURL?: string) => void,
  maxDelayms?: number,
  onEose?: (relayUrl: string, minCreatedAt: number) => void,
  options?: any
) => () => void;

/**
 * Newest public 30617 announcements (Explore-style), not 30618 push bumps.
 */
export function getLiveRecentReposFromNostr(
  subscribe: LiveRecentSubscribe,
  relays: string[],
  count = 12
): Promise<PlatformRecentRepo[]> {
  const activeRelays = relays.filter(Boolean);
  const byKey = new Map<string, PlatformRecentRepo>();
  const privateRepoIds = new Set<string>();
  const unusableCloneRepoIds = new Set<string>();

  return new Promise((resolve) => {
    let resolved = false;
    let eoseCount = 0;
    const expectedEose = activeRelays.length;

    const noteRepo = (
      ownerHex: string,
      repoName: string,
      tsMs: number,
      description?: string
    ) => {
      if (!ownerHex || !repoName) return;
      const key = `${ownerHex}/${repoName}`;
      if (unusableCloneRepoIds.has(key) || privateRepoIds.has(key)) return;
      const existing = byKey.get(key);
      if (!existing || tsMs > existing.lastActivity) {
        byKey.set(key, {
          entity: repoIdToNpubEntity(key, ownerHex),
          repo: repoName,
          repoName,
          ownerPubkey: ownerHex,
          lastActivity: tsMs,
          description: description || existing?.description,
        });
      } else if (description && !existing.description) {
        existing.description = description;
      }
    };

    const filters = [{ kinds: [KIND_REPOSITORY_NIP34], limit: 800 }];

    const finish = () => {
      if (resolved) return;
      resolved = true;
      try {
        unsub();
      } catch {
        /* ignore */
      }
      resolve(
        Array.from(byKey.values())
          .sort((a, b) => b.lastActivity - a.lastActivity)
          .slice(0, count)
      );
    };

    const unsub = subscribe(
      filters,
      activeRelays,
      (event) => {
        if (isPublisherBlocklisted(event.pubkey)) return;
        const ts = (event.created_at || 0) * 1000;
        const ownerHex = (event.pubkey || "").toLowerCase();
        if (!/^[0-9a-f]{64}$/.test(ownerHex)) return;

        if (event.kind === KIND_REPOSITORY_NIP34) {
          const dTag = event.tags?.find(
            (t: any) => Array.isArray(t) && t[0] === "d"
          );
          const nameTag = event.tags?.find(
            (t: any) => Array.isArray(t) && t[0] === "name"
          );
          const repoName = normalizeNip34RepoIdentifier(
            typeof dTag?.[1] === "string" ? dTag[1] : "",
            typeof nameTag?.[1] === "string" ? nameTag[1] : ""
          );
          if (!repoName) return;
          const repoKey = `${ownerHex}/${repoName}`;
          if (isRepoAnnouncementDeleted(event)) {
            byKey.delete(repoKey);
            return;
          }
          if (!isPublicReadFromEvent(event)) {
            privateRepoIds.add(repoKey);
            byKey.delete(repoKey);
            return;
          }
          privateRepoIds.delete(repoKey);
          if (shouldHideNip34EventForUnusableClones(event)) {
            unusableCloneRepoIds.add(repoKey);
            byKey.delete(repoKey);
            return;
          }
          unusableCloneRepoIds.delete(repoKey);
          let description: string | undefined;
          try {
            const content = JSON.parse(event.content || "{}");
            if (content?.description) description = String(content.description);
          } catch {
            /* NIP-34 tags only */
          }
          noteRepo(ownerHex, repoName, ts, description);
        }
      },
      undefined,
      () => {
        eoseCount++;
        if (eoseCount >= expectedEose) {
          setTimeout(finish, 200);
        }
      },
      {}
    );

    setTimeout(finish, 4000);
  });
}

/** @deprecated Snapshot helper — prefer getLiveRecentReposFromNostr for “recent” UI. */
export async function getRecentReposFromNostr(
  subscribe: LiveRecentSubscribe,
  relays: string[],
  count = 12
): Promise<PlatformRecentRepo[]> {
  return getLiveRecentReposFromNostr(subscribe, relays, count);
}
