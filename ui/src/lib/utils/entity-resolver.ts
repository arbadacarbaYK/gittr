/**
 * Entity Resolution Utilities
 *
 * Handles consistent resolution of entity identifiers (npub format, NIP-05, or full pubkeys)
 * to full 64-char pubkeys for metadata fetching and profile links.
 *
 * CRITICAL: All repos run on Nostr network - we need to support repos from ANY user,
 * not just the current logged-in user. Always resolve to the actual owner's pubkey.
 *
 * Supports:
 * - npub format (GRASP protocol standard)
 * - NIP-05 identifiers (e.g., geek@primal.net) - for compatibility with gitworkshop.dev
 * - Full 64-char hex pubkeys
 */
import { nip05, nip19 } from "nostr-tools";

/**
 * Resolves an entity (npub format, NIP-05, or full pubkey) to a full 64-char pubkey
 *
 * @param entity - npub format, NIP-05 identifier, or full 64-char pubkey
 * @param repo - Optional repo object to check for ownerPubkey
 * @returns Full 64-char pubkey or null if not found
 */
export function resolveEntityToPubkey(
  entity: string | undefined,
  repo?: any
): string | null {
  if (!entity) return null;

  // If already a full pubkey, return it
  if (/^[0-9a-f]{64}$/i.test(entity)) {
    return entity.toLowerCase();
  }

  // If npub, decode it
  if (entity.startsWith("npub")) {
    try {
      const decoded = nip19.decode(entity);
      if (decoded.type === "npub") {
        return decoded.data as string;
      }
    } catch {
      // Invalid npub format
    }
  }

  // If NIP-05 format (contains @), return null for sync version (use async version)
  // This allows callers to detect NIP-05 and use async resolution
  if (entity.includes("@")) {
    return null; // NIP-05 requires async resolution
  }

  return null;
}

/**
 * Async version that resolves NIP-05 identifiers to pubkeys
 *
 * @param entity - npub format, NIP-05 identifier, or full 64-char pubkey
 * @param repo - Optional repo object to check for ownerPubkey
 * @returns Promise resolving to full 64-char pubkey or null if not found
 */
export async function resolveEntityToPubkeyAsync(
  entity: string | undefined,
  repo?: any
): Promise<string | null> {
  if (!entity) return null;

  // Try sync resolution first (npub, hex pubkey)
  const syncResult = resolveEntityToPubkey(entity, repo);
  if (syncResult) return syncResult;

  // If NIP-05 format (contains @), resolve it
  if (entity.includes("@")) {
    try {
      const profile = await nip05.queryProfile(entity);
      if (profile?.pubkey && /^[0-9a-f]{64}$/i.test(profile.pubkey)) {
        console.log(
          `✅ [Entity Resolver] Resolved NIP-05 ${entity} to pubkey: ${profile.pubkey.slice(
            0,
            8
          )}...`
        );
        return profile.pubkey.toLowerCase();
      }
    } catch (error) {
      console.warn(
        `⚠️ [Entity Resolver] Failed to resolve NIP-05 ${entity}:`,
        error
      );
    }
  }

  return null;
}

/**
 * Gets the owner pubkey for a repository
 *
 * @param repo - Repository object
 * @param entity - Optional entity (8-char prefix or full pubkey) from URL
 * @returns Full 64-char pubkey or null
 */
export function getRepoOwnerPubkey(repo: any, entity?: string): string | null {
  if (!repo) return null;

  // Priority 1: Use explicit ownerPubkey
  if (repo.ownerPubkey && /^[0-9a-f]{64}$/i.test(repo.ownerPubkey)) {
    return repo.ownerPubkey.toLowerCase();
  }

  // Priority 2: Find owner in contributors (weight 100)
  if (repo.contributors && Array.isArray(repo.contributors)) {
    const owner = repo.contributors.find(
      (c: any) =>
        c.weight === 100 && c.pubkey && /^[0-9a-f]{64}$/i.test(c.pubkey)
    );
    if (owner?.pubkey) {
      return owner.pubkey.toLowerCase();
    }
  }

  // Priority 3: If entity provided, try to resolve from it
  if (entity) {
    return resolveEntityToPubkey(entity, repo);
  }

  return null;
}

/**
 * Gets the display name for an entity/pubkey
 * Uses Nostr metadata if available, otherwise falls back to npub format (not shortened pubkey)
 *
 * @param pubkey - Full 64-char pubkey
 * @param ownerMetadata - Metadata object from useContributorMetadata hook
 * @param entity - Optional npub format for fallback (will be shortened)
 * @returns Display name (Nostr name, display_name, or shortened npub)
 */
export function getEntityDisplayName(
  pubkey: string | null,
  ownerMetadata: Record<string, any>,
  entity?: string
): string {
  if (!pubkey) {
    // If we have npub entity, show shortened version
    if (entity && entity.startsWith("npub")) {
      return `${entity.substring(0, 16)}...`;
    }
    return entity || "Unknown";
  }

  // CRITICAL: Normalize pubkey to lowercase for metadata lookup (metadata is stored in lowercase)
  const normalizedPubkey = pubkey.toLowerCase();

  // Use Nostr metadata if available
  const meta = ownerMetadata[normalizedPubkey] || ownerMetadata[pubkey];
  if (meta) {
    const name = meta.name || meta.display_name;
    if (name && name.trim().length > 0 && name !== "Anonymous Nostrich") {
      return name;
    }
  }

  // CRITICAL: Fallback to npub format (not shortened pubkey) - this is what we store in entity
  // If entity is provided and is npub, use that
  if (entity && entity.startsWith("npub")) {
    return `${entity.substring(0, 16)}...`;
  }

  // If we have pubkey but no entity, encode to npub and show shortened version
  try {
    const npub = nip19.npubEncode(pubkey);
    return `${npub.substring(0, 16)}...`;
  } catch {
    // If encoding fails, fallback to shortened pubkey (shouldn't happen)
    return pubkey.slice(0, 8);
  }
}

/**
 * Gets the profile picture for an entity/pubkey
 *
 * @param pubkey - Full 64-char pubkey
 * @param ownerMetadata - Metadata object from useContributorMetadata hook
 * @returns Profile picture URL or null
 */
export function getEntityPicture(
  pubkey: string | null,
  ownerMetadata: Record<string, any>
): string | null {
  if (!pubkey || !/^[0-9a-f]{64}$/i.test(pubkey)) return null;

  // CRITICAL: Normalize pubkey to lowercase for metadata lookup (metadata is stored in lowercase)
  // CRITICAL: Use EXACT match only - no partial matching to avoid wrong user's picture
  const normalizedPubkey = pubkey.toLowerCase();
  const meta = ownerMetadata[normalizedPubkey] || ownerMetadata[pubkey];
  if (meta?.picture && meta.picture.startsWith("http")) {
    return meta.picture;
  }
  return null;
}

/**
 * CENTRALIZED METADATA LOOKUP FUNCTION
 *
 * This function provides a consistent way to fetch user metadata across ALL pages.
 * It handles all lookup strategies (normalized, original case, case-insensitive, partial match)
 * and returns all metadata fields (name, display_name, picture, nip05, about, etc.)
 *
 * @param pubkey - Full 64-char pubkey (must be normalized to lowercase before calling)
 * @param metadataMap - Full metadata map from useContributorMetadata hook (contains ALL cached entries)
 * @returns Complete metadata object with all fields, or empty object if not found
 */
export function getUserMetadata(
  pubkey: string | null,
  metadataMap: Record<string, any>
): {
  name?: string;
  display_name?: string;
  picture?: string;
  nip05?: string;
  about?: string;
  banner?: string;
  website?: string;
  lud16?: string;
  lnurl?: string;
  identities?: any[]; // NIP-39 claimed identities
  [key: string]: any;
} {
  if (!pubkey || !/^[0-9a-f]{64}$/i.test(pubkey)) {
    return {};
  }

  // CRITICAL: Normalize pubkey to lowercase for consistent lookup
  const normalized = pubkey.toLowerCase();

  // Strategy 1: Direct lookup with normalized key (most common case)
  if (metadataMap[normalized]) {
    const meta = metadataMap[normalized];
    // Log if identities are present for debugging
    if (
      meta.identities &&
      Array.isArray(meta.identities) &&
      meta.identities.length > 0
    ) {
      console.log(
        `✅ [getUserMetadata] Found ${
          meta.identities.length
        } identities for ${normalized.slice(0, 8)}`
      );
    }
    return meta;
  }

  // Strategy 2: Try original case (shouldn't happen if normalization is working)
  if (metadataMap[pubkey]) {
    const meta = metadataMap[pubkey];
    if (
      meta.identities &&
      Array.isArray(meta.identities) &&
      meta.identities.length > 0
    ) {
      console.log(
        `✅ [getUserMetadata] Found ${
          meta.identities.length
        } identities for ${pubkey.slice(0, 8)} (original case)`
      );
    }
    return meta;
  }

  // Strategy 3: Case-insensitive match (find key that matches when lowercased)
  const matchingKey = Object.keys(metadataMap).find(
    (k) => k.toLowerCase() === normalized
  );
  if (matchingKey && metadataMap[matchingKey]) {
    const meta = metadataMap[matchingKey];
    if (
      meta.identities &&
      Array.isArray(meta.identities) &&
      meta.identities.length > 0
    ) {
      console.log(
        `✅ [getUserMetadata] Found ${
          meta.identities.length
        } identities for ${normalized.slice(0, 8)} (case-insensitive match)`
      );
    }
    return meta;
  }

  // Strategy 4: Partial match (first 8 chars) as last resort
  const partialMatch = Object.keys(metadataMap).find(
    (k) =>
      k.toLowerCase().slice(0, 8) === normalized.slice(0, 8) && k.length === 64
  );
  if (partialMatch && metadataMap[partialMatch]) {
    const meta = metadataMap[partialMatch];
    if (
      meta.identities &&
      Array.isArray(meta.identities) &&
      meta.identities.length > 0
    ) {
      console.log(
        `✅ [getUserMetadata] Found ${
          meta.identities.length
        } identities for ${normalized.slice(0, 8)} (partial match)`
      );
    }
    return meta;
  }

  console.log(
    `⚠️ [getUserMetadata] No metadata found for ${normalized.slice(
      0,
      8
    )} (available keys: ${Object.keys(metadataMap).slice(0, 5).join(", ")})`
  );
  return {};
}
