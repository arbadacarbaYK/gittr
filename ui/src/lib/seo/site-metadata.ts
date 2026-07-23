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

const OG_IMAGE_ALT = "gittr - Decentralized Git on Nostr";

function absolutePath(siteUrl: string, path: string): string {
  const base = siteUrl.replace(/\/$/, "");
  if (!path || path === "/") return base;
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * Per-route metadata so social crawlers (X, Telegram, …) get distinct
 * og:title / og:url / images instead of inheriting the homepage card.
 */
export function buildPageSiteMetadata(opts: {
  /** Absolute path, e.g. `/pages` or `/apps`. */
  path: string;
  /** Short title (layout template adds `| gittr` for the document title). */
  title: string;
  description: string;
  /**
   * Relative OG image path. Default root card; pass e.g. `/pages/opengraph-image`
   * when the route has its own image file.
   */
  imagePath?: string;
  imageAlt?: string;
}): Metadata {
  const siteUrl = getPublicSiteUrl();
  const canonical = absolutePath(siteUrl, opts.path);
  const imagePath = opts.imagePath ?? "/opengraph-image";
  const imageAlt = opts.imageAlt ?? OG_IMAGE_ALT;
  // Absolute title for OG/Twitter (crawlers ignore the Next title template).
  const socialTitle = opts.title.includes("gittr")
    ? opts.title
    : `${opts.title} | gittr`;

  return {
    title: opts.title,
    description: opts.description,
    openGraph: {
      type: "website",
      locale: "en_US",
      url: canonical,
      siteName: "gittr",
      title: socialTitle,
      description: opts.description,
      images: [
        {
          url: imagePath,
          width: 1200,
          height: 630,
          alt: imageAlt,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: socialTitle,
      description: opts.description,
      images: [imagePath.replace("opengraph-image", "twitter-image")],
    },
    alternates: {
      canonical,
    },
  };
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
          alt: OG_IMAGE_ALT,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: SITE_TITLE_DEFAULT,
      description: SITE_DESCRIPTION_DEFAULT,
      images: ["/twitter-image"],
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
