/**
 * NIP-39 external identity claims (kind 10011).
 * Legacy clients published `i` tags on kind 0 — we still read those as fallback.
 */
export const KIND_NIP39_IDENTITIES = 10011;

export type Nip39ClaimedIdentity = {
  platform: string;
  identity: string;
  proof?: string;
  verified?: boolean;
};

/** Parse `i` tags: ["i", "platform:identity", proof?] */
export function parseNip39ITags(
  tags: string[][] | undefined | null
): Nip39ClaimedIdentity[] {
  const identities: Nip39ClaimedIdentity[] = [];
  if (!Array.isArray(tags)) return identities;

  for (const tag of tags) {
    if (!Array.isArray(tag) || tag.length < 2 || tag[0] !== "i") continue;
    const identityString = tag[1];
    const proof =
      typeof tag[2] === "string" && tag[2].length > 0 ? tag[2] : undefined;
    if (typeof identityString !== "string" || !identityString.includes(":")) {
      continue;
    }
    const parts = identityString.split(":");
    const platform = parts[0]?.trim().toLowerCase();
    const identity = parts.slice(1).join(":").trim();
    if (!platform || !identity) continue;
    identities.push({
      platform,
      identity,
      proof,
      verified: false,
    });
  }
  return identities;
}

/** Build `i` tags for a kind 10011 (or legacy kind 0) event. */
export function buildNip39ITags(
  identities: Array<{
    platform?: string;
    identity?: string;
    proof?: string;
  }>
): string[][] {
  const tags: string[][] = [];
  for (const identity of identities) {
    const platform = identity.platform?.trim().toLowerCase();
    const id = identity.identity?.trim();
    if (!platform || !id) continue;
    const identityString = `${platform}:${id}`;
    if (identity.proof?.trim()) {
      tags.push(["i", identityString, identity.proof.trim()]);
    } else {
      tags.push(["i", identityString]);
    }
  }
  return tags;
}

/**
 * Prefer identities from kind 10011; fall back to kind 0 `i` tags.
 * When both exist, 10011 wins entirely (replaceable set).
 */
export function preferNip39Identities(
  fromKind10011: Nip39ClaimedIdentity[] | undefined | null,
  fromKind0: Nip39ClaimedIdentity[] | undefined | null
): Nip39ClaimedIdentity[] {
  if (Array.isArray(fromKind10011) && fromKind10011.length > 0) {
    return fromKind10011;
  }
  if (Array.isArray(fromKind0) && fromKind0.length > 0) {
    return fromKind0;
  }
  return [];
}

/** Unsigned kind 10011 skeleton (caller hashes + signs). */
export function buildNip39IdentitiesEventUnsigned(
  pubkey: string,
  identities: Array<{
    platform?: string;
    identity?: string;
    proof?: string;
  }>,
  createdAt = Math.floor(Date.now() / 1000)
): {
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
  pubkey: string;
} {
  return {
    kind: KIND_NIP39_IDENTITIES,
    created_at: createdAt,
    tags: buildNip39ITags(identities),
    content: "",
    pubkey,
  };
}
