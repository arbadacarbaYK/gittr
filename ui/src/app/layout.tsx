// server component wrapper that exports metadata
// and imports the client layout component

import { Metadata } from 'next';
import ClientLayout from './layout-client';

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

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        {/* Structured Data (JSON-LD) for better search visibility */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "WebApplication",
              "name": "gittr",
              "url": metadata.metadataBase?.toString() || "https://gittr.space",
              "description": "Host your Git repositories on Nostr for enhanced discoverability and decentralized access. Make your code discoverable across the Nostr network while keeping your existing GitHub/GitLab workflow.",
              "applicationCategory": "DeveloperApplication",
              "operatingSystem": "Web",
              "offers": {
                "@type": "Offer",
                "price": "0",
                "priceCurrency": "USD"
              },
              "featureList": [
                "Git repository hosting on Nostr",
                "Enhanced repository discoverability",
                "Decentralized access via Nostr relays",
                "Bitcoin/Lightning payment integration",
                "GitHub/GitLab import support"
              ],
              "keywords": "git, nostr, decentralized, git hosting, repository discoverability, nostr repositories"
            }),
          }}
        />
        {/* Apply theme before React hydrates to prevent flash */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  const theme = localStorage.getItem('gittr_theme') || 'classic';
                  document.documentElement.setAttribute('data-theme', theme);
                  document.documentElement.classList.add('dark');
                } catch (e) {}
              })();
            `,
          }}
        />
      </head>
      <body className="dark">
        <ClientLayout>{children}</ClientLayout>
      </body>
    </html>
  );
}

