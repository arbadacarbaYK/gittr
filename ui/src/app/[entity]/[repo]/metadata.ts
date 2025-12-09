import { Metadata } from 'next';
import { nip19 } from 'nostr-tools';
import { resolveRepoIconForMetadata, resolveUserIconForMetadata } from '@/lib/utils/metadata-icon-resolver';

/**
 * Fast server-side function to fetch repository description from Nostr
 * Uses timeout to prevent blocking metadata generation
 */
async function fetchRepoDescription(
  entity: string,
  repoName: string,
  timeoutMs: number = 2000
): Promise<string | null> {
  try {
    // Resolve entity to pubkey
    let ownerPubkey: string | null = null;
    if (/^[0-9a-f]{64}$/i.test(entity)) {
      ownerPubkey = entity.toLowerCase();
    } else if (entity.startsWith('npub')) {
      try {
        const decoded = nip19.decode(entity);
        if (decoded.type === 'npub') {
          ownerPubkey = (decoded.data as string).toLowerCase();
        }
      } catch {
        // Invalid npub
      }
    }

    if (!ownerPubkey) return null;

    // Query Nostr directly for repository event (kind 30617 or 51)
    // Use Promise.race with timeout to prevent blocking
    const queryPromise = (async () => {
      let pool: any = null;
      try {
        // Use dynamic import to avoid SSR issues
        const { RelayPool } = await import("nostr-relaypool");
        const { KIND_REPOSITORY, KIND_REPOSITORY_NIP34 } = await import("@/lib/nostr/events");
        
        const DEFAULT_RELAYS = [
          "wss://relay.damus.io",
          "wss://relay.noderunners.network",
          "wss://nos.lol",
          "wss://relay.ngit.dev",
          "wss://gitnostr.com",
        ];
        
        pool = new RelayPool(DEFAULT_RELAYS);
        
        return new Promise<string | null>((resolve) => {
          let resolved = false;
          const timeout = setTimeout(() => {
            if (!resolved) {
              resolved = true;
              try {
                pool?.close();
              } catch (closeError) {
                // Ignore errors during cleanup
              }
              resolve(null);
            }
          }, timeoutMs);
          
          try {
            pool.subscribe(
              [
                {
                  kinds: [KIND_REPOSITORY, KIND_REPOSITORY_NIP34],
                  authors: [ownerPubkey],
                  "#d": [repoName], // Query for specific repo
                  limit: 1,
                },
              ],
              DEFAULT_RELAYS,
              (event: any) => {
                if (resolved) return;
                resolved = true;
                clearTimeout(timeout);
                try {
                  pool?.close();
                } catch (closeError) {
                  // Ignore errors during cleanup
                }
                
                try {
                  // Parse NIP-34 event
                  const content = JSON.parse(event.content || "{}");
                  const description = content.description || null;
                  
                  // Also check description tag (NIP-34 standard)
                  const descTag = event.tags.find((t: string[]) => t[0] === "description");
                  const tagDescription = descTag?.[1] || null;
                  
                  resolve(description || tagDescription);
                } catch {
                  resolve(null);
                }
              },
              undefined,
              () => {
                // EOSE - no more events
                if (!resolved) {
                  resolved = true;
                  clearTimeout(timeout);
                  try {
                    pool?.close();
                  } catch (closeError) {
                    // Ignore errors during cleanup
                  }
                  resolve(null);
                }
              }
            );
          } catch (subscribeError) {
            // If subscribe() throws, ensure pool is closed and promise resolves
            if (!resolved) {
              resolved = true;
              clearTimeout(timeout);
              try {
                pool?.close();
              } catch (closeError) {
                // Ignore errors during cleanup
              }
              resolve(null);
            }
          }
        });
      } catch (error) {
        // Ensure pool is closed even if error occurs before subscribe
        try {
          pool?.close();
        } catch (closeError) {
          // Ignore errors during cleanup
        }
        // Timeout or other error - return null to use fallback
        console.warn('[Metadata] Failed to fetch repo description:', error);
        return null;
      }
    })();

    const timeoutPromise = new Promise<null>((resolve) => 
      setTimeout(() => resolve(null), timeoutMs)
    );

    return await Promise.race([queryPromise, timeoutPromise]);
  } catch (error) {
    console.warn('[Metadata] Error fetching repo description:', error);
    return null;
  }
}

export async function generateMetadata(
  { params }: { params: Promise<{ entity: string; repo: string }> }
): Promise<Metadata> {
  try {
    const resolvedParams = await params;
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://gittr.space';
    
    // Safely decode repo name - handle invalid percent-encoding gracefully
    let decodedRepo: string;
    try {
      decodedRepo = decodeURIComponent(resolvedParams.repo);
    } catch (decodeError) {
      // If decoding fails (e.g., invalid % encoding like %ZZ), use original string
      console.warn('[Metadata] Failed to decode repo name, using original:', decodeError);
      decodedRepo = resolvedParams.repo;
    }
    
    // Debug logging
    console.log('[Metadata] Generating metadata for:', resolvedParams.entity, decodedRepo);
  
  // Format owner name (convert pubkey to npub if needed)
  let ownerName = resolvedParams.entity;
  let ownerPubkey: string | null = null;
  try {
    if (/^[0-9a-f]{64}$/i.test(resolvedParams.entity)) {
      ownerPubkey = resolvedParams.entity.toLowerCase();
      ownerName = nip19.npubEncode(resolvedParams.entity);
    } else if (resolvedParams.entity.startsWith('npub')) {
      ownerName = resolvedParams.entity;
      try {
        const decoded = nip19.decode(resolvedParams.entity);
        if (decoded.type === 'npub') {
          ownerPubkey = (decoded.data as string).toLowerCase();
        }
      } catch {
        // Invalid npub
      }
    }
  } catch {
    // Use entity as-is
  }
  
  const title = `${ownerName}/${decodedRepo}`;
  const url = `${baseUrl}/${encodeURIComponent(resolvedParams.entity)}/${encodeURIComponent(decodedRepo)}`;
  
  // Fetch repo description (with timeout to keep it fast)
  const repoDescription = await fetchRepoDescription(resolvedParams.entity, decodedRepo, 2000);
  
  // Build description text - use repo description if available, otherwise generic
  const description = repoDescription 
    ? repoDescription.length > 160 
      ? repoDescription.substring(0, 157) + '...'
      : repoDescription
    : `Repository ${title} on gittr - Decentralized Git Hosting on Nostr. A censorship-resistant alternative to GitHub.`;
  
  // Resolve repository icon URL for Open Graph
  // Priority: repo logo -> owner profile picture -> default logo
  let iconUrl = `${baseUrl}/logo.svg`; // Default fallback
  try {
    // Try repo logo first
    iconUrl = await resolveRepoIconForMetadata(
      resolvedParams.entity,
      decodedRepo,
      baseUrl
    );
    
    // Ensure iconUrl is absolute
    if (!iconUrl.startsWith('http')) {
      iconUrl = `${baseUrl}${iconUrl.startsWith('/') ? '' : '/'}${iconUrl}`;
    }
    
    // If repo logo is just the default, try owner profile picture
    if (iconUrl === `${baseUrl}/logo.svg` && ownerPubkey) {
      try {
        const ownerIcon = await resolveUserIconForMetadata(resolvedParams.entity, baseUrl, 1000);
        if (ownerIcon !== `${baseUrl}/logo.svg`) {
          iconUrl = ownerIcon;
        }
      } catch (error) {
        // Fall back to default logo
        console.warn('[Metadata] Failed to fetch owner icon:', error);
      }
    }
  } catch (error) {
    // If resolution fails, use default logo
    console.warn('[Metadata] Failed to resolve repo icon, using default:', error);
  }
  
  return {
    title,
    description,
    keywords: ['git', 'nostr', 'repository', 'decentralized', 'censorship-resistant', decodedRepo],
    openGraph: {
      title,
      description,
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
      description,
      images: [iconUrl],
    },
    alternates: {
      canonical: url,
    },
  };
  } catch (error) {
    // If metadata generation fails, return basic metadata to prevent page crash
    console.error('[Metadata] Error generating metadata:', error);
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://gittr.space';
    const resolvedParams = await params;
    
    // Safely decode repo name in error handler too
    let decodedRepo: string;
    try {
      decodedRepo = decodeURIComponent(resolvedParams.repo);
    } catch (decodeError) {
      decodedRepo = resolvedParams.repo;
    }
    
    const title = `${resolvedParams.entity}/${decodedRepo}`;
    
    return {
      title,
      description: `Repository ${title} on gittr - Decentralized Git Hosting on Nostr. A censorship-resistant alternative to GitHub.`,
      openGraph: {
        title,
        description: `Repository ${title} on gittr - Decentralized Git Hosting on Nostr`,
        url: `${baseUrl}/${encodeURIComponent(resolvedParams.entity)}/${encodeURIComponent(decodedRepo)}`,
        type: 'website',
        siteName: 'gittr',
        images: [{ url: `${baseUrl}/logo.svg`, width: 1200, height: 630, alt: `${decodedRepo} repository on gittr` }],
      },
      twitter: {
        card: 'summary_large_image',
        title,
        description: `Repository ${title} on gittr - Decentralized Git Hosting on Nostr`,
        images: [`${baseUrl}/logo.svg`],
      },
    };
  }
}

