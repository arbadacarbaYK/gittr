import { Metadata } from 'next';

// Default metadata for the site
// Next.js App Router will pick this up automatically
export const metadata: Metadata = {
  title: {
    default: 'gittr - Host Your Repositories on Nostr for Better Discoverability',
    template: '%s | gittr',
  },
  description: 'Host your Git repositories on Nostr for enhanced discoverability and decentralized access. Make your code discoverable across the Nostr network while keeping your existing GitHub/GitLab workflow.',
  keywords: ['git', 'nostr', 'decentralized', 'git hosting', 'nostr git', 'repository discoverability', 'nostr repositories', 'decentralized git', 'nostr code hosting'],
  authors: [{ name: 'gittr' }],
  creator: 'gittr',
  publisher: 'gittr',
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || 'https://gittr.space'),
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: process.env.NEXT_PUBLIC_SITE_URL || 'https://gittr.space',
    siteName: 'gittr',
    title: 'gittr - Host Your Repositories on Nostr for Better Discoverability',
    description: 'Make your Git repositories discoverable on Nostr. Host your code on the decentralized Nostr network while keeping your existing GitHub/GitLab workflow.',
    images: [
      {
        url: '/logo.svg',
        width: 1200,
        height: 630,
        alt: 'gittr logo',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'gittr - Host Your Repositories on Nostr for Better Discoverability',
    description: 'Make your Git repositories discoverable on Nostr. Host your code on the decentralized Nostr network while keeping your existing GitHub/GitLab workflow.',
    images: ['/logo.svg'],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  alternates: {
    canonical: process.env.NEXT_PUBLIC_SITE_URL || 'https://gittr.space',
  },
};

