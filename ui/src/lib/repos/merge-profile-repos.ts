/**
 * Merge profile repository lists from localStorage and /api/nostr/profile-repos.
 * Network rows are often sparse (slug + timestamps); never wipe richer local fields.
 */
import { nip19 } from "nostr-tools";

import {
  isRealForkAttribution,
  sanitizeForkedFromField,
} from "./fork-attribution";

function ownerHexForProfileKey(r: {
  ownerPubkey?: string;
  entity?: string;
}): string {
  const hex = String(r.ownerPubkey || "").toLowerCase();
  if (/^[0-9a-f]{64}$/.test(hex)) return hex;
  const entity = String(r.entity || "").trim();
  if (entity.startsWith("npub")) {
    try {
      const decoded = nip19.decode(entity);
      if (decoded.type === "npub" && typeof decoded.data === "string") {
        return decoded.data.toLowerCase();
      }
    } catch {
      /* ignore */
    }
  }
  return entity.toLowerCase();
}

export function profileRepoRowKey(r: {
  ownerPubkey?: string;
  entity?: string;
  repo?: string;
  slug?: string;
}): string {
  return `${ownerHexForProfileKey(r)}/${(
    r.repo ||
    r.slug ||
    ""
  ).toLowerCase()}`;
}

export type ProfileRepoUserRole =
  | "owner"
  | "maintainer"
  | "contributor"
  | "forked";

/** Theme-purple forked vs owner for the npub that announced this repo. */
export function profileAnnouncerRole(repo: {
  forkedFrom?: string | null;
  sourceUrl?: string | null;
  clone?: unknown;
}): "owner" | "forked" {
  const clone = Array.isArray(repo.clone)
    ? repo.clone.map((c) => (c == null ? "" : String(c)))
    : undefined;
  return isRealForkAttribution(repo.forkedFrom, {
    sourceUrl: repo.sourceUrl,
    clone,
  })
    ? "forked"
    : "owner";
}

/**
 * Badge/border role on a profile repo card.
 * If this profile announced the repo, owner vs forked follows real `forkedFrom`
 * (not a stale stored pill, and not “has any GitHub URL”). Otherwise stored
 * maintainer/contributor wins; matching ownerPubkey without a role is owner.
 */
export function profileRepoDisplayRole(
  repo: {
    userRole?: string | null;
    ownerPubkey?: string | null;
    forkedFrom?: string | null;
    sourceUrl?: string | null;
    clone?: unknown;
  },
  profileHex: string | null | undefined
): ProfileRepoUserRole | undefined {
  const ownerHex = String(repo.ownerPubkey || "").toLowerCase();
  const profile = String(profileHex || "").toLowerCase();
  if (
    /^[0-9a-f]{64}$/.test(ownerHex) &&
    /^[0-9a-f]{64}$/.test(profile) &&
    ownerHex === profile
  ) {
    return profileAnnouncerRole(repo);
  }
  const stored = String(repo.userRole || "")
    .trim()
    .toLowerCase();
  if (stored === "maintainer" || stored === "contributor") {
    return stored;
  }
  return undefined;
}

export function profileRepoLatestMs(r: {
  lastNostrEventCreatedAt?: number;
  updatedAt?: number;
  createdAt?: number;
  lastActivity?: number;
}): number {
  if (r.lastNostrEventCreatedAt != null) {
    return r.lastNostrEventCreatedAt * 1000;
  }
  return r.updatedAt || r.createdAt || r.lastActivity || 0;
}

function nonEmptyString(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t.length > 0 ? t : undefined;
}

/** Prefer a human title over the bare d-tag slug. */
export function preferRepoDisplayName(
  primary?: string | null,
  fallback?: string | null,
  slug?: string | null
): string {
  const a = nonEmptyString(primary);
  const b = nonEmptyString(fallback);
  const s = nonEmptyString(slug) || "";
  const score = (n: string | undefined) => {
    if (!n) return -1;
    if (s && n.toLowerCase() === s.toLowerCase()) {
      // Exact slug loses to a differently-cased slug-like title ("Nostr" > "nostr")
      return n === s ? 0 : 0.5;
    }
    return 1000 + n.length;
  };
  if (score(a) >= score(b) && a) return a;
  if (b) return b;
  return a || s;
}

/**
 * `base` = newer / preferred for timestamps & ids.
 * `other` = fill gaps (description, role, richer name, etc.).
 */
export function mergeProfileRepoFields(base: any, other: any): any {
  if (!other) return base;
  if (!base) return other;

  const slug = base.repo || base.slug || other.repo || other.slug;
  const description =
    nonEmptyString(base.description) || nonEmptyString(other.description);
  const name = preferRepoDisplayName(base.name, other.name, slug);

  const publicRead =
    base.publicRead === false || other.publicRead === false
      ? false
      : base.publicRead ?? other.publicRead;

  const contributors =
    Array.isArray(base.contributors) && base.contributors.length > 0
      ? base.contributors
      : Array.isArray(other.contributors)
      ? other.contributors
      : base.contributors;

  return {
    ...other,
    ...base,
    name,
    repo: base.repo || other.repo || slug,
    slug: base.slug || other.slug || slug,
    description: description || base.description || other.description,
    userRole: base.userRole || other.userRole,
    contributors,
    logoUrl: base.logoUrl || other.logoUrl,
    sourceUrl: base.sourceUrl || other.sourceUrl,
    forkedFrom:
      sanitizeForkedFromField(base.forkedFrom, {
        sourceUrl: base.sourceUrl || other.sourceUrl,
        clone:
          Array.isArray(base.clone) && base.clone.length > 0
            ? base.clone
            : other.clone,
      }) ||
      sanitizeForkedFromField(other.forkedFrom, {
        sourceUrl: base.sourceUrl || other.sourceUrl,
        clone:
          Array.isArray(base.clone) && base.clone.length > 0
            ? base.clone
            : other.clone,
      }),
    publicRead,
    syncedFromNostr: !!(base.syncedFromNostr || other.syncedFromNostr),
    fromNostr: !!(base.fromNostr || other.fromNostr),
    lastNostrEventId: base.lastNostrEventId || other.lastNostrEventId,
    nostrEventId: base.nostrEventId || other.nostrEventId,
    ownerPubkey: base.ownerPubkey || other.ownerPubkey,
    entity: base.entity || other.entity,
    clone:
      Array.isArray(base.clone) && base.clone.length > 0
        ? base.clone
        : other.clone,
    updatedAt:
      Math.max(Number(base.updatedAt) || 0, Number(other.updatedAt) || 0) ||
      base.updatedAt ||
      other.updatedAt,
    lastNostrEventCreatedAt:
      base.lastNostrEventCreatedAt ?? other.lastNostrEventCreatedAt,
    ...(base.lastNostrEventId ||
    other.lastNostrEventId ||
    base.syncedFromNostr ||
    other.syncedFromNostr
      ? {
          status:
            base.status === "local"
              ? other.status === "local"
                ? undefined
                : other.status
              : base.status,
        }
      : {}),
  };
}

/**
 * Seed with `next` (e.g. API), then merge each `prev` (localStorage) so sparse
 * network rows do not erase About text / roles / display names.
 */
export function mergeProfileRepoList(prev: any[], next: any[]): any[] {
  const map = new Map<string, any>();

  for (const r of next || []) {
    if (!r) continue;
    map.set(profileRepoRowKey(r), r);
  }

  for (const r of prev || []) {
    if (!r) continue;
    const k = profileRepoRowKey(r);
    const existing = map.get(k);
    if (!existing) {
      map.set(k, r);
      continue;
    }
    const preferPrev = profileRepoLatestMs(r) > profileRepoLatestMs(existing);
    const base = preferPrev ? r : existing;
    const other = preferPrev ? existing : r;
    map.set(k, mergeProfileRepoFields(base, other));
  }

  return Array.from(map.values()).sort(
    (a, b) => profileRepoLatestMs(b) - profileRepoLatestMs(a)
  );
}
