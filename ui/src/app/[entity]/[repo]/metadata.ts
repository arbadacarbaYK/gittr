import { Metadata } from 'next';
import { nip19 } from 'nostr-tools';
import { resolveRepoIconForMetadata } from '@/lib/utils/metadata-icon-resolver';

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
  
  // Resolve repository icon URL for Open Graph
  // We construct URLs based on common patterns - the browser/social media crawler will fetch them
  let iconUrl = `${baseUrl}/logo.svg`; // Default fallback
  try {
    iconUrl = await resolveRepoIconForMetadata(
      params.entity,
      decodedRepo,
      baseUrl
    );
    
    // Ensure iconUrl is absolute
    if (!iconUrl.startsWith('http')) {
      iconUrl = `${baseUrl}${iconUrl.startsWith('/') ? '' : '/'}${iconUrl}`;
    }
  } catch (error) {
    // If resolution fails, use default logo
    console.warn('[Metadata] Failed to resolve repo icon, using default:', error);
  }
  
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
          url: iconUrl,
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
      images: [iconUrl],
    },
    alternates: {
      canonical: url,
    },
  };
}

