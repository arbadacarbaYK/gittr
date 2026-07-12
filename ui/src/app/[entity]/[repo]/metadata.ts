import { buildRepoFallbackDescription } from "@/lib/seo/site-metadata";
import {
  resolveRepoIconForMetadata,
  resolveUserIconForMetadata,
} from "@/lib/utils/metadata-icon-resolver";
import { getPublicSiteUrl } from "@/lib/utils/public-site-url";
import {
  normalizeSocialImageUrl,
  openGraphImageDescriptor,
} from "@/lib/utils/social-image";

import { type Metadata } from "next";
import { nip19 } from "nostr-tools";

/**
 * Fast server-side function to fetch repository description from Nostr
 * Uses timeout to prevent blocking metadata generation
 */
async function fetchRepoDescription(
  entity: string,
  repoName: string,
  timeoutMs = 2000
): Promise<string | null> {
  try {
    // Resolve entity to pubkey
    let ownerPubkey: string | null = null;
    if (/^[0-9a-f]{64}$/i.test(entity)) {
      ownerPubkey = entity.toLowerCase();
    } else if (entity.startsWith("npub")) {
      try {
        const decoded = nip19.decode(entity);
        if (decoded.type === "npub") {
          ownerPubkey = (decoded.data as string).toLowerCase();
        }
      } catch {
        // Invalid npub
      }
    }

    if (!ownerPubkey) return null;

    // Query Nostr directly for repository event (kind 30617 or 51)
    // Use Promise.race with timeout to prevent blocking
    const queryPromise = (async () => {
      let pool: any = null;
      try {
        // Use dynamic import to avoid SSR issues
        const { RelayPool } = await import("nostr-relaypool");
        const { KIND_REPOSITORY, KIND_REPOSITORY_NIP34 } = await import(
          "@/lib/nostr/events"
        );

        const DEFAULT_RELAYS = [
          "wss://relay.damus.io",
          "wss://relay.noderunners.network",
          "wss://nos.lol",
          "wss://relay.ngit.dev",
          "wss://gitnostr.com",
          "wss://relay.azzamo.net",
        ];

        pool = new RelayPool(DEFAULT_RELAYS);

        return new Promise<string | null>((resolve) => {
          let resolved = false;
          const timeout = setTimeout(() => {
            if (!resolved) {
              resolved = true;
              try {
                pool?.close();
              } catch (closeError) {
                // Ignore errors during cleanup
              }
              resolve(null);
            }
          }, timeoutMs);

          try {
            pool.subscribe(
              [
                {
                  kinds: [KIND_REPOSITORY, KIND_REPOSITORY_NIP34],
                  authors: [ownerPubkey],
                  "#d": [repoName], // Query for specific repo
                  limit: 1,
                },
              ],
              DEFAULT_RELAYS,
              (event: any) => {
                if (resolved) return;
                resolved = true;
                clearTimeout(timeout);
                try {
                  pool?.close();
                } catch (closeError) {
                  // Ignore errors during cleanup
                }

                try {
                  // Parse NIP-34 event
                  const content = JSON.parse(event.content || "{}");
                  const description = content.description || null;

                  // Also check description tag (NIP-34 standard)
                  const descTag = event.tags.find(
                    (t: string[]) => t[0] === "description"
                  );
                  const tagDescription = descTag?.[1] || null;

                  resolve(description || tagDescription);
                } catch {
                  resolve(null);
                }
              },
              undefined,
              () => {
                // EOSE - no more events
                if (!resolved) {
                  resolved = true;
                  clearTimeout(timeout);
                  try {
                    pool?.close();
                  } catch (closeError) {
                    // Ignore errors during cleanup
                  }
                  resolve(null);
                }
              }
            );
          } catch (subscribeError) {
            // If subscribe() throws, ensure pool is closed and promise resolves
            if (!resolved) {
              resolved = true;
              clearTimeout(timeout);
              try {
                pool?.close();
              } catch (closeError) {
                // Ignore errors during cleanup
              }
              resolve(null);
            }
          }
        });
      } catch (error) {
        // Ensure pool is closed even if error occurs before subscribe
        try {
          pool?.close();
        } catch (closeError) {
          // Ignore errors during cleanup
        }
        // Timeout or other error - return null to use fallback
        console.warn("[Metadata] Failed to fetch repo description:", error);
        return null;
      }
    })();

    const timeoutPromise = new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), timeoutMs)
    );

    return await Promise.race([queryPromise, timeoutPromise]);
  } catch (error) {
    console.warn("[Metadata] Error fetching repo description:", error);
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ entity: string; repo: string }>;
}): Promise<Metadata> {
  // CRITICAL: Log immediately to verify function is being called
  console.log("[Metadata] generateMetadata called");

  try {
    const resolvedParams = await params;
    const baseUrl = getPublicSiteUrl();

    // Safely decode repo name - handle invalid percent-encoding gracefully
    let decodedRepo: string;
    try {
      decodedRepo = decodeURIComponent(resolvedParams.repo);
    } catch (decodeError) {
      // If decoding fails (e.g., invalid % encoding like %ZZ), use original string
      console.warn(
        "[Metadata] Failed to decode repo name, using original:",
        decodeError
      );
      decodedRepo = resolvedParams.repo;
    }

    // Debug logging
    console.log(
      "[Metadata] Generating metadata for:",
      resolvedParams.entity,
      decodedRepo
    );

    // Format owner name (convert pubkey to npub if needed)
    let ownerName = resolvedParams.entity;
    let ownerPubkey: string | null = null;
    try {
      if (/^[0-9a-f]{64}$/i.test(resolvedParams.entity)) {
        ownerPubkey = resolvedParams.entity.toLowerCase();
        ownerName = nip19.npubEncode(resolvedParams.entity);
      } else if (resolvedParams.entity.startsWith("npub")) {
        ownerName = resolvedParams.entity;
        try {
          const decoded = nip19.decode(resolvedParams.entity);
          if (decoded.type === "npub") {
            ownerPubkey = (decoded.data as string).toLowerCase();
          }
        } catch {
          // Invalid npub
        }
      }
    } catch {
      // Use entity as-is
    }

    const url = `${baseUrl}/${encodeURIComponent(
      resolvedParams.entity
    )}/${encodeURIComponent(decodedRepo)}`;

    // Fetch owner's actual name from Nostr (kind 0 metadata) - with timeout
    let ownerDisplayName = ownerName; // Fallback to npub/entity
    if (ownerPubkey) {
      try {
        const { fetchUserMetadata } = await import(
          "@/lib/nostr/fetch-metadata-server"
        );
        const ownerMetadata = await Promise.race([
          fetchUserMetadata(ownerPubkey),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 1000)),
        ]);

        if (ownerMetadata) {
          // Use owner's actual name from Nostr if available
          // CRITICAL: Validate that name/display_name are actually strings
          // Nostr metadata is parsed JSON and could contain any type
          const nameValue = ownerMetadata.name;
          const displayNameValue = ownerMetadata.display_name;

          // Only use if it's a non-empty string
          if (typeof nameValue === "string" && nameValue.trim().length > 0) {
            ownerDisplayName = nameValue;
          } else if (
            typeof displayNameValue === "string" &&
            displayNameValue.trim().length > 0
          ) {
            ownerDisplayName = displayNameValue;
          }
          // Otherwise keep the fallback (ownerName)

          console.log("[Metadata] Owner display name:", ownerDisplayName);
        }
      } catch (error) {
        console.warn(
          "[Metadata] Failed to fetch owner metadata, using fallback:",
          error
        );
      }
    }

    const title = `${ownerDisplayName}/${decodedRepo}`;

    // Fetch repo description (with timeout to keep it fast) - make it non-blocking
    // Start the fetch but don't wait for it - use a fast fallback
    const repoDescriptionPromise = fetchRepoDescription(
      resolvedParams.entity,
      decodedRepo,
      1500
    );

    // Resolve icon: repo announcement logo → bridge logo OG endpoint → owner picture → default card
    const defaultCard = `${baseUrl}/opengraph-image`;
    const iconUrlPromise = (async () => {
      try {
        let resolvedIcon = await resolveRepoIconForMetadata(
          resolvedParams.entity,
          decodedRepo,
          baseUrl
        );
        if (!resolvedIcon.startsWith("http")) {
          resolvedIcon = `${baseUrl}${
            resolvedIcon.startsWith("/") ? "" : "/"
          }${resolvedIcon}`;
        }
        if (resolvedIcon !== defaultCard) {
          return resolvedIcon;
        }
        if (ownerPubkey) {
          const ownerIcon = await resolveUserIconForMetadata(
            resolvedParams.entity,
            baseUrl,
            1000
          );
          if (ownerIcon && ownerIcon !== defaultCard && ownerIcon.startsWith("https://")) {
            return ownerIcon;
          }
        }
        return defaultCard;
      } catch {
        return defaultCard;
      }
    })();

    const [repoDescription, resolvedIconUrl] = await Promise.race([
      Promise.all([repoDescriptionPromise, iconUrlPromise]),
      new Promise<[string | null, string]>((resolve) =>
        setTimeout(() => resolve([null, defaultCard]), 2000)
      ),
    ]).catch(() => [null, defaultCard] as [string | null, string]);

    const iconUrl = normalizeSocialImageUrl(resolvedIconUrl || defaultCard, baseUrl);

    // Build description text - use repo description if available, otherwise generic
    const description = repoDescription
      ? repoDescription.length > 160
        ? repoDescription.substring(0, 157) + "..."
        : repoDescription
      : buildRepoFallbackDescription(resolvedParams.entity, decodedRepo);

    console.log("[Metadata] Final metadata:", {
      title,
      description: description.substring(0, 50),
      iconUrl,
    });

    return {
      title,
      description,
      keywords: [
        "git",
        "nostr",
        "repository",
        "decentralized",
        "nostr git",
        decodedRepo,
      ],
      openGraph: {
        title,
        description,
        url,
        type: "website",
        siteName: "gittr",
        images: [
          openGraphImageDescriptor(
            iconUrl,
            baseUrl,
            `${decodedRepo} repository on gittr`
          ),
        ],
      },
      twitter: {
        card: "summary_large_image",
        title,
        description,
        images: [iconUrl],
      },
      alternates: {
        canonical: url,
      },
    };
  } catch (error) {
    // If metadata generation fails, return basic metadata to prevent page crash
    console.error("[Metadata] Error generating metadata:", error);
    const baseUrl = getPublicSiteUrl();
    const resolvedParams = await params;

    // Safely decode repo name in error handler too
    let decodedRepo: string;
    try {
      decodedRepo = decodeURIComponent(resolvedParams.repo);
    } catch (decodeError) {
      decodedRepo = resolvedParams.repo;
    }

    const title = `${resolvedParams.entity}/${decodedRepo}`;

    return {
      title,
      description: buildRepoFallbackDescription(
        resolvedParams.entity,
        decodedRepo
      ),
      openGraph: {
        title,
        description: `Repository ${title} on gittr - Decentralized Git Hosting on Nostr`,
        url: `${baseUrl}/${encodeURIComponent(
          resolvedParams.entity
        )}/${encodeURIComponent(decodedRepo)}`,
        type: "website",
        siteName: "gittr",
        images: [
          {
            url: `${baseUrl}/opengraph-image`,
            width: 1200,
            height: 630,
            alt: `${decodedRepo} repository on gittr`,
          },
        ],
      },
      twitter: {
        card: "summary_large_image",
        title,
        description: `Repository ${title} on gittr - Decentralized Git Hosting on Nostr`,
        images: [`${baseUrl}/opengraph-image`],
      },
    };
  }
}
