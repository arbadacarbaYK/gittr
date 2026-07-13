import { KIND_REPOSITORY, KIND_REPOSITORY_NIP34 } from "@/lib/nostr/events";
import { isPublicReadFromEvent } from "@/lib/nostr/repo-public-read";

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
    let ownerPubkey: string | null = null;
    if (/^[0-9a-f]{64}$/i.test(entity)) {
      ownerPubkey = entity.toLowerCase();
    } else if (entity.startsWith("npub")) {
      const { nip19 } = await import("nostr-tools");
      try {
        const decoded = nip19.decode(entity);
        if (decoded.type === "npub") {
          ownerPubkey = (decoded.data as string).toLowerCase();
        }
      } catch {
        /* invalid npub */
      }
    }

    if (!ownerPubkey) return EMPTY;

    const queryPromise = (async () => {
      let pool: any = null;
      try {
        const { RelayPool } = await import("nostr-relaypool");

        const DEFAULT_RELAYS = [
          "wss://relay.damus.io",
          "wss://relay.noderunners.network",
          "wss://nos.lol",
          "wss://relay.ngit.dev",
          "wss://gitnostr.com",
          "wss://relay.azzamo.net",
        ];

        pool = new RelayPool(DEFAULT_RELAYS);

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
              (event: {
                content?: string;
                tags?: string[][];
              }) => {
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
                  const descTag = event.tags?.find((t) => t[0] === "description");
                  const tagDescription =
                    typeof descTag?.[1] === "string" ? descTag[1] : null;

                  resolve({
                    description: description || tagDescription,
                    nostrPublicRead: isPublicReadFromEvent(event as import("nostr-tools").Event),
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

    const timeoutPromise = new Promise<RepoAnnouncementMeta>((resolve) =>
      setTimeout(() => resolve(EMPTY), timeoutMs)
    );

    return await Promise.race([queryPromise, timeoutPromise]);
  } catch {
    return EMPTY;
  }
}
