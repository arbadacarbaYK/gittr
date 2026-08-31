/**
 * Server-side helper to fetch Nostr user metadata (kind 0) from relays
 * Used in API routes where we don't have access to React context
 */
import { nip19 } from "nostr-tools";

import { applyKind0NameFields } from "./kind0-profile-fields";

/** Prefer gittr/own relays for SSR — Damus auto-reconnect leaks memory when races abandon pools. */
const DEFAULT_RELAYS = [
  "wss://relay.gittr.space",
  "wss://nos.lol",
  "wss://relay.noderunners.network",
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
    // dontAutoReconnect: generateMetadata races this at ~1.5s; abandoned pools must not reconnect forever
    const pool = new RelayPool(targetRelays, { dontAutoReconnect: true });

    return new Promise((resolve) => {
      let resolved = false;
      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          try {
            pool.close();
          } catch {
            /* ignore */
          }
          resolve(null);
        }
      }, 1500);

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
          try {
            pool.close();
          } catch {
            /* ignore */
          }

          try {
            const metadata = applyKind0NameFields(
              JSON.parse(event.content || "{}") as Record<string, unknown>
            ) as {
              lud16?: string;
              lnurl?: string;
              [key: string]: unknown;
            };
            resolve({
              lud16: metadata.lud16,
              lnurl: metadata.lnurl,
              ...metadata,
            });
          } catch {
            resolve(null);
          }
        }
        // Do not abort on first EOSE — other relays in the pool may still
        // answer (profile directories often lag behind empty EOSes).
      );
    });
  } catch (error) {
    console.error("Failed to fetch user metadata:", error);
    return null;
  }
}
