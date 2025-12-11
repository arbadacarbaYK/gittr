/**
 * Utility to find who published corrupted tides events
 * This queries Nostr relays to get the actual pubkey that signed the corrupted events
 */

import { RelayPool } from "nostr-relaypool";

// Known corrupted tides repo event IDs
export const CORRUPTED_TIDES_EVENT_IDS = [
  "28cd39385801bb7683e06e7489f89afff8df045a4d6fe7319d75a60341165ae2",
  "68ad8ad9152dfa6788c988c6ed2bc47b34ae30c71ad7f7c0ab7c0f46248f0e0b",
  "1dbc5322b24b3481e5ce078349f527b04ad6251e9f0499b851d78cc9f92c4559"
];

/**
 * Find who published the corrupted tides events
 * Returns a map of eventId -> pubkey
 */
export async function findCorruptedEventPublishers(
  defaultRelays: string[]
): Promise<Map<string, { pubkey: string; entity?: string; content?: any }>> {
  const results = new Map<string, { pubkey: string; entity?: string; content?: any }>();
  
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      pool.close();
      resolve(results);
    }, 10000); // 10 second timeout
    
    const pool = new RelayPool(defaultRelays);
    
    const onEvent = (event: any, isAfterEose?: boolean, relayURL?: string) => {
      console.log(`🔍 Found corrupted event: ${event.id.slice(0, 8)}...`);
      console.log(`   Published by pubkey: ${event.pubkey}`);
      
      // Try to decode pubkey to npub
      let entity: string | undefined;
      try {
        const { nip19 } = require("nostr-tools");
        entity = nip19.npubEncode(event.pubkey);
        console.log(`   Entity (npub): ${entity}`);
      } catch (e) {
        console.log(`   Could not encode to npub: ${e}`);
      }
      
      // Parse content to see if entity is corrupted
      let content: any;
      try {
        content = JSON.parse(event.content || "{}");
        if (content.entity) {
          console.log(`   ⚠️  CORRUPTED entity in content: ${content.entity}`);
        }
      } catch (e) {
        console.log(`   Content parse error: ${e}`);
      }
      
      results.set(event.id, {
        pubkey: event.pubkey,
        entity,
        content
      });
      
      // If we found all events, resolve early
      if (results.size === CORRUPTED_TIDES_EVENT_IDS.length) {
        clearTimeout(timeout);
        pool.close();
        resolve(results);
      }
    };
    
    const onEose = () => {
      // All relays have sent their stored events
      if (results.size < CORRUPTED_TIDES_EVENT_IDS.length) {
        console.log(`⚠️  Only found ${results.size} of ${CORRUPTED_TIDES_EVENT_IDS.length} corrupted events`);
      }
    };
    
    pool.subscribe(
      [{
        ids: CORRUPTED_TIDES_EVENT_IDS,
      }],
      defaultRelays,
      onEvent,
      undefined, // maxDelayms
      onEose
    );
  });
}

/**
 * Make this available in browser console
 */
if (typeof window !== "undefined") {
  (window as any).findCorruptedEventPublishers = async () => {
    // This function should be called with defaultRelays parameter
    // It's already exported and can be used directly
    console.log("💡 Use findCorruptedEventPublishers(defaultRelays) directly");
    console.log("💡 Example: findCorruptedEventPublishers(['wss://relay.example.com'])");
  };
}

