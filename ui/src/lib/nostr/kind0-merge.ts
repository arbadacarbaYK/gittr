import { applyKind0NameFields, pickProfileDisplayName } from "./kind0-profile-fields";

export type ClaimedIdentity = {
  platform: string;
  identity: string;
  proof?: string;
  verified?: boolean;
};

export type Metadata = {
  banner?: string;
  website?: string;
  nip05?: string;
  picture?: string;
  lud16?: string;
  lnurl?: string;
  nwcRecv?: string;
  display_name?: string;
  about?: string;
  name?: string;
  created_at?: number;
  identities?: ClaimedIdentity[];
};

function hasUsableProfileName(meta?: Metadata | null): boolean {
  return !!pickProfileDisplayName(meta);
}

/**
 * Merge kind-0 / HTTP profile onto an existing entry.
 *
 * Incomplete stubs (kind 10011 identities-only) must always accept name/picture
 * even when their stamped created_at is newer than kind 0 — that was poisoning
 * the UI with an old/shortened identifier.
 */
export function mergeKind0OntoExisting(
  existing: Metadata | undefined,
  incoming: Metadata,
  incomingCreatedAt?: number
): Metadata {
  incoming = applyKind0NameFields(incoming);
  const incomingTime = incomingCreatedAt ?? incoming.created_at ?? 0;
  const existingTime = existing?.created_at ?? 0;
  const existingIncomplete = !hasUsableProfileName(existing);
  const incomingHasName = hasUsableProfileName(incoming);

  const preferIncoming =
    !existing ||
    existingIncomplete ||
    (incomingHasName && incomingTime >= existingTime) ||
    (!existingIncomplete && incomingTime > existingTime);

  const base = preferIncoming
    ? { ...existing, ...incoming }
    : { ...incoming, ...existing };

  const identities =
    Array.isArray(existing?.identities) && existing.identities.length > 0
      ? existing.identities
      : Array.isArray(incoming.identities) && incoming.identities.length > 0
        ? incoming.identities
        : undefined;

  const created_at = Math.max(existingTime, incomingTime) || undefined;

  const next: Metadata = {
    ...base,
    created_at,
  };

  if (identities) next.identities = identities;
  else delete (next as { identities?: unknown }).identities;

  // If we kept an incomplete existing as "newer", still fill missing name fields.
  if (!hasUsableProfileName(next) && incomingHasName) {
    if (incoming.name) next.name = incoming.name;
    if (incoming.display_name) next.display_name = incoming.display_name;
    if (incoming.picture) next.picture = incoming.picture;
    if (incoming.banner) next.banner = incoming.banner;
    if (incoming.about) next.about = incoming.about;
    if (incoming.nip05) next.nip05 = incoming.nip05;
    if (incoming.website) next.website = incoming.website;
  }

  // Payment fields are replaceable updates (LUD-16, lnurl, NWC receive). A cached old
  // value must not permanently hide a newer kind-0 update, and we must not clobber
  // a newer cache with an older payload.
  const shouldReplacePayments = incomingTime >= existingTime;

  if (typeof incoming.lud16 === "string") {
    if (shouldReplacePayments) {
      const trimmed = incoming.lud16.trim();
      if (trimmed) next.lud16 = trimmed;
      else delete next.lud16;
    } else {
      const trimmedExisting =
        typeof existing?.lud16 === "string" ? existing.lud16.trim() : "";
      if (trimmedExisting) next.lud16 = trimmedExisting;
      else delete next.lud16;
    }
  }

  if (typeof incoming.lnurl === "string") {
    if (shouldReplacePayments) {
      const trimmed = incoming.lnurl.trim();
      if (trimmed) next.lnurl = trimmed;
      else delete next.lnurl;
    } else {
      const trimmedExisting =
        typeof existing?.lnurl === "string" ? existing.lnurl.trim() : "";
      if (trimmedExisting) next.lnurl = trimmedExisting;
      else delete next.lnurl;
    }
  }

  if (typeof incoming.nwcRecv === "string") {
    if (shouldReplacePayments) {
      const trimmed = incoming.nwcRecv.trim();
      if (trimmed) next.nwcRecv = trimmed;
      else delete next.nwcRecv;
    } else {
      const trimmedExisting =
        typeof existing?.nwcRecv === "string" ? existing.nwcRecv.trim() : "";
      if (trimmedExisting) next.nwcRecv = trimmedExisting;
      else delete next.nwcRecv;
    }
  }

  return next;
}

