// GitHub to Nostr user mapping utilities

import { sanitizeContributors } from "./utils/contributors";

export interface GitHubMapping {
  [pubkey: string]: string; // pubkey -> github profile URL
}

export interface GitHubContributor {
  login: string;
  avatar_url: string;
  contributions: number;
}

// Get GitHub profile URL for a Nostr pubkey
export function getGithubProfile(pubkey: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    const mappings = JSON.parse(localStorage.getItem("gittr_github_mappings") || "{}") as GitHubMapping;
    return mappings[pubkey] || null;
  } catch {
    return null;
  }
}

// Get Nostr pubkey for a GitHub username
export function getPubkeyFromGithub(githubLogin: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    const mappings = JSON.parse(localStorage.getItem("gittr_github_mappings") || "{}") as GitHubMapping;
    // Search for matching GitHub profile
    // Regex to extract username from GitHub URLs (handles https://, http://, git@, www., etc.)
    const githubUrlRegex = /(?:git@|https?:\/\/)?(?:www\.)?github\.com[:/]?(?:\/)?([\w\-\.]+)/i;
    
    for (const pubkey in mappings) {
      const githubUrlRaw = mappings[pubkey];
      // Skip undefined/null values
      if (typeof githubUrlRaw !== "string" || !githubUrlRaw) continue;
      
      // Extract username using regex - much simpler!
      const match = githubUrlRaw.match(githubUrlRegex);
      if (!match || !match[1]) continue;
      
      const username = match[1].toLowerCase();
      
      // Check if extracted username matches the login
      if (username === githubLogin.toLowerCase()) {
        return pubkey;
      }
    }
    return null;
  } catch {
    return null;
  }
}

// Map GitHub/GitLab/Codeberg contributors to Nostr contributors
// Now keeps ALL contributors (not just those with Nostr pubkeys)
// Contributors without Nostr pubkeys will be shown with their GitHub/GitLab/Codeberg avatar and login
// This allows users to see all contributors, even if they haven't linked their accounts
export function mapGithubContributors(
  githubContributors: GitHubContributor[],
  currentUserPubkey?: string,
  currentUserPicture?: string,
  keepAnonymous: boolean = true, // DEFAULT: Keep all contributors (changed from false)
  nostrMetadata?: Record<string, { picture?: string; name?: string; display_name?: string }> // Optional: Nostr metadata map for all contributors
): Array<{pubkey?: string; name?: string; picture?: string; weight: number; githubLogin?: string; role?: "owner" | "maintainer" | "contributor"}> {
  // Filter out invalid entries (missing login) before processing
  const validContributors = githubContributors.filter((contrib) => 
    contrib && 
    typeof contrib === 'object' && 
    contrib.login && 
    typeof contrib.login === 'string' &&
    contrib.login.trim().length > 0
  );
  
  if (validContributors.length !== githubContributors.length) {
  }
  
  const mapped = validContributors
    .map((contrib) => {
      const pubkey = getPubkeyFromGithub(contrib.login);
      
      // DEBUG: Log pubkey lookup to diagnose issues
      if (validContributors.indexOf(contrib) < 3) { // Only log first 3 to avoid spam
        console.debug("🔎 [GitHub Mapping] Contributor lookup", {
          login: contrib.login,
          pubkey: pubkey ? `${pubkey.slice(0, 8)}...` : "none (not in mappings)",
          contributions: contrib.contributions,
        });
      }
      // Use contribution count as weight (0-100 scale, but can exceed 100)
      // For role assignment: owner = 100, maintainer = 50-99, contributor = 1-49
      const contributions = contrib.contributions || 0;
      const weight = Math.min(contributions, 100); // Cap at 100 for role purposes
      
      // Determine role based on contributions (heuristic)
      // Owner is typically the one with most contributions, but we'll let settings override this
      let role: "owner" | "maintainer" | "contributor" | undefined = undefined;
      if (weight >= 100) {
        role = "owner";
      } else if (weight >= 50) {
        role = "maintainer";
      } else if (weight > 0) {
        role = "contributor";
      }
      
      // Picture priority:
      // 1. Nostr profile picture (if contributor has claimed identity and metadata is available)
      // 2. Current user's Nostr picture (if this contributor is the current user and no metadata)
      // 3. GitHub/GitLab/Codeberg avatar (always available as fallback)
      let picture: string | undefined = contrib.avatar_url || undefined;
      
      // Get metadata for this contributor if available
      const contribMetadata = pubkey && nostrMetadata ? nostrMetadata[pubkey] : undefined;
      
      if (contribMetadata?.picture) {
        // Use Nostr profile picture if available (for any contributor who has claimed identity)
        picture = contribMetadata.picture;
      } else if (pubkey && pubkey === currentUserPubkey && currentUserPicture && currentUserPicture.trim().length > 0) {
        // Fallback: Use current user's Nostr picture if no metadata map provided
        picture = currentUserPicture;
      }
      
      // Name priority:
      // 1. Nostr display_name or name
      // 2. GitHub/GitLab/Codeberg login
      const name = contribMetadata
        ? (contribMetadata.display_name || contribMetadata.name || contrib.login)
        : contrib.login;
      
      return {
        pubkey: pubkey || undefined,
        name,
        picture, // GitHub/GitLab/Codeberg avatar as fallback, Nostr pic if available
        weight,
        githubLogin: contrib.login,
        role,
      };
    })
    .filter((contrib) => {
      // Keep ALL contributors (changed from filtering out those without pubkeys)
      // This allows users to see all contributors, even if they haven't linked their accounts
      if (keepAnonymous) return true; // Keep all contributors
      // If keepAnonymous is false (backward compatibility), only keep those with Nostr identities
      return !!contrib.pubkey;
    });

  return sanitizeContributors(mapped, { keepNameOnly: keepAnonymous });
}
