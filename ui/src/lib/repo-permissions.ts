/**
 * Repository Permission Utilities
 *
 * Defines role-based permissions similar to GitHub:
 * - Owner: Full control (merge, settings, delete)
 * - Maintainer: Can merge PRs, approve PRs (limited settings)
 * - Contributor: Can approve PRs, create PRs (cannot merge)
 */
import type { ContributorRole } from "@/components/ui/contributors";

// Re-export for convenience
export type { ContributorRole };

export interface ContributorWithRole {
  pubkey?: string;
  name?: string;
  picture?: string;
  weight?: number;
  role?: ContributorRole;
  githubLogin?: string;
}

/**
 * Determine role from weight (for backward compatibility)
 * Migrates old weight-based system to role-based
 */
export function getRoleFromWeight(weight: number | undefined): ContributorRole {
  if (!weight || weight === 0) return "contributor";
  if (weight === 100) return "owner";
  if (weight >= 50 && weight < 100) return "maintainer";
  return "contributor";
}

/**
 * Check if user can merge PRs
 */
export function canMerge(
  contributor: ContributorWithRole | null | undefined
): boolean {
  if (!contributor) return false;

  // If role is set, use it
  if (contributor.role) {
    return contributor.role === "owner" || contributor.role === "maintainer";
  }

  // Fallback: use weight (backward compatibility)
  const weight = contributor.weight || 0;
  return weight === 100 || (weight >= 50 && weight < 100);
}

/**
 * Check if user can approve PRs
 */
export function canApprove(
  contributor: ContributorWithRole | null | undefined
): boolean {
  if (!contributor) return false;

  // If role is set, use it
  if (contributor.role) {
    return (
      contributor.role === "owner" ||
      contributor.role === "maintainer" ||
      contributor.role === "contributor"
    );
  }

  // Fallback: use weight (any weight > 0 can approve)
  const weight = contributor.weight || 0;
  return weight > 0;
}

/**
 * Check if user can manage settings
 */
export function canManageSettings(
  contributor: ContributorWithRole | null | undefined
): boolean {
  if (!contributor) return false;

  // Only owners can manage settings
  if (contributor.role) {
    return contributor.role === "owner";
  }

  // Fallback: use weight (only weight 100)
  return (contributor.weight || 0) === 100;
}

/**
 * Check if user can delete repository
 */
export function canDeleteRepo(
  contributor: ContributorWithRole | null | undefined
): boolean {
  // Only owners can delete
  return canManageSettings(contributor);
}

/**
 * Get user's role in a repository
 */
export function getUserRole(
  userPubkey: string | null | undefined,
  repoContributors: ContributorWithRole[] | undefined
): ContributorRole | null {
  if (!userPubkey || !repoContributors) return null;

  const contributor = repoContributors.find(
    (c) => c.pubkey && c.pubkey.toLowerCase() === userPubkey.toLowerCase()
  );

  if (!contributor) return null;

  // If role is set, use it
  if (contributor.role) {
    return contributor.role;
  }

  // Fallback: derive from weight
  return getRoleFromWeight(contributor.weight);
}

/**
 * Check if user is owner
 */
export function isOwner(
  userPubkey: string | null | undefined,
  repoContributors: ContributorWithRole[] | undefined,
  repoOwnerPubkey?: string | null
): boolean {
  if (!userPubkey) return false;

  // Check explicit ownerPubkey
  if (
    repoOwnerPubkey &&
    repoOwnerPubkey.toLowerCase() === userPubkey.toLowerCase()
  ) {
    return true;
  }

  // Check contributors
  const role = getUserRole(userPubkey, repoContributors);
  return role === "owner";
}

/**
 * Check if user can merge (owner or maintainer)
 */
export function canUserMerge(
  userPubkey: string | null | undefined,
  repoContributors: ContributorWithRole[] | undefined,
  repoOwnerPubkey?: string | null
): boolean {
  if (!userPubkey) return false;

  // Check if owner
  if (isOwner(userPubkey, repoContributors, repoOwnerPubkey)) {
    return true;
  }

  // Check if maintainer
  const role = getUserRole(userPubkey, repoContributors);
  return role === "maintainer";
}

/**
 * Check if user can approve (owner, maintainer, or contributor)
 */
export function canUserApprove(
  userPubkey: string | null | undefined,
  repoContributors: ContributorWithRole[] | undefined,
  repoOwnerPubkey?: string | null
): boolean {
  if (!userPubkey) return false;

  // Owner, maintainer, or contributor can approve
  const role = getUserRole(userPubkey, repoContributors);
  return role === "owner" || role === "maintainer" || role === "contributor";
}

/**
 * Check if user has write access (owner or maintainer)
 * Write access allows: merge PRs, create releases, create/edit/delete projects, etc.
 */
export function hasWriteAccess(
  userPubkey: string | null | undefined,
  repoContributors: ContributorWithRole[] | undefined,
  repoOwnerPubkey?: string | null
): boolean {
  if (!userPubkey) return false;

  // Check if owner
  if (isOwner(userPubkey, repoContributors, repoOwnerPubkey)) {
    return true;
  }

  // Check if maintainer
  const role = getUserRole(userPubkey, repoContributors);
  return role === "maintainer";
}

/**
 * Get user's contributor object from repo
 */
export function getUserContributor(
  userPubkey: string | null | undefined,
  repoContributors: ContributorWithRole[] | undefined
): ContributorWithRole | null {
  if (!userPubkey || !repoContributors) return null;

  return (
    repoContributors.find(
      (c) => c.pubkey && c.pubkey.toLowerCase() === userPubkey.toLowerCase()
    ) || null
  );
}

/**
 * Get current user's GitHub username from localStorage (if they've done OAuth)
 */
function getCurrentUserGithubUsername(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const githubProfile = localStorage.getItem("gittr_github_profile");
    if (githubProfile) {
      try {
        const profile = JSON.parse(githubProfile);
        return profile.githubUsername || null;
      } catch {
        // Try to extract username from URL
        try {
          const url = new URL(githubProfile);
          const pathParts = url.pathname.split("/").filter((p) => p);
          return pathParts[0] || null;
        } catch {
          return null;
        }
      }
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Check if user has access to a private repository
 * Access is granted to: owner OR maintainer
 * Similar to GitHub's model where collaborators (with any permission) can see private repos
 *
 * IMPORTANT: Identity Mapping
 * - Primary: Nostr pubkey (if user has claimed their GitHub identity via OAuth or NIP-39)
 * - Fallback: GitHub username (if user has done OAuth and matches a contributor's githubLogin)
 *
 * This handles the case where:
 * - A maintainer on GitHub hasn't linked their Nostr identity yet
 * - They've done OAuth, so we can match their GitHub username to contributors
 */
export function hasPrivateRepoAccess(
  userPubkey: string | null | undefined,
  repoContributors: ContributorWithRole[] | undefined,
  repoOwnerPubkey?: string | null,
  maintainers?: string[] // NIP-34 maintainers tags (pubkeys)
): boolean {
  if (!userPubkey) return false;

  const normalizedUser = userPubkey.toLowerCase();

  // Check if owner
  if (isOwner(userPubkey, repoContributors, repoOwnerPubkey)) {
    return true;
  }

  // Check if maintainer (from contributors) by Nostr pubkey
  const role = getUserRole(userPubkey, repoContributors);
  if (role === "maintainer") {
    return true;
  }

  // Check if in NIP-34 maintainers tags
  if (maintainers && Array.isArray(maintainers)) {
    const isMaintainer = maintainers.some((m) => {
      // Handle both hex and npub formats
      if (/^[0-9a-f]{64}$/i.test(m)) {
        return m.toLowerCase() === normalizedUser;
      }
      // If npub, decode it
      if (m.startsWith("npub")) {
        try {
          const { nip19 } = require("nostr-tools");
          const decoded = nip19.decode(m);
          if (decoded.type === "npub") {
            return (decoded.data as string).toLowerCase() === normalizedUser;
          }
        } catch {
          // Decode failed, skip
        }
      }
      return false;
    });
    if (isMaintainer) {
      return true;
    }
  }

  // FALLBACK: Check by GitHub username (if user has done OAuth)
  // This handles the case where a maintainer on GitHub hasn't linked their Nostr identity
  const currentUserGithubUsername = getCurrentUserGithubUsername();
  if (currentUserGithubUsername && repoContributors) {
    const matchingContributor = repoContributors.find((c) => {
      // Check if GitHub username matches AND they're a maintainer
      const githubLoginMatch =
        c.githubLogin &&
        c.githubLogin.toLowerCase() === currentUserGithubUsername.toLowerCase();
      const isMaintainer =
        c.role === "maintainer" ||
        (c.role === undefined &&
          c.weight !== undefined &&
          c.weight >= 50 &&
          c.weight < 100);
      return githubLoginMatch && isMaintainer;
    });
    if (matchingContributor) {
      return true;
    }
  }

  return false;
}
