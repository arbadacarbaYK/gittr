import { Metadata } from 'next';
import { nip19 } from 'nostr-tools';
import { resolveUserIconForMetadata } from '@/lib/utils/metadata-icon-resolver';

export async function generateMetadata(
  { params }: { params: Promise<{ entity: string }> }
): Promise<Metadata> {
  const resolvedParams = await params;
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://gittr.space';
  
  // Try to decode npub to get pubkey
  let pubkey: string | null = null;
  let displayName = resolvedParams.entity;
  
  try {
    if (resolvedParams.entity.startsWith('npub')) {
      const decoded = nip19.decode(resolvedParams.entity);
      if (decoded.type === 'npub') {
        pubkey = decoded.data as string;
      }
    } else if (/^[0-9a-f]{64}$/i.test(resolvedParams.entity)) {
      pubkey = resolvedParams.entity;
      try {
        displayName = nip19.npubEncode(pubkey);
      } catch {}
    }
  } catch (error) {
    // Use entity as-is
  }
  
  const title = displayName;
  const url = `${baseUrl}/${encodeURIComponent(resolvedParams.entity)}`;
  
  // Resolve user icon (profile picture or default)
  let iconUrl = `${baseUrl}/logo.svg`; // Default fallback
  try {
    iconUrl = await resolveUserIconForMetadata(resolvedParams.entity, baseUrl);
  } catch (error) {
    // If resolution fails, use default
    console.warn('[Metadata] Failed to resolve user icon, using default:', error);
  }
  
  // Ensure iconUrl is absolute
  if (!iconUrl.startsWith('http')) {
    iconUrl = `${baseUrl}${iconUrl.startsWith('/') ? '' : '/'}${iconUrl}`;
  }
  
  return {
    title,
    description: `Profile for ${displayName} on gittr - Decentralized Git Hosting on Nostr`,
    openGraph: {
      title,
      description: `View ${displayName}'s repositories on gittr`,
      url,
      type: 'profile',
      siteName: 'gittr',
      images: [
        {
          url: iconUrl,
          width: 1200,
          height: 630,
          alt: `${displayName} profile on gittr`,
        },
      ],
    },
    twitter: {
      card: 'summary',
      title,
      description: `View ${displayName}'s repositories on gittr`,
      images: [iconUrl],
    },
    alternates: {
      canonical: url,
    },
  };
}

