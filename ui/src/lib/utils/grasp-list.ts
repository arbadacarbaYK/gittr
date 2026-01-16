/**
 * GRASP List Utilities (NIP-34 kind 10317)
 *
 * Handles fetching and parsing user GRASP lists (preferred GRASP servers)
 * Similar to NIP-65 relay lists and NIP-B7 blossom lists
 *
 * Per NIP-34: https://github.com/nostrability/schemata/tree/master/nips/nip-34
 */
import { KIND_GRASP_LIST } from "@/lib/nostr/events";

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
  defaultGraspServers: string[] = []
): Promise<string[]> {
  return new Promise((resolve) => {
    let latestEvent: any = null;
    let latestCreatedAt = 0;
    let eoseCount = 0;
    const expectedEose = relays.length;

    const unsub = subscribe(
      [
        {
          kinds: [KIND_GRASP_LIST],
          authors: [userPubkey],
        },
      ],
      relays,
      (event, isAfterEose, relayURL) => {
        // For replaceable events, keep track of the latest one
        if (event.created_at > latestCreatedAt) {
          latestEvent = event;
          latestCreatedAt = event.created_at;
        }
      },
      5000, // 5 second max delay
      (relayUrl: string, minCreatedAt: number) => {
        eoseCount++;
        if (eoseCount >= expectedEose) {
          unsub();

          if (latestEvent) {
            const parsed = parseGraspListEvent(latestEvent);
            if (parsed && parsed.graspServers.length > 0) {
              console.log(
                `✅ [GRASP List] Found user GRASP list with ${parsed.graspServers.length} servers`
              );
              resolve(parsed.graspServers);
              return;
            }
          }

          // Fallback to default GRASP servers
          console.log(
            `ℹ️ [GRASP List] No user GRASP list found, using default GRASP servers`
          );
          resolve(defaultGraspServers);
        }
      }
    );

    // Timeout after 10 seconds
    setTimeout(() => {
      unsub();
      if (latestEvent) {
        const parsed = parseGraspListEvent(latestEvent);
        if (parsed && parsed.graspServers.length > 0) {
          resolve(parsed.graspServers);
          return;
        }
      }
      resolve(defaultGraspServers);
    }, 10000);
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
  // Start with user preferences
  const prioritized: string[] = [...userGraspServers];

  // Add defaults that aren't already in user preferences
  for (const server of defaultGraspServers) {
    if (!prioritized.includes(server)) {
      prioritized.push(server);
    }
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
