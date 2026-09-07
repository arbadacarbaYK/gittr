/**
 * NIP-34 discovery relays for profile / Explore / repo lookup. Many NostrHub /
 * ngit announcements never land on gittr's Pyramid relay — without these,
 * those surfaces only show gittr-bridge repos until extra relays trickle in.
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

const NOT_NOSTR_CLONE_HOST =
  /(?:^|\.)(?:github\.com|gitlab\.com|codeberg\.org|bitbucket\.org)$/i;

/**
 * Extra relays to query for a Code-tab 30617: announcement `relays` tags plus
 * `wss://` on the same host as HTTPS `clone[]` (self-hosted / PosterChan-style).
 */
export function extraNostrRelaysFromRepoRemotes(opts: {
  relays?: string[] | null;
  clone?: string[] | null;
}): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const addRelay = (raw: string) => {
    let u = (raw || "").trim().replace(/\/+$/, "");
    if (!u) return;
    if (u.startsWith("https://")) u = `wss://${u.slice("https://".length)}`;
    else if (u.startsWith("http://")) u = `ws://${u.slice("http://".length)}`;
    if (!u.startsWith("wss://") && !u.startsWith("ws://")) {
      u = `wss://${u}`;
    }
    try {
      const parsed = new URL(u);
      if (NOT_NOSTR_CLONE_HOST.test(parsed.hostname)) return;
      const relay = `${parsed.protocol}//${parsed.host}`.replace(/\/+$/, "");
      const key = relay.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      out.push(relay);
    } catch {
      /* ignore */
    }
  };
  for (const r of opts.relays || []) {
    if (typeof r === "string") addRelay(r);
  }
  for (const c of opts.clone || []) {
    if (typeof c !== "string" || !c.trim()) continue;
    try {
      const https = c
        .trim()
        .replace(/^git@([^:]+):/, "https://$1/")
        .replace(/^git:\/\//i, "https://");
      const withProto = /:\/\//.test(https) ? https : `https://${https}`;
      addRelay(new URL(withProto).origin);
    } catch {
      /* ignore */
    }
  }
  return out;
}
