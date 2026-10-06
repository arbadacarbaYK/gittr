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

/**
 * Cold load used to dial the Code tab's relays in the same tick as Amber.
 * Every bunker socket then landed CLOSED and Push failed until a later retry.
 * While this depth is > 0, the main pool must not open new sockets.
 */
let pauseDepth = 0;
let coldStartHold = false;
let coldTimer: ReturnType<typeof setTimeout> | null = null;
let deferredMainPoolRelays: string[] = [];
const unpausedListeners = new Set<() => void>();

export function isMainPoolPausedForBunker(): boolean {
  return pauseDepth > 0;
}

/**
 * Subscriptions must keep waiting for the whole bunker pause, not for 15s
 * after the page loaded. Settings → Delete pauses the pool while Amber dials.
 * A clock that started at page load has already expired by then, so the page
 * reopens its relays during that dial and every bunker socket closes.
 * The wait starts the first time this subscribe sees the pause.
 */
export const MAIN_POOL_PAUSE_WAIT_MS = 35000;

export function mainPoolSubscribeShouldWait(
  paused: boolean,
  firstSawPauseAt: number | null,
  now: number,
  maxWaitMs = MAIN_POOL_PAUSE_WAIT_MS
): boolean {
  if (!paused || firstSawPauseAt == null) return false;
  return now - firstSawPauseAt < maxWaitMs;
}

export function pushMainPoolBunkerPause(): void {
  pauseDepth += 1;
}

export function popMainPoolBunkerPause(): void {
  if (pauseDepth === 0) return;
  pauseDepth -= 1;
  if (pauseDepth === 0) {
    for (const listener of [...unpausedListeners]) {
      try {
        listener();
      } catch {
        /* a listener must not strand the pool */
      }
    }
  }
}

/** Remember page relays and keep the main pool from dialing until Amber warms. */
export function holdMainPoolForColdBunkerStart(relays: string[]): void {
  deferredMainPoolRelays = [...relays];
  if (coldStartHold) return;
  coldStartHold = true;
  pushMainPoolBunkerPause();
  if (coldTimer) clearTimeout(coldTimer);
  const timer = setTimeout(() => {
    console.warn(
      "[RemoteSigner] Amber bunker warm held the relay list too long — opening page relays anyway"
    );
    releaseColdBunkerStartHold();
  }, 12000);
  coldTimer = timer;
  if (typeof timer === "object" && timer && "unref" in timer) {
    timer.unref();
  }
  console.log(
    "[RemoteSigner] Holding page relays until Amber's first bunker socket can open",
    { relays: deferredMainPoolRelays.length }
  );
}

export function releaseColdBunkerStartHold(): void {
  if (coldTimer) {
    clearTimeout(coldTimer);
    coldTimer = null;
  }
  if (!coldStartHold) return;
  coldStartHold = false;
  popMainPoolBunkerPause();
}

export function consumeDeferredMainPoolRelays(): string[] {
  const urls = deferredMainPoolRelays;
  deferredMainPoolRelays = [];
  return urls;
}

export function onMainPoolUnpaused(listener: () => void): () => void {
  unpausedListeners.add(listener);
  return () => {
    unpausedListeners.delete(listener);
  };
}

export function resetMainPoolBunkerPauseForTests(): void {
  pauseDepth = 0;
  coldStartHold = false;
  if (coldTimer) clearTimeout(coldTimer);
  coldTimer = null;
  deferredMainPoolRelays = [];
  unpausedListeners.clear();
}

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

/**
 * Main-pool sockets that are still using a browser slot.
 * CONNECTING (0), OPEN (1), and CLOSING (2) all hold a slot.
 * CLOSED (3) entries do not.
 */
export function collectActiveMainPoolUrls(
  statuses: Array<[string, number]>
): string[] {
  return statuses
    .filter(([, status]) => status === 0 || status === 1 || status === 2)
    .map(([url]) => url);
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
