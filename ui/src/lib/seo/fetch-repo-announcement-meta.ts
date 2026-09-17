import { KIND_REPOSITORY, KIND_REPOSITORY_NIP34 } from "@/lib/nostr/events";
import { isPublicReadFromEvent } from "@/lib/nostr/repo-public-read";
import { resolveOgOwnerPubkey } from "@/lib/seo/og-owner-pubkey";

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
  timeoutMs = 1500
): Promise<RepoAnnouncementMeta> {
  try {
    const ownerPubkey = await resolveOgOwnerPubkey(
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
          const timeout = setTimeout(() => {
            if (!resolved) {
              resolved = true;
              try {
                pool?.close();
              } catch {
                /* ignore */
              }
              resolve(EMPTY);
            }
          }, timeoutMs);

          try {
            pool.subscribe(
              [
                {
                  kinds: [KIND_REPOSITORY, KIND_REPOSITORY_NIP34],
                  authors: [ownerPubkey],
                  "#d": [repoName],
                  limit: 1,
                },
              ],
              DEFAULT_RELAYS,
              (event: { content?: string; tags?: string[][] }) => {
                if (resolved) return;
                resolved = true;
                clearTimeout(timeout);
                try {
                  pool?.close();
                } catch {
                  /* ignore */
                }

                try {
                  const content = JSON.parse(event.content || "{}");
                  const description =
                    (typeof content.description === "string"
                      ? content.description
                      : null) || null;
                  const descTag = event.tags?.find(
                    (t) => t[0] === "description"
                  );
                  const tagDescription =
                    typeof descTag?.[1] === "string" ? descTag[1] : null;

                  resolve({
                    description: description || tagDescription,
                    nostrPublicRead: isPublicReadFromEvent(
                      event as import("nostr-tools").Event
                    ),
                  });
                } catch {
                  resolve(EMPTY);
                }
              },
              undefined,
              () => {
                if (!resolved) {
                  resolved = true;
                  clearTimeout(timeout);
                  try {
                    pool?.close();
                  } catch {
                    /* ignore */
                  }
                  resolve(EMPTY);
                }
              }
            );
          } catch {
            if (!resolved) {
              resolved = true;
              clearTimeout(timeout);
              resolve(EMPTY);
            }
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
