/**
 * Centralized corruption detection for repositories
 * Prevents corrupted repos from being displayed, forked, or signed
 */

/**
 * Known corrupted tides repo event IDs that should never be stored or displayed
 */
const CORRUPT_TIDES_EVENT_IDS = [
  "28cd39385801bb7683e06e7489f89afff8df045a4d6fe7319d75a60341165ae2",
  "68ad8ad9152dfa6788c988c6ed2bc47b34ae30c71ad7f7c0ab7c0f46248f0e0b",
  "1dbc5322b24b3481e5ce078349f527b04ad6251e9f0499b851d78cc9f92c4559"
];

/**
 * Check if a repository is corrupted and should be filtered out
 * @param repo - Repository object to check
 * @param eventId - Optional Nostr event ID (for checking known corrupted events)
 * @returns true if repo is corrupted and should be filtered out
 */
export function isRepoCorrupted(
  repo: any,
  eventId?: string
): boolean {
  // CRITICAL: Check for missing repositoryName
  const repoName = repo.repositoryName || repo.repo || repo.slug || repo.name || "";
  if (!repoName || repoName.trim() === "") {
    return true; // Repo without name is corrupted
  }

  // CRITICAL: Check for invalid entity (must be npub format, not domain name)
  const entity = repo.entity || "";
  if (!entity || entity === "gittr.space" || (entity.includes(".") && !entity.startsWith("npub"))) {
    return true; // Invalid entity is corrupted
  }

  // CRITICAL: Entity must start with "npub" (GRASP protocol standard)
  if (entity && !entity.startsWith("npub")) {
    return true; // Non-npub entities are corrupted
  }

  // CRITICAL: Check for known corrupted tides repos by event ID
  const normalizedRepoName = repoName.toLowerCase();
  const isTides = normalizedRepoName === "tides";
  if (isTides && eventId && CORRUPT_TIDES_EVENT_IDS.includes(eventId)) {
    return true; // Known corrupted tides repo
  }

  // Additional check: tides repos with invalid entity are always corrupted
  if (isTides && (entity === "gittr.space" || !entity || !entity.startsWith("npub"))) {
    return true;
  }

  // CRITICAL: For "tides" repos, verify they actually belong to the entity
  // If ownerPubkey doesn't match entity, it's corrupted
  if (isTides && repo.ownerPubkey && entity) {
    try {
      // Decode entity to get pubkey
      if (entity.startsWith("npub")) {
        const { nip19 } = require("nostr-tools");
        const decoded = nip19.decode(entity);
        if (decoded.type === "npub") {
          const entityPubkey = (decoded.data as string).toLowerCase();
          const ownerPubkey = repo.ownerPubkey.toLowerCase();
          // If ownerPubkey doesn't match entity pubkey, it's corrupted
          if (ownerPubkey !== entityPubkey) {
            return true; // Corrupted - tides repo doesn't belong to this entity
          }
        }
      }
    } catch (e) {
      // If we can't decode, assume corrupted
      return true;
    }
  }

  return false;
}

/**
 * Validate repository before forking or signing
 * @param repo - Repository object to validate
 * @returns {valid: boolean, error?: string}
 */
export function validateRepoForForkOrSign(repo: any): { valid: boolean; error?: string } {
  // Check if repo is corrupted
  if (isRepoCorrupted(repo)) {
    return {
      valid: false,
      error: "Cannot fork or sign corrupted repository (invalid entity or missing repository name)"
    };
  }

  // Additional validation: ensure repo has required fields
  const repoName = repo.repositoryName || repo.repo || repo.slug || repo.name || "";
  if (!repoName || repoName.trim() === "") {
    return {
      valid: false,
      error: "Repository name is required"
    };
  }

  const entity = repo.entity || "";
  if (!entity || !entity.startsWith("npub")) {
    return {
      valid: false,
      error: "Repository must have a valid npub entity"
    };
  }

  return { valid: true };
}

