/** Kind 32267 `summary` and official gittr repo About. */
export const GITTR_ANDROID_SUMMARY =
  "Decentralized and discoverable Nostr gits, apps and pages";

/** Old GitHub / 30617 blurb still on relays and github.com/arbadacarbaYK/gittr. */
const STALE_GITTR_ABOUT = /^host your git repositories on nostr/i;

export function isStaleGittrAbout(description?: string | null): boolean {
  return STALE_GITTR_ABOUT.test((description || "").trim());
}
