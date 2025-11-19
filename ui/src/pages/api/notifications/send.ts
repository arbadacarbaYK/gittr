import type { NextApiRequest, NextApiResponse } from "next";
import { setCorsHeaders, handleOptionsRequest } from "@/lib/api/cors";
import { nip19, nip04 } from "nostr-tools";
import { getPublicKey, getEventHash, signEvent } from "nostr-tools";
import { RelayPool } from "nostr-relaypool";

/**
 * API endpoint for sending platform notifications
 * Uses server-side environment variables for platform identity
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Handle OPTIONS request for CORS
  if (req.method === "OPTIONS") {
    handleOptionsRequest(res);
    return;
  }

  // Set CORS headers
  setCorsHeaders(res);

  if (req.method !== "POST") {
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const { recipientPubkey, title, message, url } = req.body || {};

  if (!recipientPubkey || !title || !message) {
    return res.status(400).json({ error: "missing_params", message: "Missing recipientPubkey, title, or message" });
  }

  // Get platform's Nostr private key from env
  const nostrNsec = process.env.NOSTR_NSEC;
  if (!nostrNsec) {
    console.error("NOSTR_NSEC not configured in environment variables");
    return res.status(500).json({ error: "not_configured", message: "Platform notification key not configured" });
  }

  try {
    // Decode nsec to hex
    let privateKey: string;
    try {
      const decoded = nip19.decode(nostrNsec);
      if (decoded.type === "nsec") {
        privateKey = decoded.data as string;
      } else {
        throw new Error("Invalid nsec format");
      }
    } catch (error) {
      console.error("Failed to decode NOSTR_NSEC:", error);
      return res.status(500).json({ error: "invalid_key", message: "Invalid NOSTR_NSEC format" });
    }

    const senderPubkey = getPublicKey(privateKey);

    // Convert recipient npub to hex if needed
    let recipientHex: string;
    try {
      if (recipientPubkey.startsWith("npub")) {
        const decoded = nip19.decode(recipientPubkey);
        if (decoded.type === "npub") {
          recipientHex = decoded.data as string;
        } else {
          throw new Error("Invalid npub format");
        }
      } else if (/^[0-9a-f]{64}$/i.test(recipientPubkey)) {
        recipientHex = recipientPubkey.toLowerCase();
      } else {
        throw new Error("Invalid recipient format");
      }
    } catch (error) {
      console.error("Invalid recipient pubkey/npub:", recipientPubkey);
      return res.status(400).json({ error: "invalid_recipient", message: "Invalid recipient pubkey/npub format" });
    }

    // Format the notification message
    const messageText = `${title}\n\n${message}${url ? `\n\n${url}` : ""}`;

    // Encrypt message using NIP-04
    const encryptedContent = await nip04.encrypt(
      privateKey,
      recipientHex,
      messageText
    );

    // Create Kind 4 event (encrypted direct message)
    const event = {
      kind: 4,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ["p", recipientHex], // Recipient pubkey
      ],
      content: encryptedContent,
      pubkey: senderPubkey,
      id: "",
      sig: "",
    };

    // Sign the event
    event.id = getEventHash(event);
    event.sig = signEvent(event, privateKey);

    // Get relays from environment or use defaults
    const envRelays = process.env.NEXT_PUBLIC_NOSTR_RELAYS;
    let defaultRelays: string[];
    if (envRelays && envRelays.trim().length > 0) {
      const parsed = envRelays.split(",")
        .map(r => r.trim())
        .filter(r => r.length > 0 && r.startsWith("wss://"));
      defaultRelays = parsed.length > 0 ? parsed : [
        "wss://relay.damus.io",
        "wss://nos.lol",
        "wss://relay.nostr.bg",
      ];
    } else {
      defaultRelays = [
        "wss://relay.damus.io",
        "wss://nos.lol",
        "wss://relay.nostr.bg",
      ];
    }

    // Create a temporary relay pool and publish
    const tempPool = new RelayPool(defaultRelays);
    tempPool.publish(event, defaultRelays);
    
    console.log("Platform notification sent via Nostr DM to", recipientHex.slice(0, 8) + "...");
    
    // Clean up after a delay
    setTimeout(() => {
      void tempPool.close();
    }, 5000);

    // Note: Telegram DMs are sent via /api/notifications/send-telegram endpoint
    // which is called from sendTelegramDM() in the notification service
    // This endpoint only handles Nostr DMs

    return res.status(200).json({ 
      status: "ok",
      message: "Notification sent",
    });
  } catch (error: any) {
    console.error("Failed to send platform notification:", error);
    return res.status(500).json({ 
      error: "send_failed", 
      message: error.message || "Failed to send notification" 
    });
  }
}

