/**
 * Repository Finder Utilities
 * 
 * Handles finding repositories by entity/repo with support for:
 * - npub format (Grasp protocol standard)
 * - 8-char pubkey prefixes
 * - Full 64-char pubkeys
 * - ownerPubkey matching
 */

import { nip19 } from "nostr-tools";

/**
 * Finds a repository by entity and repo name, supporting npub format
 * 
 * @param repos - Array of repository objects
 * @param entity - Entity identifier (npub, 8-char prefix, or full pubkey)
 * @param repoName - Repository name
 * @returns Repository object or undefined
 */
export function findRepoByEntityAndName<T extends { entity?: string; repo?: string; slug?: string; name?: string; ownerPubkey?: string }>(
  repos: T[],
  entity: string,
  repoName: string
): T | undefined {
  // CRITICAL: Decode npub if entity is npub format
  let entityPubkey: string | null = null;
  if (entity?.startsWith("npub")) {
    try {
      const decoded = nip19.decode(entity);
      if (decoded.type === "npub") {
        entityPubkey = decoded.data as string;
      }
    } catch {
      // Invalid npub, continue with entity as-is
    }
  }
  
  // Find repo by matching entity (8-char, npub, or full pubkey) OR by ownerPubkey
  return repos.find((r) => {
    // Match by repo name first (case-insensitive)
    const repoMatches = 
      (r.repo && r.repo.toLowerCase() === repoName.toLowerCase()) ||
      (r.slug && r.slug.toLowerCase() === repoName.toLowerCase()) ||
      (r.slug && r.slug.toLowerCase() === `${entity}/${repoName}`.toLowerCase()) ||
      (r.name && r.name.toLowerCase() === repoName.toLowerCase());
    if (!repoMatches) return false;
    
    // Match by entity (8-char prefix, npub, or full pubkey)
    if (r.entity === entity) return true;
    if (entityPubkey && r.entity === entityPubkey) return true;
    
    // Match by ownerPubkey (most reliable - works across all entity formats)
    if (entityPubkey && r.ownerPubkey && r.ownerPubkey.toLowerCase() === entityPubkey.toLowerCase()) return true;
    if (r.ownerPubkey === entity) return true;
    
    // Match by entity prefix (8-char)
    if (entity.length === 8 && r.entity && r.entity.toLowerCase().startsWith(entity.toLowerCase())) {
      return true;
    }
    
    return false;
  });
}

