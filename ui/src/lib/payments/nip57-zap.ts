import type { UnsignedEvent } from "nostr-tools";

const ZAP_RELAY_TAG_LIMIT = 8;

/** NIP-34 repository coordinate `30617:<owner hex>:<d tag>`. */
export function repoAnnouncementAddress(
  ownerHex: string,
  dTag: string
): string | null {
  const owner = ownerHex.trim().toLowerCase();
  let d = dTag.trim();
  if (!d) return null;
  try {
    d = decodeURIComponent(d);
  } catch {
    /* keep raw */
  }
  if (!/^[0-9a-f]{64}$/.test(owner) || !d) return null;
  return `30617:${owner}:${d}`;
}

export function parseRepoAddress(
  value: string | undefined | null
): { ownerHex: string; dTag: string } | null {
  if (!value) return null;
  const match = value.trim().match(/^30617:([0-9a-f]{64}):(.+)$/i);
  if (!match?.[1] || !match[2]) return null;
  return { ownerHex: match[1].toLowerCase(), dTag: match[2] };
}

export function repoAddressesEqual(
  a: string | undefined | null,
  b: string | undefined | null
): boolean {
  const left = parseRepoAddress(a);
  const right = parseRepoAddress(b);
  if (!left || !right) return false;
  return (
    left.ownerHex === right.ownerHex &&
    left.dTag.toLowerCase() === right.dTag.toLowerCase()
  );
}

function normalizeRelayUrl(raw: string): string | null {
  const url = String(raw || "")
    .trim()
    .replace(/\/+$/, "");
  if (!url.startsWith("wss://") && !url.startsWith("ws://")) return null;
  return url;
}

/**
 * Relays the recipient's wallet should publish the kind 9735 receipt to.
 * Always keep one recipient inbox and one sender outbox when we know them,
 * then fill with the repo's relays and whatever else the browser already uses.
 */
export function pickZapRelays(input: {
  recipientInboxes?: string[];
  senderOutboxes?: string[];
  repoRelays?: string[];
  fallback?: string[];
  max?: number;
}): string[] {
  const max = input.max ?? ZAP_RELAY_TAG_LIMIT;
  const unique = (urls: string[] | undefined): string[] => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const raw of urls || []) {
      const url = normalizeRelayUrl(raw);
      if (!url) continue;
      const key = url.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(url);
    }
    return out;
  };

  const inboxes = unique(input.recipientInboxes);
  const outboxes = unique(input.senderOutboxes);
  const repoRelays = unique(input.repoRelays);
  const fallback = unique(input.fallback);

  const result: string[] = [];
  const seen = new Set<string>();
  const push = (url?: string) => {
    if (!url || result.length >= max) return;
    const key = url.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    result.push(url);
  };

  push(inboxes[0]);
  push(outboxes[0]);
  if (result.length === 0) push(fallback[0]);
  for (const url of [...repoRelays, ...inboxes, ...outboxes, ...fallback]) {
    push(url);
  }
  return result;
}

/** Read or write URLs from a kind 10002 tag list. Unmarked relays count for both. */
export function nip65UrlsForMarker(
  tags: string[][] | undefined,
  marker: "read" | "write"
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const tag of tags || []) {
    if (!Array.isArray(tag) || tag[0] !== "r" || typeof tag[1] !== "string") {
      continue;
    }
    const mark = tag[2];
    if (mark && mark !== marker) continue;
    const url = normalizeRelayUrl(tag[1]);
    if (!url) continue;
    const key = url.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(url);
  }
  return out;
}

/**
 * Unsigned NIP-57 zap request (kind 9734). Must be signed (e.g. NIP-07) before sending to LNURL callback.
 * `address` / `eventId` point the receipt at a repo announcement, issue, or pull request
 * so other Nostr clients can show the same zap.
 */
export function buildUnsignedZapRequest9734(params: {
  senderPubkeyHex: string;
  recipientPubkeyHex: string;
  amountMsat: number;
  relays: string[];
  lnurlBech32: string;
  content: string;
  address?: string;
  eventId?: string;
  eventKind?: number;
}): UnsignedEvent {
  const relays = params.relays
    .map((r) => normalizeRelayUrl(r))
    .filter((r): r is string => !!r && r.startsWith("wss://"))
    .slice(0, ZAP_RELAY_TAG_LIMIT);
  if (relays.length === 0) {
    throw new Error(
      "NIP-57 zaps need at least one wss:// relay (configure Nostr relays)"
    );
  }
  const recipient = params.recipientPubkeyHex.replace(/\s/g, "").toLowerCase();
  const sender = params.senderPubkeyHex.replace(/\s/g, "").toLowerCase();
  if (!/^[0-9a-f]{64}$/i.test(recipient) || !/^[0-9a-f]{64}$/i.test(sender)) {
    throw new Error("NIP-57 zaps require 64-character hex pubkeys");
  }
  const tags: string[][] = [
    ["relays", ...relays],
    ["amount", String(params.amountMsat)],
    ["lnurl", params.lnurlBech32],
    ["p", recipient],
  ];
  const eventId = params.eventId?.trim().toLowerCase();
  if (eventId && /^[0-9a-f]{64}$/.test(eventId)) {
    tags.push(["e", eventId]);
  }
  const parsedRepo = parseRepoAddress(params.address);
  const genericAddress = params.address?.trim().match(/^\d+:[0-9a-f]{64}:.+$/i)
    ? params.address.trim()
    : "";
  const address = parsedRepo
    ? `30617:${parsedRepo.ownerHex}:${parsedRepo.dTag}`
    : genericAddress;
  if (address) tags.push(["a", address]);
  if (
    typeof params.eventKind === "number" &&
    Number.isFinite(params.eventKind)
  ) {
    tags.push(["k", String(params.eventKind)]);
  }
  return {
    kind: 9734,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: params.content || "",
    pubkey: sender,
  };
}
