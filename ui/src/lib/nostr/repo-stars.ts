// NIP-25: Repository star reactions and NIP-51: Following lists
import { type Event as NostrEvent, type Filter } from "nostr-tools";

import { KIND_REACTION, KIND_REPOSITORY_NIP34 } from "./events";

export type RelaySubscribeFn = (
  filters: Filter[],
  relays: string[],
  onEvent: (event: NostrEvent, isAfterEose: boolean, relayURL?: string) => void,
  maxDelayms?: number,
  onEose?: (relayUrl: string, minCreatedAt: number) => void,
  options?: Record<string, unknown>
) => (() => void) | undefined;

/** Latest reaction per pubkey wins; + / ⭐ count as starred, - removes. */
export function aggregateRepoStarReactions(events: NostrEvent[]): {
  count: number;
  starers: string[];
} {
  const byPub = new Map<string, NostrEvent>();
  for (const event of events) {
    if (event.kind !== KIND_REACTION) continue;
    const eid = event.tags.find((t) => t[0] === "e")?.[1];
    if (!eid) continue;
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
  events: NostrEvent[],
  myPubkey: string
): string[] {
  const pk = myPubkey.toLowerCase();
  const byTarget = new Map<string, NostrEvent>();
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

/** Build possible `d` identifiers for a repo row / URL slug. */
export function repoAnnouncementDTagCandidates(
  repositoryName: string,
  repo?: {
    repositoryName?: string;
    repo?: string;
    slug?: string;
    name?: string;
  } | null
): string[] {
  const out = new Set<string>();
  const add = (v?: string) => {
    const t = (v || "").trim();
    if (t) out.add(t);
  };
  add(repositoryName);
  add(repo?.repositoryName);
  add(repo?.repo);
  add(repo?.slug);
  add(repo?.name);
  return [...out];
}

function eventMatchesRepoAnnouncement(
  event: NostrEvent,
  author: string,
  dCandidates: string[]
): boolean {
  const d = event.tags.find((t) => t[0] === "d")?.[1]?.trim();
  if (d && dCandidates.includes(d)) return true;
  const want = new Set(
    dCandidates.map((name) => `30617:${author}:${name}`.toLowerCase())
  );
  for (const t of event.tags) {
    if (t[0] === "a" && typeof t[1] === "string") {
      if (want.has(t[1].toLowerCase())) return true;
    }
  }
  return false;
}

/** Latest kind 30617 id for this repo (relays). Works even when you are the first star. */
export async function queryRepoAnnouncementEventId(
  subscribe: RelaySubscribeFn,
  relays: string[],
  ownerPubkey: string,
  repositoryName: string,
  opts?: { timeoutMs?: number; repo?: Parameters<typeof repoAnnouncementDTagCandidates>[1] }
): Promise<string | null> {
  const author = ownerPubkey.trim().toLowerCase();
  const dCandidates = repoAnnouncementDTagCandidates(repositoryName, opts?.repo);
  if (!/^[0-9a-f]{64}$/.test(author) || dCandidates.length === 0) return null;

  let latest: NostrEvent | null = null;
  const filters: Filter[] = [
    {
      kinds: [KIND_REPOSITORY_NIP34],
      authors: [author],
      limit: 80,
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
      const id = latest?.id;
      resolve(
        typeof id === "string" && /^[0-9a-f]{64}$/i.test(id) ? id : null
      );
    };

    const unsub = subscribe(
      filters,
      relays,
      (event: NostrEvent) => {
        if ((event.kind as number) !== KIND_REPOSITORY_NIP34) return;
        if (!eventMatchesRepoAnnouncement(event, author, dCandidates)) return;
        if (!latest || (event.created_at || 0) >= (latest.created_at || 0)) {
          latest = event;
        }
      },
      undefined,
      () => finish(unsub as () => void),
      {}
    );

    setTimeout(() => finish(unsub as () => void), opts?.timeoutMs ?? 8000);
  });
}

/** True when a kind-7 reaction targets this repo announcement (NIP-25 + gittr `#k` 30617). */
export function isRepoStarReaction(
  event: NostrEvent,
  repoEventId: string
): boolean {
  if (event.kind !== KIND_REACTION) return false;
  const eid = event.tags.find((t) => t[0] === "e")?.[1];
  if (!eid || eid.toLowerCase() !== repoEventId.toLowerCase()) return false;
  const k = event.tags.find((t) => t[0] === "k")?.[1];
  if (k && k !== "30617" && k !== String(KIND_REPOSITORY_NIP34)) return false;
  return event.content === "+" || event.content === "⭐";
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
  const collected: NostrEvent[] = [];
  // Many relays index `#e` but not `#k` on kind 7 — filter `k=30617` client-side.
  const filters: Filter[] = [
    {
      kinds: [KIND_REACTION],
      "#e": [repoEventId],
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
      (event: NostrEvent) => {
        if (isRepoStarReaction(event, repoEventId)) collected.push(event);
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
  publish: (event: NostrEvent) => void | Promise<void>,
  getSigner: () => Promise<{ signEvent: (event: any) => Promise<any> }>
): Promise<{
  success: boolean;
  eventId?: string;
  signedEvent?: NostrEvent;
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
      signedEvent: signedEvent as NostrEvent,
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
  publish: (event: NostrEvent) => void | Promise<void>,
  getSigner: () => Promise<{ signEvent: (event: any) => Promise<any> }>
): Promise<{ success: boolean; signedEvent?: NostrEvent; error?: string }> {
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

    return { success: true, signedEvent: signedEvent as NostrEvent };
  } catch (error: any) {
    console.error("[Repo Stars] Failed to remove star reaction:", error);
    return {
      success: false,
      error: error?.message || "Failed to remove star reaction",
    };
  }
}
