import { isRepoPubliclyIndexable } from "@/lib/repo-read-access";
import { fetchRepoAnnouncementMeta } from "@/lib/seo/fetch-repo-announcement-meta";
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
import { Suspense } from "react";
import { nip19 } from "nostr-tools";

import RepoLayoutClient from "./layout-client";

// Cache configuration for link previews
// Force dynamic rendering to ensure fresh metadata for social media crawlers
// Social media platforms cache aggressively on their end, so we ensure our content is always fresh
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ entity: string; repo: string }>;
}): Promise<Metadata> {
  const devMeta = process.env.NODE_ENV !== "production";

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

    if (devMeta) {
      console.log(
        "[Metadata] Generating metadata for:",
        resolvedParams.entity,
        decodedRepo
      );
    }

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
    const repoMetaPromise = fetchRepoAnnouncementMeta(
      resolvedParams.entity,
      decodedRepo,
      1500
    );

    // Resolve repository icon URL for Open Graph (also non-blocking)
    // Priority: 1) repo picture (logo) 2) owner profile picture 3) gittr card
    const defaultCard = `${baseUrl}/opengraph-image`;
    let iconUrl = defaultCard;
    const iconUrlPromise = (async () => {
      try {
        // 1) Repository logo (file-content URL or default)
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
            console.log(
              "[Metadata] Using repo logo:",
              resolvedIcon.substring(0, 60)
            );
            return resolvedIcon;
          }
        } catch (error) {
          console.warn("[Metadata] Failed to resolve repo icon:", error);
        }

        // 2) Owner profile picture
        if (ownerPubkey) {
          try {
            const ownerIcon = await resolveUserIconForMetadata(
              resolvedParams.entity,
              baseUrl,
              1000
            );
            if (
              ownerIcon &&
              ownerIcon !== defaultCard &&
              ownerIcon.startsWith("http")
            ) {
              console.log(
                "[Metadata] Using owner profile picture:",
                ownerIcon.substring(0, 60)
              );
              return ownerIcon;
            }
          } catch (error) {
            console.warn("[Metadata] Failed to fetch owner icon:", error);
          }
        }

        return defaultCard;
      } catch (error) {
        console.warn(
          "[Metadata] Failed to resolve icon, using default:",
          error
        );
        return defaultCard;
      }
    })();

    // Wait for both with a timeout - if they take too long, use fallbacks
    const [repoMeta, resolvedIconUrl] = await Promise.race([
      Promise.all([repoMetaPromise, iconUrlPromise]),
      new Promise<
        [{ description: string | null; nostrPublicRead: boolean }, string]
      >((resolve) =>
        setTimeout(
          () =>
            resolve([
              { description: null, nostrPublicRead: true },
              `${baseUrl}/opengraph-image`,
            ]),
          2000
        )
      ),
    ]).catch(
      () =>
        [
          { description: null, nostrPublicRead: true },
          `${baseUrl}/opengraph-image`,
        ] as [{ description: string | null; nostrPublicRead: boolean }, string]
    );

    iconUrl = normalizeSocialImageUrl(resolvedIconUrl || iconUrl, baseUrl);

    const repoDescription = repoMeta.description;

    let indexable = true;
    if (ownerPubkey) {
      indexable = await isRepoPubliclyIndexable(
        ownerPubkey,
        decodedRepo,
        repoMeta.nostrPublicRead
      );
    }

    // Build description text - use repo description if available, otherwise generic
    const description = repoDescription
      ? repoDescription.length > 160
        ? repoDescription.substring(0, 157) + "..."
        : repoDescription
      : buildRepoFallbackDescription(resolvedParams.entity, decodedRepo);

    if (devMeta) {
      console.log("[Metadata] Final metadata:", {
        title,
        description: description.substring(0, 50),
        iconUrl,
        indexable,
      });
    }

    return {
      title,
      description,
      robots: indexable
        ? { index: true, follow: true }
        : { index: false, follow: false },
      keywords: [
        "nostr git",
        "NIP-34",
        "repository",
        "git hosting",
        "Lightning bounties",
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
        card: "summary_large_image", // X/Twitter requires summary_large_image for better image display
        title,
        description,
        images: [iconUrl], // Must be absolute URL, publicly accessible
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
          openGraphImageDescriptor(
            `${baseUrl}/opengraph-image`,
            baseUrl,
            `${decodedRepo} repository on gittr`
          ),
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

export default function RepoLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ entity: string; repo: string; subpage?: string }>;
}) {
  // useSearchParams() in RepoLayoutClient needs a Suspense boundary or soft
  // client navigations (tab clicks) can hang with no URL change.
  return (
    <Suspense
      fallback={
        <div className="p-6 text-sm text-[var(--color-text-secondary)]">
          Loading repository…
        </div>
      }
    >
      <RepoLayoutClient>{children}</RepoLayoutClient>
    </Suspense>
  );
}
