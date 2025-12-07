// NIP-25: Repository star reactions and NIP-51: Following lists
import { Filter, Event } from "nostr-tools";
import { KIND_REACTION } from "./events";

/**
 * Query star reactions for a repository from Nostr relays
 * Returns aggregated star count and list of users who starred
 */
export async function queryRepoStars(
  subscribe: (filters: Filter[], onEvent: (event: Event) => void) => () => void,
  repoEventId: string
): Promise<{ count: number; starers: string[] }> {
  return new Promise((resolve) => {
    const starers = new Set<string>();
    
    const filters: Filter[] = [
      {
        kinds: [KIND_REACTION],
        "#e": [repoEventId], // Reactions to this repo event
        "#k": ["30617"], // Reactions to kind 30617 events
      },
    ];
    
    const unsubscribe = subscribe(filters, (event: Event) => {
      // Only count positive reactions (stars)
      // Normalize pubkey to lowercase to prevent case-sensitivity issues
      if (event.content === "+" || event.content === "⭐") {
        starers.add(event.pubkey.toLowerCase());
      }
    });
    
    // Wait a bit for events to come in, then resolve
    setTimeout(() => {
      unsubscribe();
      resolve({
        count: starers.size,
        starers: Array.from(starers),
      });
    }, 2000); // 2 second timeout for querying
  });
}

/**
 * Publish a star reaction (NIP-25) for a repository
 */
export async function publishStarReaction(
  repoEventId: string,
  repoOwnerPubkey: string,
  publish: (event: Event) => Promise<void>,
  getSigner: () => Promise<{ signEvent: (event: any) => Promise<any> }>
): Promise<{ success: boolean; eventId?: string; error?: string }> {
  try {
    const signer = await getSigner();
    
    // Create unsigned event
    const unsignedEvent = {
      kind: KIND_REACTION,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ["e", repoEventId],
        ["k", "30617"],
        ["p", repoOwnerPubkey.toLowerCase()],
      ],
      content: "+",
      pubkey: "", // Will be set by signer
    };
    
    // Sign the event
    const signedEvent = await signer.signEvent(unsignedEvent);
    
    // Publish to relays
    await publish(signedEvent);
    
    return {
      success: true,
      eventId: signedEvent.id,
    };
  } catch (error: any) {
    console.error("[Repo Stars] Failed to publish star reaction:", error);
    return {
      success: false,
      error: error?.message || "Failed to publish star reaction",
    };
  }
}

/**
 * Remove a star reaction (publish a negative reaction or delete)
 * NIP-25: Use "-" content to unstar, or publish a deletion event
 */
export async function removeStarReaction(
  repoEventId: string,
  repoOwnerPubkey: string,
  publish: (event: Event) => Promise<void>,
  getSigner: () => Promise<{ signEvent: (event: any) => Promise<any> }>
): Promise<{ success: boolean; error?: string }> {
  try {
    const signer = await getSigner();
    
    // Create negative reaction (NIP-25: "-" means remove reaction)
    const unsignedEvent = {
      kind: KIND_REACTION,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ["e", repoEventId],
        ["k", "30617"],
        ["p", repoOwnerPubkey.toLowerCase()],
      ],
      content: "-", // Negative reaction (unstar)
      pubkey: "", // Will be set by signer
    };
    
    const signedEvent = await signer.signEvent(unsignedEvent);
    await publish(signedEvent);
    
    return { success: true };
  } catch (error: any) {
    console.error("[Repo Stars] Failed to remove star reaction:", error);
    return {
      success: false,
      error: error?.message || "Failed to remove star reaction",
    };
  }
}

