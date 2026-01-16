/**
 * Repository Finder Utilities
 *
 * Handles finding repositories by entity/repo with support for:
 * - npub format (Grasp protocol standard)
 * - NIP-05 identifiers (e.g., geek@primal.net) - for compatibility with gitworkshop.dev
 * - 8-char pubkey prefixes
 * - Full 64-char pubkeys
 * - ownerPubkey matching
 */
import { nip19 } from "nostr-tools";

import { resolveEntityToPubkey } from "./entity-resolver";

/**
 * Finds a repository by entity and repo name, supporting npub format and NIP-05
 *
 * @param repos - Array of repository objects
 * @param entity - Entity identifier (npub, NIP-05, 8-char prefix, or full pubkey)
 * @param repoName - Repository name
 * @returns Repository object or undefined
 */
export function findRepoByEntityAndName<
  T extends {
    entity?: string;
    repo?: string;
    slug?: string;
    name?: string;
    ownerPubkey?: string;
  }
>(repos: T[], entity: string, repoName: string): T | undefined {
  // CRITICAL: Resolve entity to pubkey (handles npub, hex pubkey)
  // Note: NIP-05 requires async resolution, so this will return null for NIP-05
  // The caller should use findRepoByEntityAndNameAsync for NIP-05 support
  const entityPubkey = resolveEntityToPubkey(entity);

  // Find repo by matching entity (8-char, npub, NIP-05, or full pubkey) OR by ownerPubkey
  return repos.find((r) => {
    // Match by repo name first (case-insensitive)
    const repoMatches =
      (r.repo && r.repo.toLowerCase() === repoName.toLowerCase()) ||
      (r.slug && r.slug.toLowerCase() === repoName.toLowerCase()) ||
      (r.slug &&
        r.slug.toLowerCase() === `${entity}/${repoName}`.toLowerCase()) ||
      (r.name && r.name.toLowerCase() === repoName.toLowerCase());
    if (!repoMatches) return false;

    // Match by entity (exact match - works for npub, NIP-05, 8-char prefix, or full pubkey)
    if (r.entity === entity) return true;

    // Match by resolved pubkey (for npub entities)
    if (entityPubkey && r.entity === entityPubkey) return true;

    // Match by ownerPubkey (most reliable - works across all entity formats)
    // This is CRITICAL for repos pushed from gitworkshop.dev (NIP-05) to be found on gittr.space
    if (
      entityPubkey &&
      r.ownerPubkey &&
      r.ownerPubkey.toLowerCase() === entityPubkey.toLowerCase()
    )
      return true;
    if (r.ownerPubkey === entity) return true;

    // Match by entity prefix (8-char)
    if (
      entity.length === 8 &&
      r.entity &&
      r.entity.toLowerCase().startsWith(entity.toLowerCase())
    ) {
      return true;
    }

    return false;
  });
}

/**
 * Async version that supports NIP-05 resolution
 *
 * @param repos - Array of repository objects
 * @param entity - Entity identifier (npub, NIP-05, 8-char prefix, or full pubkey)
 * @param repoName - Repository name
 * @returns Promise resolving to repository object or undefined
 */
export async function findRepoByEntityAndNameAsync<
  T extends {
    entity?: string;
    repo?: string;
    slug?: string;
    name?: string;
    ownerPubkey?: string;
  }
>(repos: T[], entity: string, repoName: string): Promise<T | undefined> {
  // Import async resolver
  const { resolveEntityToPubkeyAsync } = await import("./entity-resolver");

  // Resolve entity to pubkey (handles npub, NIP-05, hex pubkey)
  const entityPubkey = await resolveEntityToPubkeyAsync(entity);

  // Find repo by matching entity OR by ownerPubkey
  return repos.find((r) => {
    // Match by repo name first (case-insensitive)
    const repoMatches =
      (r.repo && r.repo.toLowerCase() === repoName.toLowerCase()) ||
      (r.slug && r.slug.toLowerCase() === repoName.toLowerCase()) ||
      (r.slug &&
        r.slug.toLowerCase() === `${entity}/${repoName}`.toLowerCase()) ||
      (r.name && r.name.toLowerCase() === repoName.toLowerCase());
    if (!repoMatches) return false;

    // Match by entity (exact match - works for npub, NIP-05, 8-char prefix, or full pubkey)
    if (r.entity === entity) return true;

    // Match by resolved pubkey (for npub and NIP-05 entities)
    if (entityPubkey && r.entity === entityPubkey) return true;

    // Match by ownerPubkey (most reliable - works across all entity formats)
    // This is CRITICAL for repos pushed from gitworkshop.dev (NIP-05) to be found on gittr.space
    if (
      entityPubkey &&
      r.ownerPubkey &&
      r.ownerPubkey.toLowerCase() === entityPubkey.toLowerCase()
    )
      return true;
    if (r.ownerPubkey === entity) return true;

    // Match by entity prefix (8-char)
    if (
      entity.length === 8 &&
      r.entity &&
      r.entity.toLowerCase().startsWith(entity.toLowerCase())
    ) {
      return true;
    }

    return false;
  });
}
