import { getPublicSiteUrl } from "@/lib/utils/public-site-url";

import { type Metadata } from "next";

/** Default site title (also used in Open Graph / Twitter). */
export const SITE_TITLE_DEFAULT =
  "gittr — Nostr git, issues, PRs & Lightning bounties";

/** ~155 chars — good for Google snippets and social cards. */
export const SITE_DESCRIPTION_DEFAULT =
  "Mirror git repos to Nostr relays, run issues and pull requests with signed events, publish gittr Pages, discover Nostr apps, and fund work with Lightning bounties.";

export const SITE_KEYWORDS = [
  "nostr git",
  "NIP-34",
  "GRASP",
  "git hosting",
  "mirror repository",
  "git collaboration",
  "Lightning bounties",
  "nostr pages",
  "nostr apps",
  "decentralized git",
  "git over nostr",
  "issue bounties",
] as const;

export function buildRepoFallbackDescription(
  entity: string,
  repo: string
): string {
  return `Repository ${entity}/${repo} on gittr — Nostr git with issues, pull requests, and optional Lightning bounties.`;
}

export function buildRootSiteMetadata(): Metadata {
  const siteUrl = getPublicSiteUrl();

  return {
    title: {
      default: SITE_TITLE_DEFAULT,
      template: "%s | gittr",
    },
    description: SITE_DESCRIPTION_DEFAULT,
    keywords: [...SITE_KEYWORDS],
    authors: [{ name: "gittr" }],
    creator: "gittr",
    publisher: "gittr",
    metadataBase: new URL(siteUrl),
    openGraph: {
      type: "website",
      locale: "en_US",
      url: siteUrl,
      siteName: "gittr",
      title: SITE_TITLE_DEFAULT,
      description: SITE_DESCRIPTION_DEFAULT,
      images: [
        {
          url: "/opengraph-image",
          width: 1200,
          height: 630,
          alt: "gittr - Decentralized Git on Nostr",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: SITE_TITLE_DEFAULT,
      description: SITE_DESCRIPTION_DEFAULT,
      images: ["/opengraph-image"],
    },
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        "max-video-preview": -1,
        "max-image-preview": "large",
        "max-snippet": -1,
      },
    },
    alternates: {
      canonical: siteUrl,
    },
  };
}
