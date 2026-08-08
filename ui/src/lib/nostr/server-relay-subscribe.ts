/**
 * Server-side Nostr subscribe adapter (RelayPool) matching the client subscribe signature
 * used by stats.ts count*FromNostr helpers.
 */

/** Small relay set for lightweight server-side stats — avoids opening many websockets. */
export const PLATFORM_STATS_RELAYS = [
  "wss://relay.gittr.space",
  "wss://nos.lol",
  "wss://relay.damus.io",
];

/**
 * NIP-34 discovery relays for profile / repo lookup. Many NostrHub / ngit
 * announcements never land on gittr's Pyramid relay — without these, profiles
 * under-count vs Explore (SEO snapshot) and Explore live sync.
 */
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

export type NostrSubscribeFn = (
  filters: unknown[],
  relays: string[],
  onEvent: (
    event: {
      kind: number;
      pubkey: string;
      created_at: number;
      tags?: string[][];
    },
    isAfterEose: boolean,
    relayURL?: string
  ) => void,
  maxDelayms?: number,
  onEose?: (relayUrl: string, minCreatedAt: number) => void,
  options?: unknown
) => () => void;

export async function withRelayPoolSubscribe<T>(
  relays: string[],
  run: (subscribe: NostrSubscribeFn) => Promise<T>
): Promise<T> {
  const { RelayPool } = await import("nostr-relaypool");
  const pool = new RelayPool(relays);
  const subscribe: NostrSubscribeFn = (
    filters,
    relayUrls,
    onEvent,
    maxDelayms,
    onEose,
    options
  ) =>
    pool.subscribe(
      filters,
      relayUrls,
      onEvent,
      maxDelayms,
      onEose,
      options as Record<string, unknown> | undefined
    );
  try {
    return await run(subscribe);
  } finally {
    try {
      (pool as { close?: () => void }).close?.();
    } catch {
      /* ignore */
    }
  }
}
