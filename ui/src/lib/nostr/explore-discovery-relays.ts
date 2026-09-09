/**
 * Relays Explore should actually dial for NIP-34 discovery.
 *
 * The page used to wait until a repo event listed extra `relays` tags, then
 * call addRelay + subscribe for every event. That:
 *   1. Left NostrHub / ngit / Shakespeare repos until long after gittr's own
 *      relay (and the SEO seed) had already painted — "only bridge repos".
 *   2. Re-dialed the same host while the socket was still CONNECTING, which
 *      kills in-flight handshakes (see NostrContext.addRelay).
 *   3. Treated websites and git HTTPS hosts (gitworkshop.dev, git.gittr.space)
 *      as wss:// relays, burning browser WebSocket slots on guaranteed failures.
 */
import { isGraspServer } from "../utils/grasp-servers";

import { NIP34_DISCOVERY_RELAYS } from "./nip34-discovery-relays";

/** Hosts that show up in NIP-34 `relays` / `web` tags but are not Nostr relays. */
export const EXPLORE_NON_RELAY_HOSTS = [
  "gitworkshop.dev",
  "git.gittr.space",
  "github.com",
  "gitlab.com",
  "codeberg.org",
  "gist.github.com",
] as const;

/** Do not auto-dial from env GRASP-first or from random NIP-34 `relays` tags. */
export const EXPLORE_DO_NOT_AUTO_DIAL_HOSTS = [
  "ngit.danconwaydev.com",
  // Dead / handshake-fail GRASP (still OK as clone tags for other people's events)
  "git-01.uid.ovh",
  "git-02.uid.ovh",
  "ngit-relay.nostrver.se",
  // Dropped from lean NEXT_PUBLIC_NOSTR_RELAYS; leftover env / NIP-65 burned sockets
  "relay.nostrich.land",
  "relay.current.fyi",
  "relay.nostr.bg",
  "nostr-relay.wlvs.space",
  "relay.nostrgraph.net",
  "relay.poster.place",
] as const;

export function normalizeExploreRelayUrl(url: string): string {
  return String(url || "")
    .trim()
    .toLowerCase()
    .replace(/\/+$/, "");
}

function hostnameFromRelayUrl(url: string): string {
  const raw = String(url || "").trim();
  if (!raw) return "";
  try {
    const withProto =
      raw.startsWith("wss://") ||
      raw.startsWith("ws://") ||
      raw.startsWith("http://") ||
      raw.startsWith("https://")
        ? raw
        : `wss://${raw}`;
    return new URL(withProto).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return "";
  }
}

function hostIsAutoDialBlocked(host: string): boolean {
  return EXPLORE_DO_NOT_AUTO_DIAL_HOSTS.some(
    (blocked) => host === blocked || host.endsWith(`.${blocked}`)
  );
}

function relayHasNonDefaultPort(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (!parsed.port) return false;
    if (parsed.protocol === "wss:" && parsed.port === "443") return false;
    if (parsed.protocol === "ws:" && parsed.port === "80") return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * True when this URL is worth a browser WebSocket for Explore discovery.
 * HTTP(S) clone/web URLs are never relays. Custom ports (:8081) are skipped
 * unless the caller already listed them as a user/default relay — event-tag
 * fan-out used to CSP-block `wss://host:8081`.
 */
export function isUsableExploreDiscoveryRelay(
  url: string,
  opts?: { allowCustomPort?: boolean }
): boolean {
  const raw = String(url || "").trim();
  if (!raw) return false;
  const lower = raw.toLowerCase();
  if (lower.startsWith("http://") || lower.startsWith("https://")) {
    return false;
  }
  const withProto =
    lower.startsWith("wss://") || lower.startsWith("ws://")
      ? raw
      : `wss://${raw}`;
  if (!/^wss?:\/\//i.test(withProto)) return false;

  const host = hostnameFromRelayUrl(withProto);
  if (!host) return false;
  if (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local")
  ) {
    return false;
  }
  if (hostIsAutoDialBlocked(host)) return false;
  if (!opts?.allowCustomPort && relayHasNonDefaultPort(withProto)) {
    return false;
  }
  // HTTPS GRASP clone paths are not Nostr WebSockets (`wss://host/grasp`).
  try {
    const pathname = new URL(withProto).pathname.toLowerCase();
    if (pathname === "/grasp" || pathname.startsWith("/grasp/")) {
      return false;
    }
  } catch {
    if (/\/grasp(\/|$)/i.test(withProto)) return false;
  }

  return !EXPLORE_NON_RELAY_HOSTS.some(
    (blocked) => host === blocked || host.endsWith(`.${blocked}`)
  );
}

function pushUniqueRelay(
  out: string[],
  seen: Set<string>,
  url: string,
  opts?: { allowCustomPort?: boolean }
): void {
  if (!isUsableExploreDiscoveryRelay(url, opts)) return;
  const accepted = rememberExploreDiscoveryRelay(url, seen, opts);
  if (accepted) out.push(accepted);
}

/**
 * Record a newly seen relay. Returns the URL to subscribe to, or null when
 * it is unusable or already queried this session.
 */
export function rememberExploreDiscoveryRelay(
  url: string,
  alreadyQueried: Set<string>,
  opts?: { allowCustomPort?: boolean }
): string | null {
  if (!isUsableExploreDiscoveryRelay(url, opts)) return null;
  const raw =
    url.startsWith("wss://") || url.startsWith("ws://")
      ? url.trim()
      : `wss://${url.trim()}`;
  const key = normalizeExploreRelayUrl(raw);
  if (!key || alreadyQueried.has(key)) return null;
  alreadyQueried.add(key);
  return raw.replace(/\/+$/, "");
}

/**
 * Initial Explore subscribe list: gittr NIP-34 hosts first, then remaining
 * app relays. Dan Conway's public GRASP is not auto-dialed — gittr has its
 * own relay, and the visitor's NIP-65 list is merged by getAllRelays.
 */
export function exploreRepoRelaysForClient(defaultRelays: string[]): string[] {
  const envList = (defaultRelays || []).filter(Boolean);
  const combined = [...NIP34_DISCOVERY_RELAYS, ...envList];
  const out: string[] = [];
  const seen = new Set<string>();

  for (const url of combined) {
    if (
      isUsableExploreDiscoveryRelay(url, { allowCustomPort: true }) &&
      isGraspServer(url)
    ) {
      pushUniqueRelay(out, seen, url, { allowCustomPort: true });
    }
  }
  for (const url of combined) {
    pushUniqueRelay(out, seen, url, { allowCustomPort: true });
  }
  return out;
}

function isImmediateExploreDiscoveryRelay(url: string): boolean {
  if (isGraspServer(url)) return true;
  const key = normalizeExploreRelayUrl(url);
  return NIP34_DISCOVERY_RELAYS.some(
    (listed) => normalizeExploreRelayUrl(listed) === key
  );
}

/**
 * Relays Explore should dial on the first subscribe. Social hosts (Damus,
 * wine, …) already occupy the main pool; opening them in the same REQ
 * starves ngit / Shakespeare / NostrHub so only long-indexed gittr seed
 * cards paint for a while.
 */
export function exploreImmediateDiscoveryRelays(
  defaultRelays: string[]
): string[] {
  const immediate = exploreRepoRelaysForClient(defaultRelays).filter(
    isImmediateExploreDiscoveryRelay
  );
  if (immediate.length > 0) return immediate;
  return NIP34_DISCOVERY_RELAYS.filter((url) =>
    isUsableExploreDiscoveryRelay(url)
  ).map((url) => url.replace(/\/+$/, ""));
}

/** Remaining app relays to subscribe after the first discovery sockets are up. */
export function exploreDeferredSocialRelays(defaultRelays: string[]): string[] {
  const immediate = new Set(
    exploreImmediateDiscoveryRelays(defaultRelays).map(normalizeExploreRelayUrl)
  );
  return exploreRepoRelaysForClient(defaultRelays).filter(
    (url) => !immediate.has(normalizeExploreRelayUrl(url))
  );
}
