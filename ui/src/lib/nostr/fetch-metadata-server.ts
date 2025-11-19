/**
 * Server-side helper to fetch Nostr user metadata (kind 0) from relays
 * Used in API routes where we don't have access to React context
 */

import { nip19 } from "nostr-tools";

const DEFAULT_RELAYS = [
  "wss://relay.damus.io",
  "wss://relay.noderunners.network",
  "wss://nos.lol",
];

/**
 * Fetch user metadata (kind 0) from Nostr relays
 * @param pubkeyOrNpub - User's pubkey (hex) or npub
 * @param relays - Optional list of relays (defaults to common relays)
 * @returns User metadata with lud16/lnurl, or null if not found
 */
export async function fetchUserMetadata(
  pubkeyOrNpub: string,
  relays?: string[]
): Promise<{ lud16?: string; lnurl?: string; [key: string]: any } | null> {
  try {
    // Decode npub to pubkey if needed
    let pubkey = pubkeyOrNpub;
    if (pubkeyOrNpub.startsWith("npub")) {
      try {
        const decoded = nip19.decode(pubkeyOrNpub);
        pubkey = decoded.data as string;
      } catch {
        return null;
      }
    }

    // Validate pubkey format
    if (!/^[0-9a-f]{64}$/i.test(pubkey)) {
      return null;
    }

    const targetRelays = relays || DEFAULT_RELAYS;
    
    // Use dynamic import to avoid SSR issues
    const { RelayPool } = await import("nostr-relaypool");
    const pool = new RelayPool(targetRelays);

    return new Promise((resolve) => {
      let resolved = false;
      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          pool.close();
          resolve(null);
        }
      }, 5000); // 5 second timeout

      pool.subscribe(
        [
          {
            kinds: [0],
            authors: [pubkey],
          },
        ],
        targetRelays,
        (event) => {
          if (resolved) return;
          resolved = true;
          clearTimeout(timeout);
          pool.close();

          try {
            const metadata = JSON.parse(event.content || "{}");
            resolve({
              lud16: metadata.lud16,
              lnurl: metadata.lnurl,
              ...metadata,
            });
          } catch {
            resolve(null);
          }
        },
        undefined,
        () => {
          // EOSE - no more events
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            pool.close();
            resolve(null);
          }
        }
      );
    });
  } catch (error) {
    console.error("Failed to fetch user metadata:", error);
    return null;
  }
}

