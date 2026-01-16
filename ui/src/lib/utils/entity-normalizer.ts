/**
 * Entity Normalization Utilities
 *
 * Normalizes entity identifiers for consistent use in:
 * - localStorage keys
 * - URL generation
 * - Repo lookups
 *
 * CRITICAL: We use npub format (GRASP protocol standard) everywhere.
 * No 8-char prefixes - they cause confusion and mapping issues.
 */
import { nip19 } from "nostr-tools";

/**
 * Normalizes an entity identifier to npub format for localStorage
 *
 * @param entity - Entity identifier (npub, or full pubkey)
 * @returns npub format for consistent storage
 */
export function normalizeEntityForStorage(
  entity: string | undefined | null
): string {
  if (!entity) return "";

  // If already npub, return as-is
  if (entity.startsWith("npub")) {
    return entity;
  }

  // If full pubkey (64-char), encode to npub
  if (/^[0-9a-f]{64}$/i.test(entity)) {
    try {
      return nip19.npubEncode(entity);
    } catch {
      // Invalid pubkey, fall through
    }
  }

  // Fallback: use entity as-is (might be GitHub username or other format)
  return entity;
}

/**
 * Generates a consistent localStorage key for repo-related data
 * Uses npub format (GRASP protocol standard)
 *
 * @param prefix - Key prefix (e.g., "gittr_issues", "gittr_prs")
 * @param entity - Entity identifier (npub or full pubkey)
 * @param repo - Repository name
 * @returns Normalized localStorage key
 */
export function getRepoStorageKey(
  prefix: string,
  entity: string,
  repo: string
): string {
  const normalizedEntity = normalizeEntityForStorage(entity);
  return `${prefix}__${normalizedEntity}__${repo}`;
}
