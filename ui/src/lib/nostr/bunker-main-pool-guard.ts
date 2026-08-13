/**
 * While an Amber/NIP-46 session is active, bunker transport hosts must not be
 * dialed on the app relaypool. Duplicate sockets to the same hosts starve the
 * dedicated SimplePool used for kind 24133 (see remoteSigner directPool).
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
