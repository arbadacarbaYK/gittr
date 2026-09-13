/**
 * Official gittr Android package (WebView of gittr.space).
 * Third-party announce still uses `space.gittr.<repo-slug>`.
 */
import { GITTR_OWNER_PUBKEY_HEX } from "../gittr-repo-links";
import { isPlaceholderRepositoryDescription } from "../repos/repo-about-text";
import {
  extractKnownForgeRepo,
  forgeRawLogoUrl,
  pickRepoLogoFilePath,
} from "../repos/resolve-repo-display-icon";

import { GITTR_ANDROID_SUMMARY, isStaleGittrAbout } from "./gittr-product-copy";

/** Android `applicationId` / Zapstore `d` tag. Not `space.gittr.gittr`. */
export const GITTR_ANDROID_APP_ID = "space.gittr.app";

/** Slug of the operator gittr repo on gittr.space / GitHub. */
export const GITTR_ANDROID_REPO_SLUG = "gittr";

/**
 * Catalog topics from root `zapstore.yaml`. Used when announcing the official
 * app so listings keep git/nostr/bitcoin/lightning instead of only `android`.
 */
export const GITTR_OFFICIAL_APP_TOPICS = [
  "git",
  "nostr",
  "bitcoin",
  "lightning",
] as const;

/** Older auto-suggest before the Android package id was special-cased. */
export const GITTR_LEGACY_SUGGESTED_APP_ID = "space.gittr.gittr";

/**
 * First gittr announce used the display name as `d` (a second listing).
 * Your Apps can NIP-09-delete this without touching `space.gittr.app`.
 */
export const GITTR_STRAY_APP_IDS = ["GITTR"] as const;

/** Public bird on a dark plate (same file as zapstore.yaml `icon`). */
export const GITTR_ANDROID_ICON_URL =
  "https://gittr.space/android-chrome-512x512.png";

/** Phone screenshots for kind 32267 `image` tags / zapstore.yaml `images`. */
export const GITTR_ANDROID_SCREENSHOT_URLS = [
  "https://gittr.space/zapstore/home.png",
  "https://gittr.space/zapstore/apps.png",
  "https://gittr.space/zapstore/repo.png",
] as const;

export const GITTR_ANDROID_HOMEPAGE_URL = "https://gittr.space";

export { GITTR_ANDROID_SUMMARY } from "./gittr-product-copy";

export const GITTR_ANDROID_LICENSE = "AGPL-3.0";

export function normalizeRepoSlug(repo?: string | null): string {
  return (repo || "")
    .replace(/\.git$/i, "")
    .trim()
    .toLowerCase();
}

/** True only for the operator’s `gittr` repo — not forks named gittr. */
export function isOfficialGittrAndroidRepo(args: {
  repo?: string | null;
  ownerPubkeyHex?: string | null;
}): boolean {
  const repo = normalizeRepoSlug(args.repo);
  const pk = (args.ownerPubkeyHex || "").trim().toLowerCase();
  return repo === GITTR_ANDROID_REPO_SLUG && pk === GITTR_OWNER_PUBKEY_HEX;
}

/**
 * Topics copied onto kind 32267 `t` tags: repo NIP-34 topics first, then
 * official zapstore.yaml tags when this is gittr itself.
 */
export function topicsForNip82Announce(args: {
  repoTopics?: string[] | null;
  repo?: string | null;
  ownerPubkeyHex?: string | null;
}): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string) => {
    const v = raw.trim();
    if (!v) return;
    const key = v.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(v);
  };
  for (const t of args.repoTopics || []) {
    if (typeof t === "string") push(t);
  }
  if (isOfficialGittrAndroidRepo(args)) {
    for (const t of GITTR_OFFICIAL_APP_TOPICS) push(t);
  }
  return out;
}

/** App ids to look up when deleting announce events for this repo. */
export function appIdsToMatchForRepoDelete(args: {
  repo: string;
  ownerPubkeyHex: string;
  suggestedAppId: string;
}): string[] {
  const ids = [args.suggestedAppId];
  if (isOfficialGittrAndroidRepo(args)) {
    ids.push(
      GITTR_ANDROID_APP_ID,
      GITTR_LEGACY_SUGGESTED_APP_ID,
      ...GITTR_STRAY_APP_IDS
    );
  }
  return [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
}

function httpsUrlOrUndefined(raw?: string | null): string | undefined {
  const t = (raw || "").trim();
  if (!t) return undefined;
  try {
    const u = new URL(t);
    if (u.protocol !== "https:" && u.protocol !== "http:") return undefined;
    if (u.username || u.password) return undefined;
    if (u.pathname.startsWith("/api/og/repo-image")) return undefined;
    return u.toString();
  } catch {
    return undefined;
  }
}

function firstKnownForge(args: {
  sourceUrl?: string | null;
  cloneUrls?: string[] | null;
}) {
  const urls: string[] = [];
  if (args.sourceUrl?.trim()) urls.push(args.sourceUrl.trim());
  for (const c of args.cloneUrls || []) {
    if (typeof c === "string" && c.trim()) urls.push(c.trim());
  }
  for (const u of urls) {
    const forge = extractKnownForgeRepo(u);
    if (forge) return forge;
  }
  return null;
}

function forgeHttpsLogoFromRepoPath(args: {
  logoPath: string;
  sourceUrl?: string | null;
  cloneUrls?: string[] | null;
  defaultBranch?: string | null;
}): string | undefined {
  const path = args.logoPath.replace(/^\/+/, "").trim();
  if (!path || path.includes("..") || path.includes("://")) return undefined;
  const forge = firstKnownForge(args);
  if (!forge) return undefined;
  return httpsUrlOrUndefined(
    forgeRawLogoUrl(forge, path, args.defaultBranch || "main")
  );
}

/**
 * Kind 32267 `summary`. Official gittr uses the product about unless the
 * owner already wrote a different non-placeholder description.
 */
export function summaryForNip82Announce(args: {
  repo?: string | null;
  ownerPubkeyHex?: string | null;
  repoSummary?: string | null;
}): string {
  const raw = (args.repoSummary || "").trim().slice(0, 280);
  if (!isOfficialGittrAndroidRepo(args)) return raw;
  if (
    !raw ||
    isPlaceholderRepositoryDescription(
      raw,
      args.repo || GITTR_ANDROID_REPO_SLUG
    ) ||
    isStaleGittrAbout(raw)
  ) {
    return GITTR_ANDROID_SUMMARY;
  }
  return raw;
}

/**
 * Kind 32267 `icon`. Official gittr always uses the dark-plate bird PNG.
 * Other apps use a public http(s) Settings logo, or the same forge `logo.*`
 * file the repo header already shows (relative `/logo.svg` is rewritten).
 * Owner avatars and gittr’s `/api/og/repo-image` are not app icons.
 */
export function iconUrlForNip82Announce(args: {
  repo?: string | null;
  ownerPubkeyHex?: string | null;
  repoLogoUrl?: string | null;
  sourceUrl?: string | null;
  cloneUrls?: string[] | null;
  files?: Array<{ path?: string } | string> | null;
  defaultBranch?: string | null;
}): string | undefined {
  if (isOfficialGittrAndroidRepo(args)) return GITTR_ANDROID_ICON_URL;
  const direct = httpsUrlOrUndefined(args.repoLogoUrl);
  if (direct) return direct;
  const stored = (args.repoLogoUrl || "").trim();
  if (
    stored &&
    !/^https?:\/\//i.test(stored) &&
    !stored.startsWith("data:") &&
    !stored.startsWith("/api/")
  ) {
    const fromStored = forgeHttpsLogoFromRepoPath({
      logoPath: stored,
      sourceUrl: args.sourceUrl,
      cloneUrls: args.cloneUrls,
      defaultBranch: args.defaultBranch,
    });
    if (fromStored) return fromStored;
  }
  const filePath = pickRepoLogoFilePath(args.files, args.repo);
  if (!filePath) return undefined;
  return forgeHttpsLogoFromRepoPath({
    logoPath: filePath,
    sourceUrl: args.sourceUrl,
    cloneUrls: args.cloneUrls,
    defaultBranch: args.defaultBranch,
  });
}
