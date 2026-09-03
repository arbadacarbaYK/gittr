import {
  applyKind0NameFields,
  pickProfileDisplayName,
} from "./kind0-profile-fields";

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

/** Drop future / millisecond stamps that blocked newer kind-0 lud16 merges. */
function saneEventTime(t: number): number {
  if (!t || t <= 0) return 0;
  const now = Math.floor(Date.now() / 1000);
  if (t > now + 86400) return 0;
  return t;
}

function pickIdentities(
  existing?: Metadata,
  incoming?: Metadata
): ClaimedIdentity[] | undefined {
  const fromExisting = existing?.identities;
  if (Array.isArray(fromExisting) && fromExisting.length > 0) {
    return fromExisting;
  }
  const fromIncoming = incoming?.identities;
  if (Array.isArray(fromIncoming) && fromIncoming.length > 0) {
    return fromIncoming;
  }
  return undefined;
}

function applyPaymentField(
  next: Metadata,
  key: "lud16" | "lnurl" | "nwcRecv",
  incomingValue: string | undefined,
  existingValue: string | undefined,
  replace: boolean
): void {
  if (typeof incomingValue !== "string") return;
  const chosen = replace ? incomingValue : existingValue;
  const trimmed = chosen?.trim() ?? "";
  if (trimmed) next[key] = trimmed;
  else delete next[key];
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
  const incomingTime = saneEventTime(
    incomingCreatedAt ?? incoming.created_at ?? 0
  );
  const existingTime = saneEventTime(existing?.created_at ?? 0);
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

  const identities = pickIdentities(existing, incoming);
  // Kind-0 created_at only — never Math.max with a poisoned cache stamp.
  const created_at = preferIncoming
    ? incomingTime || existingTime || undefined
    : existingTime || incomingTime || undefined;

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
  // a newer cache with an older payload. Incomplete stubs always take incoming payments.
  const shouldReplacePayments =
    !existing || existingIncomplete || incomingTime >= existingTime;
  applyPaymentField(
    next,
    "lud16",
    incoming.lud16,
    existing?.lud16,
    shouldReplacePayments
  );
  applyPaymentField(
    next,
    "lnurl",
    incoming.lnurl,
    existing?.lnurl,
    shouldReplacePayments
  );
  applyPaymentField(
    next,
    "nwcRecv",
    incoming.nwcRecv,
    existing?.nwcRecv,
    shouldReplacePayments
  );

  return next;
}
