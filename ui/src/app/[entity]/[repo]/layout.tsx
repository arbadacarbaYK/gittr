import { Metadata } from 'next';
import { nip19 } from 'nostr-tools';
import { resolveRepoIconForMetadata, resolveUserIconForMetadata } from '@/lib/utils/metadata-icon-resolver';
import RepoLayoutClient from './layout-client';

// Cache configuration for link previews
// Force dynamic rendering to ensure fresh metadata for social media crawlers
// Social media platforms cache aggressively on their end, so we ensure our content is always fresh
export const dynamic = 'force-dynamic';

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
        const { nip19 } = await import('nostr-tools');
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
          "wss://relay.azzamo.net",
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
  // CRITICAL: Log immediately to verify function is being called
  console.log('[Metadata] ===== generateMetadata for [entity]/[repo] CALLED =====');
  
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
    
    const url = `${baseUrl}/${encodeURIComponent(resolvedParams.entity)}/${encodeURIComponent(decodedRepo)}`;
    
    // Fetch owner's actual name from Nostr (kind 0 metadata) - with timeout
    let ownerDisplayName = ownerName; // Fallback to npub/entity
    if (ownerPubkey) {
      try {
        const { fetchUserMetadata } = await import("@/lib/nostr/fetch-metadata-server");
        const ownerMetadata = await Promise.race([
          fetchUserMetadata(ownerPubkey),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 1000))
        ]);
        
        if (ownerMetadata) {
          // Use owner's actual name from Nostr if available
          // CRITICAL: Validate that name/display_name are actually strings
          // Nostr metadata is parsed JSON and could contain any type
          const nameValue = ownerMetadata.name;
          const displayNameValue = ownerMetadata.display_name;
          
          // Only use if it's a non-empty string
          if (typeof nameValue === 'string' && nameValue.trim().length > 0) {
            ownerDisplayName = nameValue;
          } else if (typeof displayNameValue === 'string' && displayNameValue.trim().length > 0) {
            ownerDisplayName = displayNameValue;
          }
          // Otherwise keep the fallback (ownerName)
          
          console.log('[Metadata] Owner display name:', ownerDisplayName);
        }
      } catch (error) {
        console.warn('[Metadata] Failed to fetch owner metadata, using fallback:', error);
      }
    }
    
    const title = `${ownerDisplayName}/${decodedRepo}`;
    
    // Fetch repo description (with timeout to keep it fast) - make it non-blocking
    // Start the fetch but don't wait for it - use a fast fallback
    const repoDescriptionPromise = fetchRepoDescription(resolvedParams.entity, decodedRepo, 1500);
    
    // Resolve repository icon URL for Open Graph (also non-blocking)
    // Priority: owner profile picture -> repo logo -> default logo
    // Note: We prioritize owner picture because repo logos may not exist
    let iconUrl = `${baseUrl}/logo.svg`; // Default fallback
    const iconUrlPromise = (async () => {
      try {
        // First, try owner profile picture (most reliable)
        if (ownerPubkey) {
          try {
            const ownerIcon = await resolveUserIconForMetadata(resolvedParams.entity, baseUrl, 1000);
            if (ownerIcon && ownerIcon !== `${baseUrl}/logo.svg` && ownerIcon.startsWith('http')) {
              console.log('[Metadata] Using owner profile picture:', ownerIcon.substring(0, 60));
              return ownerIcon;
            }
          } catch (error) {
            console.warn('[Metadata] Failed to fetch owner icon:', error);
          }
        }
        
        // Then try repo logo (may not exist, so this is secondary)
        try {
          let resolvedIcon = await resolveRepoIconForMetadata(
            resolvedParams.entity,
            decodedRepo,
            baseUrl
          );
          
          // Ensure iconUrl is absolute
          if (!resolvedIcon.startsWith('http')) {
            resolvedIcon = `${baseUrl}${resolvedIcon.startsWith('/') ? '' : '/'}${resolvedIcon}`;
          }
          
          // Only use repo logo if it's not the default
          if (resolvedIcon !== `${baseUrl}/logo.svg`) {
            console.log('[Metadata] Using repo logo:', resolvedIcon.substring(0, 60));
            return resolvedIcon;
          }
        } catch (error) {
          console.warn('[Metadata] Failed to resolve repo icon:', error);
        }
        
        // Fall back to default logo
        return `${baseUrl}/logo.svg`;
      } catch (error) {
        // If resolution fails, use default logo
        console.warn('[Metadata] Failed to resolve icon, using default:', error);
        return `${baseUrl}/logo.svg`;
      }
    })();
    
    // Wait for both with a timeout - if they take too long, use fallbacks
    const [repoDescription, resolvedIconUrl] = await Promise.race([
      Promise.all([repoDescriptionPromise, iconUrlPromise]),
      new Promise<[string | null, string]>((resolve) => 
        setTimeout(() => resolve([null, `${baseUrl}/logo.svg`]), 2000)
      )
    ]).catch(() => [null, `${baseUrl}/logo.svg`] as [string | null, string]);
    
    iconUrl = resolvedIconUrl || iconUrl;
    
    // Build description text - use repo description if available, otherwise generic
    const description = repoDescription 
      ? repoDescription.length > 160 
        ? repoDescription.substring(0, 157) + '...'
        : repoDescription
      : `Repository ${title} on gittr - Decentralized Git Hosting on Nostr. A censorship-resistant alternative to GitHub.`;
    
    console.log('[Metadata] Final metadata:', { title, description: description.substring(0, 50), iconUrl });
    
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
            width: 1200, // X/Twitter requires at least 300x157, but 1200x630 is recommended for summary_large_image
            height: 630,
            alt: `${decodedRepo} repository on gittr`,
          },
        ],
      },
      twitter: {
        card: 'summary_large_image', // X/Twitter requires summary_large_image for better image display
        title,
        description,
        images: [iconUrl], // Must be absolute URL, publicly accessible
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
        images: [{ url: `${baseUrl}/logo.svg`, width: 600, height: 600, alt: `${decodedRepo} repository on gittr` }],
      },
      twitter: {
        card: 'summary',
        title,
        description: `Repository ${title} on gittr - Decentralized Git Hosting on Nostr`,
        images: [`${baseUrl}/logo.svg`],
      },
    };
  }
}

export default function RepoLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ entity: string; repo: string; subpage?: string }>;
}) {
  return <RepoLayoutClient params={params}>{children}</RepoLayoutClient>;
}
