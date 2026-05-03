import type { UnsignedEvent } from "nostr-tools";

const ZAP_RELAY_TAG_LIMIT = 10;

/**
 * Unsigned NIP-57 zap request (kind 9734). Must be signed (e.g. NIP-07) before sending to LNURL callback.
 */
export function buildUnsignedZapRequest9734(params: {
  senderPubkeyHex: string;
  recipientPubkeyHex: string;
  amountMsat: number;
  relays: string[];
  lnurlBech32: string;
  content: string;
}): UnsignedEvent {
  const relays = params.relays
    .filter((r) => typeof r === "string" && r.startsWith("wss://"))
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
  return {
    kind: 9734,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ["relays", ...relays],
      ["amount", String(params.amountMsat)],
      ["lnurl", params.lnurlBech32],
      ["p", recipient],
    ],
    content: params.content || "",
    pubkey: sender,
  };
}
