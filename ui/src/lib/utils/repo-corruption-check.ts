/**
 * Centralized corruption detection for repositories
 * Prevents corrupted repos from being displayed, forked, signed, or stored anywhere
 * 
 * General validation: checks for missing/invalid data regardless of repo name
 */

/**
 * Check if a repository is corrupted and should be filtered out
 * @param repo - Repository object to check
 * @param eventId - Optional Nostr event ID (for logging purposes)
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

  // CRITICAL: If entity is valid npub, verify ownerPubkey matches (if present)
  // This prevents repos from being attributed to wrong owners
  if (entity && entity.startsWith("npub") && repo.ownerPubkey) {
    try {
      const { nip19 } = require("nostr-tools");
      const decoded = nip19.decode(entity);
      if (decoded.type === "npub") {
        const entityPubkey = (decoded.data as string).toLowerCase();
        const ownerPubkey = repo.ownerPubkey.toLowerCase();
        // If ownerPubkey doesn't match entity pubkey, it's corrupted
        if (ownerPubkey !== entityPubkey) {
          return true; // Corrupted - repo doesn't belong to this entity
        }
      }
    } catch (e) {
      // If we can't decode entity, assume corrupted
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

