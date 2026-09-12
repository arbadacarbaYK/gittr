import {
  GITTR_OWNER_PUBKEY_HEX,
  GITTR_PAGES_ALIAS_D_TAGS,
  GITTR_PAGES_CANONICAL_D_TAGS,
} from "../gittr-repo-links";
import { slugToNsiteDTag } from "../nsite/nsite-url";
import type { StoredRepo } from "../repos/storage";
import { findRepoByEntityAndName } from "../utils/repo-finder";

/**
 * Slugs we never allow as the public Pages segment (scams + gittr product surface).
 * Keep lowercase; matching is case-insensitive after normalization.
 */
export const GITTR_PAGES_RESERVED_SLUGS = new Set(
  [
    "www",
    "api",
    "app",
    "apps",
    "admin",
    "root",
    "host",
    "mail",
    "email",
    "ftp",
    "ssh",
    "git",
    "cdn",
    "static",
    "assets",
    "status",
    "health",
    "metrics",
    "shop",
    "store",
    "pay",
    "payment",
    "wallet",
    "billing",
    "invoice",
    "lnurl",
    "nwc",
    "login",
    "signin",
    "signup",
    "logout",
    "oauth",
    "auth",
    "verify",
    "secure",
    "support",
    "help",
    "info",
    "contact",
    "donate",
    "abuse",
    "legal",
    "terms",
    "privacy",
    "security",
    "update",
    "download",
    "install",
    "ns",
    "mx",
    "dmarc",
    "pages",
    "gittr",
    "nostr",
    "bridge",
    "relay",
    "well-known",
    "localhost",
  ].map((s) => s.toLowerCase())
);

/** Platform operator may use reserved product names (gittr, gittr-helper, …). */
export const GITTR_PAGES_RESERVED_SLUG_EXEMPT_PUBKEYS = new Set([
  GITTR_OWNER_PUBKEY_HEX.toLowerCase(),
]);

export function isPagesReservedSlugExemptOwner(
  ownerPubkeyHex?: string | null
): boolean {
  const pk =
    typeof ownerPubkeyHex === "string"
      ? ownerPubkeyHex.trim().toLowerCase()
      : "";
  return !!pk && GITTR_PAGES_RESERVED_SLUG_EXEMPT_PUBKEYS.has(pk);
}

export function isReservedPagesSlug(
  dTag: string,
  ownerPubkeyHex?: string | null
): boolean {
  const n = dTag.trim().toLowerCase();
  if (!n) return true;
  if (isPagesReservedSlugExemptOwner(ownerPubkeyHex)) return false;
  if (GITTR_PAGES_RESERVED_SLUGS.has(n)) return true;
  /** Block obvious typosquats on reserved roots */
  for (const r of GITTR_PAGES_RESERVED_SLUGS) {
    if (n.startsWith(`${r}-`) || n.startsWith(`${r}_`)) return true;
  }
  return false;
}

/** NIP-5A d-tag rules via existing repo slug normalizer. */
export function normalizePagesSiteSlugInput(raw: string): string {
  return slugToNsiteDTag(raw.trim() || "site");
}

/**
 * Effective named-site `d` tag for URLs and manifests: optional `pagesSiteSlug`
 * on the stored repo (this *is* the public Pages hostname segment, 1–13 chars),
 * otherwise derived from the URL repo segment (truncated, e.g. conference-loop
 * → conference-lo).
 */
export function defaultRepoPagesDTag(
  decodedRepoSlug: string,
  ownerPubkeyHex?: string | null
): string {
  if (isPagesReservedSlugExemptOwner(ownerPubkeyHex)) {
    const canon =
      GITTR_PAGES_CANONICAL_D_TAGS[decodedRepoSlug.trim().toLowerCase()];
    if (canon) return canon;
  }
  return slugToNsiteDTag(decodedRepoSlug);
}

export function extraPagesDTagsForRepo(
  decodedRepoSlug: string,
  ownerPubkeyHex?: string | null
): string[] {
  const out = new Set<string>();
  const truncated = slugToNsiteDTag(decodedRepoSlug).toLowerCase();
  if (truncated) out.add(truncated);
  if (isPagesReservedSlugExemptOwner(ownerPubkeyHex)) {
    const key = decodedRepoSlug.trim().toLowerCase();
    const canon = GITTR_PAGES_CANONICAL_D_TAGS[key];
    if (canon) out.add(canon.toLowerCase());
    for (const alias of GITTR_PAGES_ALIAS_D_TAGS[key] || []) {
      out.add(alias.toLowerCase());
    }
  }
  return [...out];
}

export function resolveRepoPagesDTag(
  decodedRepoSlug: string,
  repo?: Pick<
    StoredRepo,
    "pagesSiteSlug" | "repo" | "slug" | "name" | "ownerPubkey"
  > | null
): string {
  const custom = repo?.pagesSiteSlug?.trim();
  if (!custom) {
    return defaultRepoPagesDTag(decodedRepoSlug, repo?.ownerPubkey);
  }
  const d = normalizePagesSiteSlugInput(custom);
  if (isReservedPagesSlug(d, repo?.ownerPubkey)) {
    return defaultRepoPagesDTag(decodedRepoSlug, repo?.ownerPubkey);
  }
  return d;
}

export function suggestPagesSlugAlternatives(baseDTag: string): string[] {
  const b = baseDTag.replace(/-\d+$/, "").replace(/-+$/g, "") || "site";
  const out: string[] = [];
  for (let i = 2; i <= 5; i++) {
    out.push(slugToNsiteDTag(`${b}-${i}`));
  }
  const rnd = Math.random().toString(36).slice(2, 6);
  out.push(slugToNsiteDTag(`${b}-${rnd}`));
  return Array.from(new Set(out))
    .filter((s) => !isReservedPagesSlug(s))
    .slice(0, 6);
}

function repoRouteSlug(r: StoredRepo): string {
  const raw = String(r.repo || r.slug || r.name || "").trim();
  if (!raw) return "";
  const parts = raw.split("/");
  return (parts[parts.length - 1] || raw).trim();
}

/**
 * Another repo under the same owner pubkey already uses this `d` tag → would
 * overwrite the same NIP-5A replaceable slot on publish.
 */
export function findOwnerPagesDTagConflict(args: {
  repos: StoredRepo[];
  entity: string;
  decodedRepoSlug: string;
  ownerPubkeyHex: string;
  candidateDTag: string;
}): string | null {
  const owner = args.ownerPubkeyHex.toLowerCase();
  const self = findRepoByEntityAndName(
    args.repos,
    args.entity,
    args.decodedRepoSlug
  );
  for (const r of args.repos) {
    if (!r.ownerPubkey || r.ownerPubkey.toLowerCase() !== owner) continue;
    if (self && r === self) continue;
    const slug = repoRouteSlug(r);
    if (!slug) continue;
    const dOther = resolveRepoPagesDTag(slug, r);
    if (dOther === args.candidateDTag) {
      return slug;
    }
  }
  return null;
}

export type PagesSiteSlugCommitResult =
  | { ok: true; stored: string | undefined; dTag: string }
  | { ok: false; message: string; suggestions?: string[] };

export function evaluatePagesSiteSlugInput(args: {
  raw: string | null | undefined;
  decodedRepoSlug: string;
  ownerPubkeyHex: string;
  repos: StoredRepo[];
  entity: string;
}): PagesSiteSlugCommitResult {
  const trimmed = (args.raw ?? "").trim();
  if (!trimmed) {
    return {
      ok: true,
      stored: undefined,
      dTag: defaultRepoPagesDTag(args.decodedRepoSlug, args.ownerPubkeyHex),
    };
  }
  const d = normalizePagesSiteSlugInput(trimmed);
  if (isReservedPagesSlug(d, args.ownerPubkeyHex)) {
    return {
      ok: false,
      message: `That name is reserved or too close to a reserved name (shop, donate, login, …). Pick another.`,
      suggestions: suggestPagesSlugAlternatives(d),
    };
  }
  const other = findOwnerPagesDTagConflict({
    repos: args.repos,
    entity: args.entity,
    decodedRepoSlug: args.decodedRepoSlug,
    ownerPubkeyHex: args.ownerPubkeyHex,
    candidateDTag: d,
  });
  if (other) {
    return {
      ok: false,
      message: `You already use this site name on another repo (“${other}”). Each name must be unique for your account on Pages.`,
      suggestions: suggestPagesSlugAlternatives(d),
    };
  }
  /** Persist canonical normalized d-tag (NIP charset/length), not raw typing. */
  return { ok: true, stored: d, dTag: d };
}
