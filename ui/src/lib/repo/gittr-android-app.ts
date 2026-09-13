/**
 * Official gittr Android package (WebView of gittr.space).
 * Third-party announce still uses `space.gittr.<repo-slug>`.
 */
import { GITTR_OWNER_PUBKEY_HEX } from "../gittr-repo-links";

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
    ids.push(GITTR_ANDROID_APP_ID, GITTR_LEGACY_SUGGESTED_APP_ID);
  }
  return [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
}
