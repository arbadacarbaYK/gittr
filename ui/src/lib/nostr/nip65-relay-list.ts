/**
 * NIP-65 kind 10002 — user's preferred read/write relay list.
 * Not the same as localStorage extras or Amber bunker transport relays.
 */
import { KIND_RELAY_LIST } from "@/lib/nostr/events";

export type Nip65Marker = "read" | "write" | undefined;

export interface Nip65RelayEntry {
  url: string;
  marker?: Nip65Marker;
}

export interface Nip65RelayListData {
  relays: Nip65RelayEntry[];
  pubkey: string;
  eventId?: string;
  createdAt?: number;
}

function normalizeRelayUrl(url: string): string {
  return String(url || "")
    .trim()
    .replace(/\/+$/, "")
    .toLowerCase();
}

function isWsUrl(url: string): boolean {
  return url.startsWith("wss://") || url.startsWith("ws://");
}

export function parseRelayListEvent(event: any): Nip65RelayListData | null {
  if (!event || event.kind !== KIND_RELAY_LIST) return null;
  const relays: Nip65RelayEntry[] = [];
  const seen = new Set<string>();

  if (!Array.isArray(event.tags)) {
    return {
      relays,
      pubkey: event.pubkey,
      eventId: event.id,
      createdAt: event.created_at,
    };
  }

  for (const tag of event.tags) {
    if (!Array.isArray(tag) || tag[0] !== "r" || typeof tag[1] !== "string") {
      continue;
    }
    const raw = tag[1].trim().replace(/\/+$/, "");
    if (!isWsUrl(raw)) continue;
    const key = normalizeRelayUrl(raw);
    if (seen.has(key)) continue;
    seen.add(key);
    const marker =
      tag[2] === "read" || tag[2] === "write"
        ? (tag[2] as Nip65Marker)
        : undefined;
    relays.push({ url: raw, marker });
  }

  return {
    relays,
    pubkey: event.pubkey,
    eventId: event.id,
    createdAt: event.created_at,
  };
}

/** Build kind-10002 `r` tags from entries (preserves markers). */
export function buildRelayListTags(entries: Nip65RelayEntry[]): string[][] {
  const tags: string[][] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const raw = String(entry.url || "")
      .trim()
      .replace(/\/+$/, "");
    if (!isWsUrl(raw)) continue;
    const key = normalizeRelayUrl(raw);
    if (seen.has(key)) continue;
    seen.add(key);
    if (entry.marker === "read" || entry.marker === "write") {
      tags.push(["r", raw, entry.marker]);
    } else {
      tags.push(["r", raw]);
    }
  }
  return tags;
}

/**
 * Fetch the latest kind 10002 for a pubkey. Empty array if none found.
 */
export async function getUserNip65Relays(
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
  options?: { timeoutMs?: number }
): Promise<Nip65RelayEntry[]> {
  const timeoutMs = options?.timeoutMs ?? 12000;
  return new Promise((resolve) => {
    let settled = false;
    let latestEvent: any = null;
    let latestCreatedAt = 0;

    const finish = (entries: Nip65RelayEntry[], reason: string) => {
      if (settled) return;
      settled = true;
      try {
        unsub();
      } catch {
        /* ignore */
      }
      console.log(`ℹ️ [NIP-65] ${reason} (${entries.length} relay(s))`);
      resolve(entries);
    };

    const unsub = subscribe(
      [
        {
          kinds: [KIND_RELAY_LIST],
          authors: [userPubkey],
          limit: 5,
        },
      ],
      relays,
      (event) => {
        if (event?.created_at > latestCreatedAt) {
          latestCreatedAt = event.created_at;
          latestEvent = event;
        }
      }
    );

    setTimeout(() => {
      if (latestEvent) {
        const parsed = parseRelayListEvent(latestEvent);
        finish(parsed?.relays || [], "loaded from Nostr");
      } else {
        finish([], "no kind 10002 found");
      }
    }, timeoutMs);
  });
}
