// Send Nostr DM notifications using NIP-04 encryption
import { getNostrPrivateKey } from "@/lib/security/encryptedStorage";

import {
  getEventHash,
  getPublicKey,
  nip04,
  nip19,
  signEvent,
} from "nostr-tools";

import type { EventKey } from "./prefs";

export interface NotificationData {
  eventType: EventKey;
  title: string;
  message: string;
  url?: string;
  repoEntity?: string;
  repoName?: string;
}

/**
 * Convert npub to hex pubkey if needed
 */
function npubToHex(npub: string): string | null {
  if (npub.startsWith("npub")) {
    try {
      const decoded = nip19.decode(npub);
      if (decoded.type === "npub") {
        return decoded.data as string;
      }
    } catch (error) {
      console.error("Failed to decode npub:", error);
      return null;
    }
  }
  // If it's already a hex pubkey, return as-is
  if (/^[0-9a-f]{64}$/i.test(npub)) {
    return npub.toLowerCase();
  }
  return null;
}

/**
 * Send a Nostr encrypted direct message (Kind 4) to a recipient
 * @param recipientPubkey - Recipient's pubkey (hex) or npub
 * @param data - Notification data
 * @returns Promise that resolves when message is published
 */
export async function sendNostrDM(
  recipientPubkey: string,
  data: NotificationData
): Promise<void> {
  try {
    // For platform notifications, use API endpoint (server-side env vars)
    // For user-initiated notifications, use user's key directly
    if (typeof window !== "undefined") {
      // Client-side: Use API endpoint for platform notifications
      // This allows us to use server-side NOSTR_NSEC env variable
      try {
        const response = await fetch("/api/notifications/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            recipientPubkey,
            title: data.title,
            message: data.message,
            url: data.url,
          }),
        });

        if (response.ok) {
          const result = await response.json();
          // Check if API says to use user's key (NOSTR_NSEC not configured)
          if (result.status === "use_user_key") {
            console.log(
              "Platform key not configured, using user's own key for notification"
            );
            // Fall through to use user's key
          } else {
            console.log("Platform notification sent via API");
            return;
          }
        } else {
          const error = await response.json();
          console.warn(
            "API notification failed, falling back to user key:",
            error
          );
          // Fall through to use user's key as fallback
        }
      } catch (error) {
        console.warn(
          "API notification request failed, falling back to user key:",
          error
        );
        // Fall through to use user's key as fallback
      }
    }

    // Fallback: Use user's private key (for user-initiated notifications or if API fails)
    const privateKey = await getNostrPrivateKey();
    if (!privateKey) {
      console.error("Cannot send Nostr DM: No private key available");
      return;
    }

    const senderPubkey = getPublicKey(privateKey);

    // Convert recipient npub to hex if needed
    const recipientHex = npubToHex(recipientPubkey);
    if (!recipientHex) {
      console.error("Invalid recipient pubkey/npub:", recipientPubkey);
      return;
    }

    // Format the notification message
    const messageText = `${data.title}\n\n${data.message}${
      data.url ? `\n\n${data.url}` : ""
    }`;

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

    // Publish to relays
    // Import RelayPool directly to publish without React context
    if (typeof window !== "undefined") {
      const { RelayPool } = await import("nostr-relaypool");

      // Get relays from environment or use defaults (same logic as NostrContext)
      const envRelays = process.env.NEXT_PUBLIC_NOSTR_RELAYS;
      let defaultRelays: string[];
      if (envRelays && envRelays.trim().length > 0) {
        const parsed = envRelays
          .split(",")
          .map((r) => r.trim())
          .filter((r) => r.length > 0 && r.startsWith("wss://"));
        defaultRelays = parsed.length > 0 ? parsed : getDefaultRelays();
      } else {
        defaultRelays = getDefaultRelays();
      }

      // Create a temporary relay pool just for this publish
      const tempPool = new RelayPool(defaultRelays);
      tempPool.publish(event, defaultRelays);

      console.log(
        "Nostr DM notification sent to",
        recipientHex.slice(0, 8) + "..."
      );

      // Clean up after a delay (relays will close automatically)
      setTimeout(() => {
        tempPool.close();
      }, 5000);
    }
  } catch (error) {
    console.error("Failed to send Nostr DM notification:", error);
    // Don't throw - notifications should be best-effort
  }
}

// Default relay list (same as in NostrContext)
function getDefaultRelays(): string[] {
  return [
    "wss://gitnostr.com",
    "wss://relay.ngit.dev",
    "wss://ngit.danconwaydev.com",
    "wss://relay.damus.io",
    "wss://nostr.fmt.wiz.biz",
    "wss://nos.lol",
    "wss://relay.azzamo.net",
    "wss://nostr.mom",
    "wss://relay.nostr.band",
    "wss://nostr.wine",
  ];
}
