import { KIND_REPOSITORY, KIND_REPOSITORY_NIP34 } from "@/lib/nostr/events";
import { isPublicReadFromEvent } from "@/lib/nostr/repo-public-read";
import {
  mergeOgDescriptions,
  resolveOgOwnerPubkey,
} from "@/lib/seo/og-owner-pubkey";

export type RepoAnnouncementMeta = {
  description: string | null;
  nostrPublicRead: boolean;
};

const EMPTY: RepoAnnouncementMeta = {
  description: null,
  nostrPublicRead: true,
};

/**
 * Server-side: repo description + public-read from latest kind 30617/51 (for SEO robots).
 */
export async function fetchRepoAnnouncementMeta(
  entity: string,
  repoName: string,
  timeoutMs = 1500,
  ownerPubkeyHex?: string | null
): Promise<RepoAnnouncementMeta> {
  try {
    const ownerPubkey =
      ownerPubkeyHex && /^[0-9a-f]{64}$/i.test(ownerPubkeyHex)
        ? ownerPubkeyHex.toLowerCase()
        : await resolveOgOwnerPubkey(
            entity,
            repoName,
            Math.min(800, timeoutMs)
          );

    if (!ownerPubkey) return EMPTY;

    const queryPromise = (async () => {
      let pool: any = null;
      try {
        const { RelayPool } = await import("nostr-relaypool");

        // No Damus: SSR metadata races abandon pools; Damus reconnect storms blow MemoryHigh.
        const DEFAULT_RELAYS = [
          "wss://relay.gittr.space",
          "wss://relay.noderunners.network",
          "wss://nos.lol",
          "wss://relay.ngit.dev",
          "wss://gitnostr.com",
          "wss://relay.azzamo.net",
        ];

        pool = new RelayPool(DEFAULT_RELAYS, { dontAutoReconnect: true });

        return new Promise<RepoAnnouncementMeta>((resolve) => {
          let resolved = false;
          let best: RepoAnnouncementMeta = EMPTY;
          let newestAt = -1;
          const finish = (value: RepoAnnouncementMeta) => {
            if (resolved) return;
            resolved = true;
            clearTimeout(timeout);
            try {
              pool?.close();
            } catch {
              /* ignore */
            }
            resolve(value);
          };
          const timeout = setTimeout(() => finish(best), timeoutMs);

          try {
            pool.subscribe(
              [
                {
                  kinds: [KIND_REPOSITORY, KIND_REPOSITORY_NIP34],
                  authors: [ownerPubkey],
                  "#d": [repoName],
                  limit: 5,
                },
              ],
              DEFAULT_RELAYS,
              (event: {
                content?: string;
                tags?: string[][];
                created_at?: number;
              }) => {
                if (resolved) return;
                try {
                  const content = JSON.parse(event.content || "{}");
                  const fromJson =
                    typeof content.description === "string"
                      ? content.description
                      : null;
                  const descTag = event.tags?.find(
                    (t) => t[0] === "description"
                  );
                  const fromTag =
                    typeof descTag?.[1] === "string" ? descTag[1] : null;
                  const description = mergeOgDescriptions(
                    fromJson || fromTag,
                    best.description,
                    repoName
                  );
                  const createdAt =
                    typeof event.created_at === "number" ? event.created_at : 0;
                  const publicRead = isPublicReadFromEvent(
                    event as import("nostr-tools").Event
                  );
                  if (createdAt >= newestAt) {
                    newestAt = createdAt;
                    best = {
                      description,
                      nostrPublicRead: publicRead,
                    };
                  } else {
                    best = {
                      ...best,
                      description,
                    };
                  }
                } catch {
                  /* keep best */
                }
              },
              undefined,
              () => {
                if (best.description) finish(best);
              }
            );
          } catch {
            finish(best);
          }
        });
      } catch {
        try {
          pool?.close?.();
        } catch {
          /* ignore */
        }
        return EMPTY;
      }
    })();

    return await queryPromise;
  } catch {
    return EMPTY;
  }
}
