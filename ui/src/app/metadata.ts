import { Metadata } from "next";

// Default metadata for the site
// Next.js App Router will pick this up automatically
export const metadata: Metadata = {
  title: {
    default: "gittr - Decentralized Git Hosting on Nostr",
    template: "%s | gittr",
  },
  description:
    "A truly censorship-resistant alternative to GitHub built on Nostr. Host your repositories on a decentralized network.",
  keywords: [
    "git",
    "nostr",
    "decentralized",
    "censorship-resistant",
    "github alternative",
    "git hosting",
    "nostr git",
  ],
  authors: [{ name: "gittr" }],
  creator: "gittr",
  publisher: "gittr",
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL || "https://gittr.space"
  ),
  openGraph: {
    type: "website",
    locale: "en_US",
    url: process.env.NEXT_PUBLIC_SITE_URL || "https://gittr.space",
    siteName: "gittr",
    title: "gittr - Decentralized Git Hosting on Nostr",
    description:
      "A truly censorship-resistant alternative to GitHub built on Nostr.",
    images: [
      {
        url: "/logo.svg",
        width: 1200,
        height: 630,
        alt: "gittr logo",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "gittr - Decentralized Git Hosting on Nostr",
    description:
      "A truly censorship-resistant alternative to GitHub built on Nostr.",
    images: ["/logo.svg"],
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
    canonical: process.env.NEXT_PUBLIC_SITE_URL || "https://gittr.space",
  },
  manifest: "/site.webmanifest",
};
