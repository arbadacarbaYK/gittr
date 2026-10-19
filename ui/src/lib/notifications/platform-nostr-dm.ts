import { RelayPool } from "nostr-relaypool";
import { nip04, nip19 } from "nostr-tools";
import { getEventHash, getPublicKey, signEvent } from "nostr-tools";

export type PlatformNostrSendResult =
  | { ok: true; mode: "sent" | "use_user_key" }
  | { ok: false; error: "invalid_key" | "invalid_recipient" | "send_failed" };

function platformRelays(): string[] {
  const fallback = [
    "wss://relay.gittr.space",
    "wss://relay.damus.io",
    "wss://nos.lol",
    "wss://relay.primal.net",
  ];
  const envRelays = process.env.NEXT_PUBLIC_NOSTR_RELAYS;
  if (!envRelays || envRelays.trim().length === 0) return fallback;
  const parsed = envRelays
    .split(",")
    .map((r) => r.trim())
    .filter((r) => r.length > 0 && r.startsWith("wss://"));
  return parsed.length > 0 ? parsed : fallback;
}

/**
 * Platform Nostr DM (kind 4) using server NOSTR_NSEC.
 * Called from deliver — not from a public route.
 */
export async function sendPlatformNostrNotification(opts: {
  recipientPubkey: string;
  title: string;
  message: string;
  url?: string;
}): Promise<PlatformNostrSendResult> {
  const nostrNsec = process.env.NOSTR_NSEC;
  if (!nostrNsec) {
    return { ok: true, mode: "use_user_key" };
  }

  let privateKey: string;
  try {
    const decoded = nip19.decode(nostrNsec);
    if (decoded.type !== "nsec") {
      return { ok: false, error: "invalid_key" };
    }
    privateKey = decoded.data as string;
  } catch (error) {
    console.error("Failed to decode NOSTR_NSEC:", error);
    return { ok: false, error: "invalid_key" };
  }

  const senderPubkey = getPublicKey(privateKey);

  let recipientHex: string;
  try {
    if (opts.recipientPubkey.startsWith("npub")) {
      const decoded = nip19.decode(opts.recipientPubkey);
      if (decoded.type !== "npub") {
        return { ok: false, error: "invalid_recipient" };
      }
      recipientHex = decoded.data as string;
    } else if (/^[0-9a-f]{64}$/i.test(opts.recipientPubkey)) {
      recipientHex = opts.recipientPubkey.toLowerCase();
    } else {
      return { ok: false, error: "invalid_recipient" };
    }
  } catch (error) {
    console.error("Invalid recipient pubkey/npub:", error);
    return { ok: false, error: "invalid_recipient" };
  }

  try {
    const messageText = `${opts.title}\n\n${opts.message}${
      opts.url ? `\n\n${opts.url}` : ""
    }`;
    const encryptedContent = await nip04.encrypt(
      privateKey,
      recipientHex,
      messageText
    );

    const event = {
      kind: 4,
      created_at: Math.floor(Date.now() / 1000),
      tags: [["p", recipientHex]],
      content: encryptedContent,
      pubkey: senderPubkey,
      id: "",
      sig: "",
    };

    event.id = getEventHash(event);
    event.sig = signEvent(event, privateKey);

    const relays = platformRelays();
    const tempPool = new RelayPool(relays);
    tempPool.publish(event, relays);

    console.log(
      "Platform notification sent via Nostr DM to",
      recipientHex.slice(0, 8) + "..."
    );

    setTimeout(() => {
      void tempPool.close();
    }, 5000);

    return { ok: true, mode: "sent" };
  } catch (error) {
    console.error("Failed to send platform notification:", error);
    return { ok: false, error: "send_failed" };
  }
}
