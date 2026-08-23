import { Suspense } from "react";

import { isRepoPubliclyIndexable } from "@/lib/repo-read-access";
import { fetchRepoAnnouncementMeta } from "@/lib/seo/fetch-repo-announcement-meta";
import { isRscClientNavigation } from "@/lib/seo/is-rsc-client-navigation";
import { buildRepoFallbackDescription } from "@/lib/seo/site-metadata";
import { getPublicSiteUrl } from "@/lib/utils/public-site-url";
import { openGraphImageDescriptor } from "@/lib/utils/social-image";

import { type Metadata } from "next";
import { nip19 } from "nostr-tools";

import RepoLayoutClient from "./layout-client";

// Force dynamic rendering so social crawlers get fresh title/description.
export const dynamic = "force-dynamic";

function decodeRepoParam(repo: string): string {
  try {
    return decodeURIComponent(repo);
  } catch {
    return repo;
  }
}

/** Lightweight title for soft tab clicks — no Nostr/SQLite. */
function softNavMetadata(
  entity: string,
  decodedRepo: string,
  baseUrl: string
): Metadata {
  const title = `${entity}/${decodedRepo}`;
  const description = buildRepoFallbackDescription(entity, decodedRepo);
  const url = `${baseUrl}/${encodeURIComponent(entity)}/${encodeURIComponent(decodedRepo)}`;
  return {
    title,
    description,
    alternates: { canonical: url },
  };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ entity: string; repo: string }>;
}): Promise<Metadata> {
  const devMeta = process.env.NODE_ENV !== "production";

  try {
    const resolvedParams = await params;
    const baseUrl = getPublicSiteUrl();
    const decodedRepo = decodeRepoParam(resolvedParams.repo);

    // Soft client navigations (Code ↔ ToDo ↔ Issues) must not open RelayPools
    // or hit SQLite — that stalled RSC ~2–8s and triggered hard location.assign.
    if (await isRscClientNavigation()) {
      if (devMeta) {
        console.log(
          "[Metadata] RSC soft-nav fast path:",
          resolvedParams.entity,
          decodedRepo
        );
      }
      return softNavMetadata(resolvedParams.entity, decodedRepo, baseUrl);
    }

    if (devMeta) {
      console.log(
        "[Metadata] Generating metadata for:",
        resolvedParams.entity,
        decodedRepo
      );
    }

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

    const pathEntity = encodeURIComponent(resolvedParams.entity);
    const pathRepo = encodeURIComponent(decodedRepo);
    const url = `${baseUrl}/${pathEntity}/${pathRepo}`;
    // Composed dark card. ?v= busts X/Telegram when only a dependency file changed
    // (Next’s content-hash on this route may not move).
    const cardUrl = `${url}/opengraph-image?v=fastog1`;

    let ownerDisplayName = ownerName;
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
          const nameValue = ownerMetadata.name;
          const displayNameValue = ownerMetadata.display_name;

          if (typeof nameValue === "string" && nameValue.trim().length > 0) {
            ownerDisplayName = nameValue;
          } else if (
            typeof displayNameValue === "string" &&
            displayNameValue.trim().length > 0
          ) {
            ownerDisplayName = displayNameValue;
          }
        }
      } catch (error) {
        console.warn(
          "[Metadata] Failed to fetch owner metadata, using fallback:",
          error
        );
      }
    }

    const title = `${ownerDisplayName}/${decodedRepo}`;

    const repoMeta = await Promise.race([
      fetchRepoAnnouncementMeta(resolvedParams.entity, decodedRepo, 1500),
      new Promise<{ description: string | null; nostrPublicRead: boolean }>(
        (resolve) =>
          setTimeout(
            () => resolve({ description: null, nostrPublicRead: true }),
            2000
          )
      ),
    ]).catch(() => ({ description: null, nostrPublicRead: true }));

    const repoDescription = repoMeta.description;

    let indexable = true;
    if (ownerPubkey) {
      indexable = await isRepoPubliclyIndexable(
        ownerPubkey,
        decodedRepo,
        repoMeta.nostrPublicRead
      );
    }

    const description = repoDescription
      ? repoDescription.length > 160
        ? repoDescription.substring(0, 157) + "..."
        : repoDescription
      : buildRepoFallbackDescription(resolvedParams.entity, decodedRepo);

    if (devMeta) {
      console.log("[Metadata] Final metadata:", {
        title,
        description: description.substring(0, 50),
        cardUrl,
        indexable,
      });
    }

    const imageAlt = `${decodedRepo} repository on gittr`;

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
        images: [openGraphImageDescriptor(cardUrl, baseUrl, imageAlt)],
      },
      twitter: {
        card: "summary_large_image",
        title,
        description,
        images: [cardUrl],
      },
      alternates: {
        canonical: url,
      },
    };
  } catch (error) {
    console.error("[Metadata] Error generating metadata:", error);
    const baseUrl = getPublicSiteUrl();
    const resolvedParams = await params;

    let decodedRepo: string;
    try {
      decodedRepo = decodeURIComponent(resolvedParams.repo);
    } catch {
      decodedRepo = resolvedParams.repo;
    }

    const title = `${resolvedParams.entity}/${decodedRepo}`;
    const url = `${baseUrl}/${encodeURIComponent(
      resolvedParams.entity
    )}/${encodeURIComponent(decodedRepo)}`;
    const cardUrl = `${url}/opengraph-image?v=fastog1`;

    return {
      title,
      description: buildRepoFallbackDescription(
        resolvedParams.entity,
        decodedRepo
      ),
      openGraph: {
        title,
        description: `Repository ${title} on gittr - Decentralized Git on Nostr`,
        url,
        type: "website",
        siteName: "gittr",
        images: [
          openGraphImageDescriptor(
            cardUrl,
            baseUrl,
            `${decodedRepo} repository on gittr`
          ),
        ],
      },
      twitter: {
        card: "summary_large_image",
        title,
        description: `Repository ${title} on gittr - Decentralized Git on Nostr`,
        images: [cardUrl],
      },
    };
  }
}

export default function RepoLayout({
  children,
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
