import { getPublicSiteUrl } from "@/lib/utils/public-site-url";
import { normalizeSocialImageUrl } from "@/lib/utils/social-image";

import { type Metadata } from "next";

import {
  SITE_DESCRIPTION_DEFAULT,
  SITE_KEYWORDS,
  SITE_TITLE_DEFAULT,
} from "./site-copy";

export {
  APPS_DESCRIPTION,
  BOUNTY_HUNT_DESCRIPTION,
  EXPLORE_DESCRIPTION,
  HELP_DESCRIPTION,
  ISSUES_DESCRIPTION,
  LAB_DESCRIPTION,
  NEW_DESCRIPTION,
  NOSTR_GIT_DESCRIPTION,
  PAGES_DESCRIPTION,
  PULLS_DESCRIPTION,
  SITE_DESCRIPTION_DEFAULT,
  SITE_KEYWORDS,
  SITE_TITLE_DEFAULT,
  buildRepoFallbackDescription,
  buildSoftwareAppDescription,
} from "./site-copy";

const OG_IMAGE_ALT = "gittr - Nostr git hosting";

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
  robots?: Metadata["robots"];
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
    ...(opts.robots ? { robots: opts.robots } : {}),
  };
}

export function buildNoindexPageMetadata(opts: {
  path: string;
  title: string;
  description: string;
}): Metadata {
  return buildPageSiteMetadata({
    ...opts,
    robots: { index: false, follow: false },
  });
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
    appleWebApp: {
      capable: true,
      statusBarStyle: "black-translucent",
      title: "gittr",
    },
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
