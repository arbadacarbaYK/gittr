/**
 * NIP-34 discovery relays for profile / repo lookup. Many NostrHub / ngit
 * announcements never land on gittr's Pyramid relay — without these, profiles
 * under-count vs Explore.
 *
 * Keep this module free of Node-only imports so the profile page can use it.
 */

/** Small relay set for lightweight server-side stats. */
export const PLATFORM_STATS_RELAYS = [
  "wss://relay.gittr.space",
  "wss://nos.lol",
];

export const NIP34_DISCOVERY_RELAYS = [
  "wss://relay.gittr.space",
  "wss://relay.ngit.dev",
  "wss://git.shakespeare.diy",
  "wss://git.nostrhub.io",
  "wss://gitnostr.com",
  "wss://nos.lol",
];

/** Union used by profile-repos (and similar author-scoped 30617 queries). */
export const PROFILE_REPOS_RELAYS = Array.from(
  new Set([...PLATFORM_STATS_RELAYS, ...NIP34_DISCOVERY_RELAYS])
);

/** Browser profile scan: app relays plus NIP-34 discovery (same as file fetch). */
export function profileRepoRelaysForClient(defaultRelays: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const url of [...(defaultRelays || []), ...NIP34_DISCOVERY_RELAYS]) {
    const trimmed = String(url || "").trim();
    if (!trimmed.startsWith("wss://") || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}
