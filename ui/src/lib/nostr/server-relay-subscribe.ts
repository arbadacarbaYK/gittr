/**
 * Server-side Nostr subscribe adapter (RelayPool) matching the client subscribe signature
 * used by stats.ts count*FromNostr helpers.
 */
import { KNOWN_GRASP_DOMAINS } from "@/lib/utils/grasp-servers";

export const PLATFORM_STATS_RELAYS = [
  ...KNOWN_GRASP_DOMAINS.map((d) => `wss://${d}`),
  "wss://nos.lol",
  "wss://relay.damus.io",
];

export type NostrSubscribeFn = (
  filters: unknown[],
  relays: string[],
  onEvent: (
    event: { kind: number; pubkey: string; created_at: number; tags?: string[][] },
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
