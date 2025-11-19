/**
 * Publish repository event to Nostr and wait for confirmation
 * Stores the event ID in the repository data when confirmed
 */

import { KIND_REPOSITORY } from "./events";

export interface PublishResult {
  eventId: string;
  confirmed: boolean;
  confirmedRelays: string[];
}

/**
 * Publish event and wait for confirmation from at least one relay
 * @param publish - The publish function from NostrContext
 * @param subscribe - The subscribe function from NostrContext
 * @param event - The event to publish
 * @param relays - Relays to publish to
 * @param timeout - Timeout in milliseconds (default: 10000)
 * @returns Promise that resolves when event is confirmed or timeout
 */
export async function publishWithConfirmation(
  publish: (event: any, relays: string[]) => void,
  subscribe: (
    filters: any[],
    relays: string[],
    onEvent: (event: any, isAfterEose: boolean, relayURL?: string) => void,
    maxDelayms?: number,
    onEose?: (relayUrl: string, minCreatedAt: number) => void,
    options?: any
  ) => () => void,
  event: any,
  relays: string[],
  timeout: number = 10000
): Promise<PublishResult> {
  return new Promise((resolve) => {
    const eventId = event.id;
    const confirmedRelays: string[] = [];
    let confirmed = false;
    let unsub: (() => void) | undefined;

    // Publish the event
    publish(event, relays);

    // Subscribe to confirm the event was accepted
    unsub = subscribe(
      [
        {
          ids: [eventId],
          kinds: [event.kind],
        },
      ],
      relays,
      (receivedEvent, isAfterEose, relayURL) => {
        if (receivedEvent.id === eventId && !confirmed) {
          confirmed = true;
          if (relayURL && !confirmedRelays.includes(relayURL)) {
            confirmedRelays.push(relayURL);
          }
          
          // Clean up
          if (unsub) {
            unsub();
            unsub = undefined;
          }
          
          resolve({
            eventId,
            confirmed: true,
            confirmedRelays,
          });
        }
      },
      undefined,
      (relayUrl, minCreatedAt) => {
        // EOSE - relay finished sending events
        // EOSE does NOT guarantee the event was accepted!
        // We should only mark as confirmed if we actually received the event in onEvent callback
        // Don't mark as confirmed here - wait for actual event receipt
        // This prevents false positives when relays reject events
      }
    );

    // Timeout after specified time
    setTimeout(() => {
      if (!confirmed && unsub) {
        unsub();
        unsub = undefined;
      }
      
      if (!confirmed) {
        resolve({
          eventId,
          confirmed: false,
          confirmedRelays: [],
        });
      }
    }, timeout);
  });
}

/**
 * Store the event ID in repository data
 */
export function storeRepoEventId(
  repoSlug: string,
  entity: string,
  eventId: string,
  confirmed: boolean
): void {
  try {
    const repos = JSON.parse(localStorage.getItem("gittr_repos") || "[]") as any[];
    const repoIndex = repos.findIndex((r: any) => 
      (r.slug === repoSlug || r.repo === repoSlug) && r.entity === entity
    );
    
    if (repoIndex >= 0) {
      const eventCreatedAt = Math.floor(Date.now() / 1000); // Event timestamp
      const existingRepo = repos[repoIndex];
      
      // Ensure repo, slug, and name fields are set (migration should have done this, but be safe)
      const repoValue = existingRepo.repo || existingRepo.slug || existingRepo.name || repoSlug;
      
      // Filter out localhost from clone URLs if they exist
      let filteredClone = existingRepo.clone;
      if (Array.isArray(existingRepo.clone)) {
        filteredClone = existingRepo.clone.filter((url: string) => 
          url && !url.includes('localhost') && !url.includes('127.0.0.1')
        );
      }
      
      repos[repoIndex] = {
        ...existingRepo,
        // Ensure repo/slug/name are set (should already be set by migration, but ensure consistency)
        repo: existingRepo.repo || repoValue,
        slug: existingRepo.slug || repoValue,
        name: existingRepo.name || repoValue,
        nostrEventId: eventId,
        lastNostrEventId: eventId, // Store as "last successful commit-id-to-nostr"
        lastNostrEventCreatedAt: eventCreatedAt,
        status: confirmed ? "live" : existingRepo.status || "local",
        syncedFromNostr: confirmed ? true : existingRepo.syncedFromNostr,
        hasUnpushedEdits: false, // Clear unpushed edits flag after successful push
        // Filter out localhost from clone URLs
        clone: filteredClone,
        // Don't update lastModifiedAt on push - only update when user actually edits files
        // This prevents status from switching back to "live_with_edits" immediately after push
        // lastModifiedAt should only be updated by markRepoAsEdited() when files are actually modified
      };
      localStorage.setItem("gittr_repos", JSON.stringify(repos));
    }
  } catch (error) {
    console.error("Failed to store repo event ID:", error);
  }
}

