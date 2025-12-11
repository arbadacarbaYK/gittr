/**
 * Utility to delete corrupted tides repos from Nostr relays
 * 
 * This publishes NIP-09 deletion events (kind 5) for known corrupted event IDs.
 * Note: Only works if you have the private key that published the original events.
 */

import { getEventHash, signEvent, getPublicKey } from "nostr-tools";
import { getNostrPrivateKey } from "@/lib/security/encryptedStorage";

// Known corrupted tides repo event IDs
export const CORRUPTED_TIDES_EVENT_IDS = [
  "28cd39385801bb7683e06e7489f89afff8df045a4d6fe7319d75a60341165ae2",
  "68ad8ad9152dfa6788c988c6ed2bc47b34ae30c71ad7f7c0ab7c0f46248f0e0b",
  "1dbc5322b24b3481e5ce078349f527b04ad6251e9f0499b851d78cc9f92c4559"
];

/**
 * Create a NIP-09 deletion event (kind 5) for a specific event ID
 */
export async function createDeletionEvent(
  eventIdToDelete: string,
  relayUrl?: string
): Promise<any> {
  const privateKey = await getNostrPrivateKey();
  const hasNip07 = typeof window !== "undefined" && window.nostr;
  
  if (!privateKey && !hasNip07) {
    throw new Error("No signing method available. Need private key or NIP-07 extension.");
  }
  
  const pubkey = privateKey ? getPublicKey(privateKey) : (hasNip07 ? await window.nostr.getPublicKey() : null);
  if (!pubkey) {
    throw new Error("Could not get public key");
  }
  
  // NIP-09: Deletion events use kind 5
  // Tags: [["e", eventId, relay, "deletion"]]
  const tags: string[][] = [["e", eventIdToDelete]];
  if (relayUrl) {
    tags[0].push(relayUrl);
  }
  tags[0].push("deletion");
  
  const deletionEvent = {
    kind: 5, // NIP-09: Deletion
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: `Deletion of corrupted tides repository event: ${eventIdToDelete}`,
    pubkey,
    id: "",
    sig: "",
  };
  
  deletionEvent.id = getEventHash(deletionEvent);
  
  if (hasNip07 && window.nostr) {
    // Sign with NIP-07
    const signedEvent = await window.nostr.signEvent(deletionEvent as any);
    return signedEvent;
  } else if (privateKey) {
    // Sign with private key
    deletionEvent.sig = signEvent(deletionEvent, privateKey);
    return deletionEvent;
  } else {
    throw new Error("No signing method available");
  }
}

/**
 * Delete all known corrupted tides repos from Nostr relays
 * 
 * WARNING: This only works if you have the private key that published the original events.
 * If the events were published by someone else, you cannot delete them.
 * 
 * Alternative: If you don't have the original keys, you can:
 * 1. Contact relay operators to manually remove the events
 * 2. Publish updated repository events with deleted: true (if you're the owner)
 * 3. Rely on client-side filtering (which we've already implemented)
 */
export async function deleteCorruptedTidesRepos(
  publish: (event: any, relays: string[]) => void,
  defaultRelays: string[]
): Promise<{ success: number; failed: number; errors: string[] }> {
  const results = {
    success: 0,
    failed: 0,
    errors: [] as string[]
  };
  
  console.log("🗑️ Attempting to delete corrupted tides repos from Nostr relays...");
  console.log("⚠️  Note: This only works if you have the private key that published the original events");
  console.log("⚠️  If you don't have the keys, these events will remain on relays but won't be stored locally");
  
  for (const eventId of CORRUPTED_TIDES_EVENT_IDS) {
    try {
      console.log(`\n🗑️ Creating deletion event for corrupted tides repo: ${eventId.slice(0, 8)}...`);
      const deletionEvent = await createDeletionEvent(eventId);
      
      console.log(`📤 Publishing deletion event to ${defaultRelays.length} relay(s)...`);
      publish(deletionEvent, defaultRelays);
      
      results.success++;
      console.log(`✅ Published deletion event for ${eventId.slice(0, 8)}...`);
    } catch (error: any) {
      results.failed++;
      const errorMsg = `Failed to delete ${eventId.slice(0, 8)}...: ${error.message}`;
      results.errors.push(errorMsg);
      console.error(`❌ ${errorMsg}`, error);
      
      if (error.message.includes("No signing method") || error.message.includes("private key")) {
        console.error("💡 This event was likely published by someone else. You cannot delete it.");
        console.error("💡 Options:");
        console.error("   1. Contact relay operators to manually remove the event");
        console.error("   2. Rely on client-side filtering (already implemented)");
        console.error("   3. If you're the owner, publish an updated event with deleted: true");
      }
    }
  }
  
  console.log(`\n📊 Deletion results: ${results.success} succeeded, ${results.failed} failed`);
  if (results.errors.length > 0) {
    console.log("❌ Errors:", results.errors);
  }
  
  return results;
}

