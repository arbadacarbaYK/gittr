/**
 * While an Amber/NIP-46 session is active, bunker transport hosts must not be
 * dialed on the app relaypool. Duplicate sockets to the same hosts starve the
 * dedicated SimplePool used for kind 24133 (see remoteSigner directPool).
 *
 * Callers must filter every main-pool entry point that can dial — not only
 * `addRelay`. `relayPool.subscribe` → `addOrGetRelay` bypasses addRelay and
 * will re-open bunker hosts from .env defaults unless stripped here.
 */

const normalize = (url: string) => url.trim().toLowerCase().replace(/\/+$/, "");

const blockedHosts = new Set<string>();

export function setBunkerMainPoolBlockedHosts(urls: string[] | null): void {
  blockedHosts.clear();
  if (!urls?.length) return;
  for (const url of urls) {
    const n = normalize(url);
    if (n.startsWith("wss://")) blockedHosts.add(n);
  }
}

export function isBunkerMainPoolBlocked(url: string): boolean {
  if (blockedHosts.size === 0) return false;
  return blockedHosts.has(normalize(url));
}

export function listBunkerMainPoolBlockedHosts(): string[] {
  return [...blockedHosts];
}

/** Strip bunker-owned hosts from a main-pool subscribe/publish relay list. */
export function filterBunkerBlockedRelays(relays: string[]): string[] {
  if (!relays?.length || blockedHosts.size === 0) return relays || [];
  return relays.filter((url) => !isBunkerMainPoolBlocked(url));
}

/**
 * nostr-relaypool keys `relayByUrl` by the exact string passed to addOrGetRelay
 * (env URLs often have a trailing slash; our bunker list strips it).
 * Closing the wrong key leaves the main-pool socket alive and Amber's
 * dedicated pool cannot OPEN the same host.
 */
export function collectBlockedRelayPoolUrls(poolUrls: string[]): string[] {
  if (!poolUrls?.length || blockedHosts.size === 0) return [];
  return poolUrls.filter((url) => isBunkerMainPoolBlocked(url));
}
