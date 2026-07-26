/**
 * NIP-39 external identity claims (kind 10011).
 *
 * Dual-layer profile contract (gittr):
 * - Kind **0** = name, display_name, picture, banner, about, nip05, lud16, …
 * - Kind **10011** = external identity `i` tags (GitHub, X, …)
 * Both are always read and merged. Saving Profile publishes **both** events.
 * Legacy clients that put `i` on kind 0 are still respected (union with 10011).
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
 * Merge identity claims from kind 10011 and legacy kind-0 `i` tags.
 * Union by `platform:identity`. When both claim the same key, prefer 10011
 * (and prefer whichever entry has a proof).
 */
export function preferNip39Identities(
  fromKind10011: Nip39ClaimedIdentity[] | undefined | null,
  fromKind0: Nip39ClaimedIdentity[] | undefined | null
): Nip39ClaimedIdentity[] {
  const byKey = new Map<string, Nip39ClaimedIdentity>();

  const add = (id: Nip39ClaimedIdentity, preferOverExisting: boolean) => {
    const key = `${id.platform}:${id.identity}`.toLowerCase();
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, id);
      return;
    }
    if (preferOverExisting) {
      byKey.set(key, {
        ...existing,
        ...id,
        proof: id.proof || existing.proof,
      });
      return;
    }
    if (!existing.proof && id.proof) {
      byKey.set(key, { ...existing, ...id });
    }
  };

  // Legacy kind 0 first, then 10011 overlays same keys
  if (Array.isArray(fromKind0)) {
    for (const id of fromKind0) add(id, false);
  }
  if (Array.isArray(fromKind10011)) {
    for (const id of fromKind10011) add(id, true);
  }
  return Array.from(byKey.values());
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
