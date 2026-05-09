// NIP-25: Repository star reactions and NIP-51: Following lists
import { type Event, type Filter } from "nostr-tools";

import { KIND_REACTION } from "./events";

export type RelaySubscribeFn = (
  filters: Filter[],
  relays: string[],
  onEvent: (event: Event, isAfterEose: boolean, relayURL?: string) => void,
  maxDelayms?: number,
  onEose?: (relayUrl: string, minCreatedAt: number) => void,
  options?: Record<string, unknown>
) => (() => void) | undefined;

/** Latest reaction per pubkey wins; + / ⭐ count as starred, - removes. */
export function aggregateRepoStarReactions(events: Event[]): {
  count: number;
  starers: string[];
} {
  const byPub = new Map<string, Event>();
  for (const event of events) {
    if (event.kind !== KIND_REACTION) continue;
    const pk = event.pubkey.toLowerCase();
    const prev = byPub.get(pk);
    if (!prev || (event.created_at || 0) >= (prev.created_at || 0)) {
      byPub.set(pk, event);
    }
  }
  const starers = new Set<string>();
  for (const ev of byPub.values()) {
    if (ev.content === "+" || ev.content === "⭐") {
      starers.add(ev.pubkey.toLowerCase());
    }
  }
  return { count: starers.size, starers: Array.from(starers) };
}

/**
 * From the current user's kind 7 reactions with `#k` 30617, return each `#e`
 * target id that is **currently** starred (latest event per target wins; `-` clears).
 */
export function aggregateMyStarredRepoEventIds(
  events: Event[],
  myPubkey: string
): string[] {
  const pk = myPubkey.toLowerCase();
  const byTarget = new Map<string, Event>();
  for (const ev of events) {
    if (ev.kind !== KIND_REACTION) continue;
    if (ev.pubkey.toLowerCase() !== pk) continue;
    const kTag = ev.tags.find((t) => t[0] === "k")?.[1];
    if (kTag !== "30617") continue;
    const eid = ev.tags.find((t) => t[0] === "e")?.[1];
    if (!eid || !/^[0-9a-f]{64}$/i.test(eid)) continue;
    const prev = byTarget.get(eid);
    if (!prev || (ev.created_at || 0) >= (prev.created_at || 0)) {
      byTarget.set(eid, ev);
    }
  }
  const out: string[] = [];
  for (const [eid, ev] of byTarget) {
    if (ev.content === "+" || ev.content === "⭐") out.push(eid);
  }
  return out;
}

/**
 * One-shot query: subscribe until EOSE (or timeout), then aggregate stars.
 */
export async function queryRepoStars(
  subscribe: RelaySubscribeFn,
  relays: string[],
  repoEventId: string,
  opts?: { timeoutMs?: number }
): Promise<{ count: number; starers: string[] }> {
  const collected: Event[] = [];
  const filters: Filter[] = [
    {
      kinds: [KIND_REACTION],
      "#e": [repoEventId],
      "#k": ["30617"],
      limit: 500,
    },
  ];

  return new Promise((resolve) => {
    let finished = false;
    const finish = (unsub?: () => void) => {
      if (finished) return;
      finished = true;
      try {
        unsub?.();
      } catch {
        /* ignore */
      }
      resolve(aggregateRepoStarReactions(collected));
    };

    const unsub = subscribe(
      filters,
      relays,
      (event: Event) => {
        if (event.kind === KIND_REACTION) collected.push(event);
      },
      undefined,
      () => finish(unsub as () => void),
      {}
    );

    const timeoutMs = opts?.timeoutMs ?? 8000;
    setTimeout(() => finish(unsub as () => void), timeoutMs);
  });
}

/**
 * Publish a star reaction (NIP-25) for a repository
 */
export async function publishStarReaction(
  repoEventId: string,
  repoOwnerPubkey: string,
  publish: (event: Event) => void | Promise<void>,
  getSigner: () => Promise<{ signEvent: (event: any) => Promise<any> }>
): Promise<{
  success: boolean;
  eventId?: string;
  signedEvent?: Event;
  error?: string;
}> {
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
      signedEvent: signedEvent as Event,
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
  publish: (event: Event) => void | Promise<void>,
  getSigner: () => Promise<{ signEvent: (event: any) => Promise<any> }>
): Promise<{ success: boolean; signedEvent?: Event; error?: string }> {
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

    return { success: true, signedEvent: signedEvent as Event };
  } catch (error: any) {
    console.error("[Repo Stars] Failed to remove star reaction:", error);
    return {
      success: false,
      error: error?.message || "Failed to remove star reaction",
    };
  }
}
