import {
  mergeOwnerPubkeyIntoContributors,
  sanitizeContributors,
  type ContributorLike,
  type ContributorRole,
} from "@/lib/utils/contributors";

export type RepoContributor = ContributorLike & {
  weight: number;
  role?: ContributorRole;
};

type ContributorTag = {
  pubkey: string;
  weight: number;
  role?: ContributorRole;
};

function contributorIdentityKey(c: ContributorLike): string | null {
  if (c.pubkey && /^[0-9a-f]{64}$/i.test(c.pubkey)) {
    return `pk:${c.pubkey.toLowerCase()}`;
  }
  if (c.githubLogin) {
    return `gh:${c.githubLogin.toLowerCase()}`;
  }
  if (c.name) {
    return `name:${c.name.toLowerCase()}`;
  }
  return null;
}

/**
 * Merge contributor lists from Nostr tags, event JSON, maintainers, and local storage.
 * Preserves GitHub login / avatar metadata from imports when NIP-34 events only carry pubkeys.
 */
export function mergeContributorsFromNostrEvent(options: {
  eventPubkey: string;
  contributorTags?: ContributorTag[];
  eventContributors?: RepoContributor[];
  maintainers?: string[];
  existingContributors?: ContributorLike[];
}): RepoContributor[] {
  const {
    eventPubkey,
    contributorTags = [],
    eventContributors = [],
    maintainers = [],
    existingContributors = [],
  } = options;

  let contributors: RepoContributor[] = [];

  if (contributorTags.length > 0) {
    contributors = contributorTags.map((c) => ({
      pubkey: c.pubkey,
      weight: c.weight,
      role: c.role,
    }));
  }

  for (const contentContributor of eventContributors) {
    const exists = contributors.some(
      (c) =>
        c.pubkey &&
        contentContributor.pubkey &&
        c.pubkey.toLowerCase() === contentContributor.pubkey.toLowerCase()
    );
    if (!exists) {
      contributors.push({
        ...contentContributor,
        weight: contentContributor.weight ?? 0,
      });
    }
  }

  for (const maintainerPubkey of maintainers) {
    if (!/^[0-9a-f]{64}$/i.test(maintainerPubkey)) continue;
    const pk = maintainerPubkey.toLowerCase();
    const exists = contributors.some(
      (c) => c.pubkey && c.pubkey.toLowerCase() === pk
    );
    if (!exists) {
      contributors.push({
        pubkey: pk,
        weight: pk === eventPubkey.toLowerCase() ? 100 : 50,
        role: pk === eventPubkey.toLowerCase() ? "owner" : "maintainer",
      });
    }
  }

  for (const existingContributor of existingContributors) {
    const existingIndex = contributors.findIndex((c) => {
      if (
        c.pubkey &&
        existingContributor.pubkey &&
        c.pubkey.toLowerCase() === existingContributor.pubkey.toLowerCase()
      ) {
        return true;
      }
      if (
        c.githubLogin &&
        existingContributor.githubLogin &&
        c.githubLogin.toLowerCase() ===
          existingContributor.githubLogin.toLowerCase()
      ) {
        return true;
      }
      return false;
    });

    if (existingIndex >= 0 && contributors[existingIndex]) {
      const mergedContributor: RepoContributor = {
        ...contributors[existingIndex],
        name:
          existingContributor.name || contributors[existingIndex]?.name,
        picture:
          existingContributor.picture || contributors[existingIndex]?.picture,
        githubLogin:
          existingContributor.githubLogin ||
          contributors[existingIndex]?.githubLogin,
        weight: contributors[existingIndex].weight ?? 0,
      };
      if (existingContributor.pubkey) {
        mergedContributor.pubkey = existingContributor.pubkey;
      } else if (contributors[existingIndex].pubkey) {
        mergedContributor.pubkey = contributors[existingIndex].pubkey;
      }
      contributors[existingIndex] = mergedContributor;
    } else {
      const isDuplicate = contributors.some((c) => {
        const a = contributorIdentityKey(c);
        const b = contributorIdentityKey(existingContributor);
        return a !== null && b !== null && a === b;
      });
      if (!isDuplicate) {
        contributors.push({
          ...existingContributor,
          weight: existingContributor.weight ?? 0,
          role: existingContributor.role ?? undefined,
          pubkey: existingContributor.pubkey ?? undefined,
          name: existingContributor.name ?? undefined,
          picture: existingContributor.picture ?? undefined,
          githubLogin: existingContributor.githubLogin ?? undefined,
        });
      }
    }
  }

  const ownerPk = eventPubkey.toLowerCase();
  const ownerInContributors = contributors.some(
    (c) => c.pubkey && c.pubkey.toLowerCase() === ownerPk
  );
  if (!ownerInContributors) {
    contributors = [
      { pubkey: ownerPk, weight: 100, role: "owner" },
      ...contributors,
    ];
  } else {
    contributors = contributors.map((c) =>
      c.pubkey && c.pubkey.toLowerCase() === ownerPk
        ? { ...c, weight: 100, role: "owner" as ContributorRole }
        : c
    );
  }

  const normalized = sanitizeContributors(contributors, {
    keepNameOnly: true,
  }).map((c) => ({
    ...c,
    weight:
      typeof c.weight === "number" && !Number.isNaN(c.weight) ? c.weight : 0,
  }));

  return mergeOwnerPubkeyIntoContributors(
    normalized,
    eventPubkey
  ) as RepoContributor[];
}

/** Merge two contributor arrays without dropping GitHub-only entries. */
export function mergeStoredContributorLists(
  primary?: ContributorLike[] | null,
  secondary?: ContributorLike[] | null
): RepoContributor[] {
  const merged: RepoContributor[] = [];
  const seen = new Set<string>();
  for (const list of [primary, secondary]) {
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
      const key = contributorIdentityKey(entry);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      merged.push({
        pubkey: entry.pubkey ?? undefined,
        name: entry.name ?? undefined,
        picture: entry.picture ?? undefined,
        githubLogin: entry.githubLogin ?? undefined,
        role: entry.role ?? undefined,
        weight:
          typeof entry.weight === "number" && !Number.isNaN(entry.weight)
            ? entry.weight
            : 0,
      });
    }
  }
  return sanitizeContributors(merged, {
    keepNameOnly: true,
  }) as RepoContributor[];
}
