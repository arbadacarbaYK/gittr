/**
 * GRASP List Utilities (NIP-34 kind 10317)
 *
 * Handles fetching and parsing user GRASP lists (preferred GRASP servers)
 * Similar to NIP-65 relay lists and NIP-B7 blossom lists
 *
 * Per NIP-34: https://github.com/nostrability/schemata/tree/master/nips/nip-34
 */
import { KIND_GRASP_LIST } from "@/lib/nostr/events";
import { normalizeGraspHost } from "@/lib/utils/grasp-servers";

export interface GraspListData {
  graspServers: string[]; // GRASP server URLs (wss://) in order of preference
  pubkey: string; // User pubkey who owns this list
  eventId?: string; // Event ID of the GRASP list event
  createdAt?: number; // Event creation timestamp
}

/**
 * Parse a GRASP list event (kind 10317) into structured data
 * @param event - Nostr event (kind 10317)
 * @returns Parsed GRASP list data or null if invalid
 */
export function parseGraspListEvent(event: any): GraspListData | null {
  if (!event || event.kind !== KIND_GRASP_LIST) {
    return null;
  }

  const graspServers: string[] = [];

  // Extract "g" tags (GRASP server URLs in order of preference)
  if (event.tags && Array.isArray(event.tags)) {
    for (const tag of event.tags) {
      if (Array.isArray(tag) && tag.length >= 2 && tag[0] === "g") {
        const serverUrl = tag[1];
        // Validate that it's a websocket URL
        if (
          serverUrl &&
          (serverUrl.startsWith("wss://") || serverUrl.startsWith("ws://"))
        ) {
          graspServers.push(serverUrl);
        }
      }
    }
  }

  return {
    graspServers,
    pubkey: event.pubkey,
    eventId: event.id,
    createdAt: event.created_at,
  };
}

/**
 * Get user's preferred GRASP servers from their GRASP list
 * Falls back to default GRASP servers if no list is found
 *
 * @param subscribe - Nostr subscribe function
 * @param relays - Array of relay URLs to query
 * @param userPubkey - User pubkey to fetch GRASP list for
 * @param defaultGraspServers - Default GRASP servers to use as fallback
 * @param options.timeoutMs - Max wait (default 10000; Push uses a short value)
 * @returns Promise resolving to preferred GRASP servers in order
 */
export async function getUserGraspServers(
  subscribe: (
    filters: any[],
    relays: string[],
    onEvent: (event: any, isAfterEose: boolean, relayURL?: string) => void,
    maxDelayms?: number,
    onEose?: (relayUrl: string, minCreatedAt: number) => void,
    options?: any
  ) => () => void,
  relays: string[],
  userPubkey: string,
  defaultGraspServers: string[] = [],
  options?: { timeoutMs?: number }
): Promise<string[]> {
  const timeoutMs = options?.timeoutMs ?? 10000;
  return new Promise((resolve) => {
    let settled = false;
    let latestEvent: any = null;
    let latestCreatedAt = 0;
    let eoseCount = 0;
    const expectedEose = Math.max(relays.length, 1);

    const finish = (servers: string[], reason: string) => {
      if (settled) return;
      settled = true;
      try {
        unsub();
      } catch {
        /* ignore */
      }
      console.log(`ℹ️ [GRASP List] ${reason} (${servers.length} server(s))`);
      resolve(servers);
    };

    const fromLatestOrDefault = () => {
      if (latestEvent) {
        const parsed = parseGraspListEvent(latestEvent);
        if (parsed && parsed.graspServers.length > 0) {
          return parsed.graspServers;
        }
      }
      return defaultGraspServers;
    };

    const unsub = subscribe(
      [
        {
          kinds: [KIND_GRASP_LIST],
          authors: [userPubkey],
        },
      ],
      relays,
      (event, _isAfterEose, _relayURL) => {
        // For replaceable events, keep track of the latest one
        if (event.created_at > latestCreatedAt) {
          latestEvent = event;
          latestCreatedAt = event.created_at;
        }
      },
      Math.min(5000, timeoutMs),
      (_relayUrl: string, _minCreatedAt: number) => {
        eoseCount++;
        // Don't wait for every dead relay — enough EOSE or we already have a list
        if (
          eoseCount >= expectedEose ||
          (latestEvent && eoseCount >= Math.min(3, expectedEose))
        ) {
          const servers = fromLatestOrDefault();
          finish(
            servers,
            latestEvent
              ? "Found user GRASP list"
              : "No user GRASP list found, using defaults"
          );
        }
      }
    );

    setTimeout(() => {
      finish(
        fromLatestOrDefault(),
        latestEvent
          ? "Timeout with user GRASP list"
          : "Timeout, using default GRASP servers"
      );
    }, timeoutMs);
  });
}

/**
 * Prioritize GRASP servers based on user preferences
 * Returns GRASP servers in order: user preferences first, then defaults
 *
 * @param userGraspServers - User's preferred GRASP servers (from kind 10317)
 * @param defaultGraspServers - Default GRASP servers to use as fallback
 * @returns Prioritized list of GRASP servers
 */
export function prioritizeGraspServers(
  userGraspServers: string[],
  defaultGraspServers: string[]
): string[] {
  const seenHosts = new Set<string>();
  const prioritized: string[] = [];

  for (const server of [...userGraspServers, ...defaultGraspServers]) {
    if (!server) continue;
    const host = normalizeGraspHost(server);
    if (!host || seenHosts.has(host)) continue;
    seenHosts.add(host);
    prioritized.push(server);
  }

  return prioritized;
}

/**
 * Convert GRASP server relay URLs (wss://) to git clone URL domains
 * Extracts domain from wss:// URLs for use in clone URLs
 *
 * @param graspRelayUrls - Array of GRASP server relay URLs (wss://)
 * @returns Array of domains (without protocol) for use in clone URLs
 */
export function graspRelayUrlsToDomains(graspRelayUrls: string[]): string[] {
  return graspRelayUrls
    .map((url) => {
      // Extract domain from wss:// or ws:// URL
      const match = url.match(/^wss?:\/\/([^\/]+)/);
      return match ? match[1] : null;
    })
    .filter((domain): domain is string => domain !== null);
}

/**
 * When a NIP-34 repo event has no `clone` tags, try well-known GRASP git hosts
 * using the standard npub/{repo}.git path so the bridge can clone on first view.
 */
export function buildGraspHttpsCloneCandidates(
  entityRoute: string,
  repoName: string,
  domains: string[],
  maxServers = 4
): string[] {
  const entity = String(entityRoute || "").trim();
  const repo = String(repoName || "").trim();
  if (!entity || !repo || !domains.length) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const domain of domains.slice(0, maxServers)) {
    const host = domain.replace(/^https?:\/\//, "").replace(/\/+$/, "");
    if (!host) continue;
    const url = `https://${host}/${entity}/${repo}.git`;
    if (!seen.has(url)) {
      seen.add(url);
      out.push(url);
    }
  }
  return out;
}
