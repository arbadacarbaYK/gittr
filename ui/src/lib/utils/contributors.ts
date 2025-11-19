"use client";

export type ContributorRole = "owner" | "maintainer" | "contributor";

export interface ContributorLike {
  pubkey?: string | null;
  name?: string | null;
  picture?: string | null;
  weight?: number | null;
  role?: ContributorRole | null;
  githubLogin?: string | null;
}

interface SanitizeOptions {
  /**
   * When true, keep entries that only have a name (no pubkey/githubLogin).
   * Defaults to false, which drops anonymous placeholders.
   */
  keepNameOnly?: boolean;
}

const HEX_64_REGEX = /^[0-9a-f]{64}$/i;

/**
 * Normalize and deduplicate contributor entries.
 * - Trims strings and normalizes pubkeys to lowercase hex.
 * - Drops entries without any identity (pubkey/githubLogin/name).
 * - Removes duplicate pubkeys/logins (first occurrence wins).
 * - Ensures weight/role fields are consistent.
 */
export function sanitizeContributors<T extends ContributorLike>(
  contributors: T[] | undefined | null,
  options: SanitizeOptions = {}
): T[] {
  if (!Array.isArray(contributors) || contributors.length === 0) {
    return [];
  }

  const keepNameOnly = options.keepNameOnly ?? false;
  const seenPubkeys = new Set<string>();
  const seenLogins = new Set<string>();
  const seenNames = new Set<string>();

  const sanitized: T[] = [];

  for (const entry of contributors) {
    if (!entry || typeof entry !== "object") continue;

    const clone: T = { ...entry };

    // Normalize strings
    const rawPubkey = typeof clone.pubkey === "string" ? clone.pubkey.trim() : "";
    const pubkey = rawPubkey && HEX_64_REGEX.test(rawPubkey) ? rawPubkey.toLowerCase() : undefined;
    clone.pubkey = pubkey || undefined;

    const rawLogin = typeof clone.githubLogin === "string" ? clone.githubLogin.trim() : "";
    const githubLogin = rawLogin ? rawLogin.toLowerCase() : undefined;
    clone.githubLogin = githubLogin || undefined;

    const name = typeof clone.name === "string" ? clone.name.trim() : "";
    clone.name = name || undefined;

    const picture = typeof clone.picture === "string" ? clone.picture.trim() : "";
    clone.picture = picture || undefined;

    const weight = typeof clone.weight === "number" && !Number.isNaN(clone.weight) ? clone.weight : undefined;
    clone.weight = weight !== undefined ? Math.max(0, weight) : undefined;

    if (clone.role) {
      const roleLower = clone.role.toLowerCase();
      if (roleLower === "owner" || roleLower === "maintainer" || roleLower === "contributor") {
        clone.role = roleLower as ContributorRole;
      } else {
        clone.role = undefined;
      }
    }

    const hasIdentity = !!clone.pubkey || !!clone.githubLogin || (!!clone.name && keepNameOnly);
    if (!hasIdentity) {
      continue;
    }

    if (clone.pubkey) {
      if (seenPubkeys.has(clone.pubkey)) continue;
      seenPubkeys.add(clone.pubkey);
    } else if (clone.githubLogin) {
      if (seenLogins.has(clone.githubLogin)) continue;
      seenLogins.add(clone.githubLogin);
    } else if (clone.name) {
      const lowerName = clone.name.toLowerCase();
      if (seenNames.has(lowerName)) continue;
      seenNames.add(lowerName);
    }

    sanitized.push(clone);
  }

  return sanitized;
}


