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
    const rawPubkey =
      typeof clone.pubkey === "string" ? clone.pubkey.trim() : "";
    const pubkey =
      rawPubkey && HEX_64_REGEX.test(rawPubkey)
        ? rawPubkey.toLowerCase()
        : undefined;
    clone.pubkey = pubkey || undefined;

    const rawLogin =
      typeof clone.githubLogin === "string" ? clone.githubLogin.trim() : "";
    const githubLogin = rawLogin ? rawLogin.toLowerCase() : undefined;
    clone.githubLogin = githubLogin || undefined;

    const name = typeof clone.name === "string" ? clone.name.trim() : "";
    clone.name = name || undefined;

    const picture =
      typeof clone.picture === "string" ? clone.picture.trim() : "";
    clone.picture = picture || undefined;

    const weight =
      typeof clone.weight === "number" && !Number.isNaN(clone.weight)
        ? clone.weight
        : undefined;
    clone.weight = weight !== undefined ? Math.max(0, weight) : undefined;

    if (clone.role) {
      const roleLower = clone.role.toLowerCase();
      if (
        roleLower === "owner" ||
        roleLower === "maintainer" ||
        roleLower === "contributor"
      ) {
        clone.role = roleLower as ContributorRole;
      } else {
        clone.role = undefined;
      }
    }

    const hasIdentity =
      !!clone.pubkey || !!clone.githubLogin || (!!clone.name && keepNameOnly);
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

/**
 * Ensures the Gittr/Nostr owner (64-char hex pubkey) is present as a contributor with weight 100.
 * Strips misleading name-only "owner" rows that duplicate {@link displayName} when the real pubkey is known.
 */
export function mergeOwnerPubkeyIntoContributors<T extends ContributorLike>(
  list: T[] | undefined | null,
  ownerPubkey: string | undefined | null,
  displayName?: string | null
): T[] {
  const base = Array.isArray(list) ? [...list] : [];
  if (
    !ownerPubkey ||
    typeof ownerPubkey !== "string" ||
    !HEX_64_REGEX.test(ownerPubkey.trim())
  ) {
    return sanitizeContributors(base, { keepNameOnly: true }) as T[];
  }
  const pk = ownerPubkey.trim().toLowerCase();
  const dn = typeof displayName === "string" ? displayName.trim() : "";

  const withoutShadowOwner = base.filter((c) => {
    if (c.pubkey || c.githubLogin) return true;
    if (
      dn &&
      typeof c.name === "string" &&
      c.name.trim() === dn &&
      (c.weight === 100 || c.role === "owner")
    ) {
      return false;
    }
    return true;
  });

  const idx = withoutShadowOwner.findIndex(
    (c) => c.pubkey && c.pubkey.toLowerCase() === pk
  );
  let merged: T[];
  if (idx >= 0) {
    merged = withoutShadowOwner.map((c, i) =>
      i === idx
        ? ({ ...c, weight: 100, role: "owner" as ContributorRole } as T)
        : c
    );
  } else {
    merged = [
      {
        pubkey: pk,
        name: dn || undefined,
        weight: 100,
        role: "owner",
      } as T,
      ...withoutShadowOwner,
    ];
  }
  return sanitizeContributors(merged, { keepNameOnly: true }) as T[];
}
