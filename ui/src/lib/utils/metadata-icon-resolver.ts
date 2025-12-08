/**
 * Server-side utility for resolving repository icons and user profile pictures
 * for Open Graph metadata generation.
 * 
 * This mirrors the client-side logo resolution logic but works server-side
 * without requiring localStorage or client-side hooks.
 */

import { nip19 } from 'nostr-tools';

/**
 * Resolves entity (npub or pubkey) to full pubkey
 */
function resolveEntityToPubkey(entity: string): string | null {
  if (!entity) return null;
  
  if (/^[0-9a-f]{64}$/i.test(entity)) {
    return entity.toLowerCase();
  }
  
  if (entity.startsWith('npub')) {
    try {
      const decoded = nip19.decode(entity);
      if (decoded.type === 'npub') {
        return decoded.data as string;
      }
    } catch {
      // Invalid npub
    }
  }
  
  return null;
}

/**
 * Resolves repository icon URL for Open Graph metadata
 * 
 * Priority:
 * 1. Logo file from repo (logo.png, logo.svg, etc.) - via API endpoint for Nostr-native repos
 * 2. Platform default
 * 
 * Note: We construct URLs based on common patterns. The browser/social media crawler
 * will fetch them. If a logo doesn't exist, it will fall back to the default.
 */
export async function resolveRepoIconForMetadata(
  entity: string,
  repoName: string,
  baseUrl: string
): Promise<string> {
  const decodedRepo = decodeURIComponent(repoName);
  const ownerPubkey = resolveEntityToPubkey(entity);
  
  // For Nostr-native repos, try API endpoint for logo files
  if (ownerPubkey && /^[0-9a-f]{64}$/i.test(ownerPubkey)) {
    // Clean repo name (handle paths like "gitnostr.com/gitworkshop")
    let cleanRepoName = decodedRepo;
    if (cleanRepoName.includes('/')) {
      const parts = cleanRepoName.split('/');
      cleanRepoName = parts[parts.length - 1] || cleanRepoName;
    }
    cleanRepoName = cleanRepoName.replace(/\.git$/, '');
    
    // Try logo.png first (most common), then logo.svg
    // The browser will try to fetch these URLs - if they don't exist, it will fall back
    const logoPath = 'logo.png';
    return `${baseUrl}/api/nostr/repo/file-content?ownerPubkey=${encodeURIComponent(ownerPubkey)}&repo=${encodeURIComponent(cleanRepoName)}&path=${encodeURIComponent(logoPath)}&branch=main`;
  }
  
  // Fallback to platform default
  return `${baseUrl}/logo.svg`;
}

/**
 * Resolves user profile picture URL for Open Graph metadata
 * 
 * Priority:
 * 1. Nostr profile picture (from metadata)
 * 2. Platform default
 */
export async function resolveUserIconForMetadata(
  entity: string,
  baseUrl: string,
  timeoutMs: number = 1000
): Promise<string> {
  const ownerPubkey = resolveEntityToPubkey(entity);
  
  if (!ownerPubkey) {
    return `${baseUrl}/logo.svg`;
  }
  
  try {
    // Fetch user metadata with timeout to keep it fast
    const { fetchUserMetadata } = await import("@/lib/nostr/fetch-metadata-server");
    const ownerMetadata = await Promise.race([
      fetchUserMetadata(ownerPubkey),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs))
    ]);
    
    if (ownerMetadata?.picture && ownerMetadata.picture.startsWith('http')) {
      return ownerMetadata.picture;
    }
  } catch (error) {
    // Fall back to default logo
    console.warn('[Metadata Icon Resolver] Failed to fetch user metadata:', error);
  }
  
  return `${baseUrl}/logo.svg`;
}

