import { Metadata } from 'next';
import { nip19 } from 'nostr-tools';

export async function generateMetadata(
  { params }: { params: { entity: string; repo: string } }
): Promise<Metadata> {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://gittr.space';
  const decodedRepo = decodeURIComponent(params.repo);
  
  // Format owner name (convert pubkey to npub if needed)
  let ownerName = params.entity;
  try {
    if (/^[0-9a-f]{64}$/i.test(params.entity)) {
      ownerName = nip19.npubEncode(params.entity);
    } else if (params.entity.startsWith('npub')) {
      ownerName = params.entity;
    }
  } catch {
    // Use entity as-is
  }
  
  const title = `${ownerName}/${decodedRepo}`;
  const url = `${baseUrl}/${encodeURIComponent(params.entity)}/${encodeURIComponent(decodedRepo)}`;
  
  return {
    title,
    description: `Repository ${title} on gittr - Decentralized Git Hosting on Nostr. A censorship-resistant alternative to GitHub.`,
    keywords: ['git', 'nostr', 'repository', 'decentralized', 'censorship-resistant', decodedRepo],
    openGraph: {
      title,
      description: `Repository ${title} on gittr - Decentralized Git Hosting on Nostr`,
      url,
      type: 'website',
      siteName: 'gittr',
      images: [
        {
          url: '/logo.svg',
          width: 1200,
          height: 630,
          alt: `${decodedRepo} repository on gittr`,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description: `Repository ${title} on gittr - Decentralized Git Hosting on Nostr`,
      images: ['/logo.svg'],
    },
    alternates: {
      canonical: url,
    },
  };
}

