import { getPublicSiteUrl } from "@/lib/utils/public-site-url";
import { normalizeSocialImageUrl } from "@/lib/utils/social-image";

import { type Metadata } from "next";

/** Default site title (also used in Open Graph / Twitter). */
export const SITE_TITLE_DEFAULT =
  "gittr — Nostr git, issues, PRs & Lightning bounties";

/** ~155 chars — good for Google snippets and social cards. */
export const SITE_DESCRIPTION_DEFAULT =
  "Mirror git repos to Nostr relays, run issues and pull requests with signed events, publish gittr Pages, discover Nostr apps, and fund work with Lightning bounties.";

/** Hub routes: keep these distinct from the homepage card so Telegram/X previews match the link. */
export const APPS_DESCRIPTION =
  "Browse NIP-82 / Zapstore-style apps on Nostr — Android APKs announced from gittr repos, not a git hosting page.";

export const PAGES_DESCRIPTION =
  "Published static sites on Nostr (gittr Pages / nsite) — open each site on pages.gittr.space. Separate from git clone and the Apps catalog.";

export const LAB_DESCRIPTION =
  "Snapshot of an agent that maps ecosystem dependencies and their security, starting from gittr as the seed repo. Run local-agent yourself from the linked repo.";

export const EXPLORE_DESCRIPTION =
  "Explore public Nostr git repositories — browse announcements on relays (same list as Repos). Discover projects before you open Code, Issues, or zap the owner.";

export const NEW_DESCRIPTION =
  "Create a repository on Nostr git, or batch-import and mirror repos from GitHub, GitLab, Codeberg, and other foreign git sources onto gittr.";

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
  // Absolute HTTPS URLs — Telegram often drops previews when og:image is relative
  // or http:// after a scheme-less `gittr.space` paste.
  const ogImage = normalizeSocialImageUrl(imagePath, siteUrl);
  const twitterImage = normalizeSocialImageUrl(
    imagePath.replace("opengraph-image", "twitter-image"),
    siteUrl
  );
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
          url: ogImage,
          width: 1200,
          height: 630,
          alt: imageAlt,
          type: "image/png",
          secureUrl: ogImage,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: socialTitle,
      description: opts.description,
      images: [twitterImage],
    },
    alternates: {
      canonical,
    },
  };
}

export function buildRootSiteMetadata(): Metadata {
  const siteUrl = getPublicSiteUrl();
  const ogImage = normalizeSocialImageUrl("/opengraph-image", siteUrl);
  const twitterImage = normalizeSocialImageUrl("/twitter-image", siteUrl);

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
          url: ogImage,
          width: 1200,
          height: 630,
          alt: OG_IMAGE_ALT,
          type: "image/png",
          secureUrl: ogImage,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: SITE_TITLE_DEFAULT,
      description: SITE_DESCRIPTION_DEFAULT,
      images: [twitterImage],
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
