import { handleOptionsRequest, setCorsHeaders } from "@/lib/api/cors";
import {
  formatTelegramNotificationHtml,
  telegramSendMessage,
} from "@/lib/notifications/telegram-api";

import type { NextApiRequest, NextApiResponse } from "next";

/**
 * Test endpoint for notifications
 * Allows testing notification construction and sending without triggering real events
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Handle OPTIONS request for CORS
  if (req.method === "OPTIONS") {
    handleOptionsRequest(res, req);
    return;
  }

  // Set CORS headers
  setCorsHeaders(res, req);

  if (req.method !== "POST") {
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const {
    testType, // 'nostr', 'telegram', or 'both'
    recipientPubkey, // For Nostr (can be 'auto' to use from notification prefs)
    telegramUserId, // For Telegram (can use TELEGRAM_CHAT_ID from env if not provided)
    title,
    message,
    url,
    getCurrentUserNpub, // Special flag to get current user's npub
  } = req.body || {};

  // Special case: return current user's npub from notification prefs
  if (getCurrentUserNpub) {
    // This would require accessing localStorage which isn't available server-side
    // Instead, we'll return a message to get it from the client
    return res.status(200).json({
      message: "Get npub from client-side notification preferences",
      hint: "Check localStorage.getItem('gittr_notifications') in browser console",
    });
  }

  if (!testType || !title || !message) {
    return res.status(400).json({
      error: "missing_params",
      message: "Missing testType, title, or message",
    });
  }

  const results: any = {
    testType,
    timestamp: new Date().toISOString(),
    tests: {},
  };

  // Test Nostr notification
  if (testType === "nostr" || testType === "both") {
    if (!recipientPubkey) {
      results.tests.nostr = {
        success: false,
        error: "recipientPubkey required for Nostr test",
      };
    } else {
      try {
        const nostrNsec = process.env.NOSTR_NSEC;
        if (!nostrNsec) {
          results.tests.nostr = {
            success: true,
            message:
              "NOSTR_NSEC not configured - notifications will use user's own key (DM to themselves)",
            constructed: {
              fullMessage: `${title}\n\n${message}${url ? `\n\n${url}` : ""}`,
              mode: "user_key",
            },
          };
        } else {
          // Import and call the send logic directly
          const { nip19, nip04 } = await import("nostr-tools");
          const { getPublicKey, getEventHash, signEvent } = await import(
            "nostr-tools"
          );
          const { RelayPool } = await import("nostr-relaypool");

          // Decode nsec to hex
          let privateKey: string;
          try {
            const decoded = nip19.decode(nostrNsec);
            if (decoded.type === "nsec") {
              privateKey = decoded.data as string;
            } else {
              throw new Error("Invalid nsec format");
            }
          } catch (error: any) {
            results.tests.nostr = {
              success: false,
              error: "Failed to decode NOSTR_NSEC: " + error.message,
            };
          }

          if (!results.tests.nostr) {
            const senderPubkey = getPublicKey(privateKey!);

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
            } catch (error: any) {
              results.tests.nostr = {
                success: false,
                error: "Invalid recipient pubkey/npub: " + error.message,
              };
            }

            if (!results.tests.nostr) {
              // Format the notification message
              const messageText = `${title}\n\n${message}${
                url ? `\n\n${url}` : ""
              }`;

              // Encrypt message using NIP-04
              const encryptedContent = await nip04.encrypt(
                privateKey!,
                recipientHex!,
                messageText
              );

              // Create Kind 4 event (encrypted direct message)
              const event = {
                kind: 4,
                created_at: Math.floor(Date.now() / 1000),
                tags: [
                  ["p", recipientHex!], // Recipient pubkey
                ],
                content: encryptedContent,
                pubkey: senderPubkey,
                id: "",
                sig: "",
              };

              // Sign the event
              event.id = getEventHash(event);
              event.sig = signEvent(event, privateKey!);

              // Get relays from environment or use defaults
              const envRelays = process.env.NEXT_PUBLIC_NOSTR_RELAYS;
              let defaultRelays: string[];
              if (envRelays && envRelays.trim().length > 0) {
                const parsed = envRelays
                  .split(",")
                  .map((r) => r.trim())
                  .filter((r) => r.length > 0 && r.startsWith("wss://"));
                defaultRelays =
                  parsed.length > 0
                    ? parsed
                    : [
                        "wss://relay.gittr.space",
                        "wss://relay.damus.io",
                        "wss://nos.lol",
                        "wss://relay.primal.net",
                      ];
              } else {
                defaultRelays = [
                  "wss://relay.gittr.space",
                  "wss://relay.damus.io",
                  "wss://nos.lol",
                  "wss://relay.primal.net",
                ];
              }

              // Create a temporary relay pool and publish
              const tempPool = new RelayPool(defaultRelays);
              tempPool.publish(event, defaultRelays);

              // Clean up after a delay
              setTimeout(() => {
                void tempPool.close();
              }, 5000);

              results.tests.nostr = {
                success: true,
                result: { status: "ok", message: "Notification sent" },
                constructed: {
                  recipient: recipientPubkey,
                  recipientHex: recipientHex!.slice(0, 8) + "...",
                  senderPubkey: senderPubkey.slice(0, 8) + "...",
                  title,
                  message,
                  url,
                  fullMessage: messageText,
                  messageLength: messageText.length,
                  encryptedLength: encryptedContent.length,
                  eventId: event.id.slice(0, 16) + "...",
                  relays: defaultRelays,
                },
              };
            }
          }
        }
      } catch (error: any) {
        results.tests.nostr = {
          success: false,
          error: error.message,
        };
      }
    }
  }

  // Test Telegram notification
  if (testType === "telegram" || testType === "both") {
    const userId = telegramUserId || process.env.TELEGRAM_CHAT_ID;
    if (!userId) {
      results.tests.telegram = {
        success: false,
        error: "telegramUserId or TELEGRAM_CHAT_ID required for Telegram test",
      };
    } else {
      try {
        const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
        if (!telegramBotToken) {
          results.tests.telegram = {
            success: false,
            error: "TELEGRAM_BOT_TOKEN not configured",
          };
        } else {
          const { emoji, html: telegramMessage } =
            formatTelegramNotificationHtml({
              title: String(title),
              message: String(message),
              url: url ? String(url) : undefined,
              linkLabel: "🔗 View Details",
            });

          try {
            const telegramResult = await telegramSendMessage({
              botToken: telegramBotToken,
              chatId: userId,
              text: telegramMessage,
              parseMode: "HTML",
              disableWebPagePreview: false,
            });

            if (telegramResult.ok) {
              results.tests.telegram = {
                success: true,
                result: {
                  status: "ok",
                  message: "Telegram DM sent",
                  messageId: telegramResult.messageId,
                },
                constructed: {
                  userId,
                  title,
                  message,
                  url,
                  emoji,
                  fullMessage: telegramMessage,
                  messageLength: telegramMessage.length,
                  telegramResponse: telegramResult.raw,
                },
              };
            } else {
              results.tests.telegram = {
                success: false,
                error: telegramResult.error,
                constructed: {
                  userId,
                  title,
                  message,
                  url,
                  emoji,
                  fullMessage: telegramMessage,
                  messageLength: telegramMessage.length,
                  telegramError: telegramResult.raw,
                },
              };
            }
          } catch (error: any) {
            results.tests.telegram = {
              success: false,
              error: error.message || "Failed to send Telegram DM",
              constructed: {
                userId,
                title,
                message,
                url,
                fullMessage: telegramMessage,
                messageLength: telegramMessage.length,
              },
            };
          }
        }
      } catch (error: any) {
        results.tests.telegram = {
          success: false,
          error: error.message,
        };
      }
    }
  }

  // Summary
  const allSuccess = Object.values(results.tests).every(
    (test: any) => test.success !== false
  );
  results.summary = {
    allSuccess,
    totalTests: Object.keys(results.tests).length,
    successfulTests: Object.values(results.tests).filter(
      (test: any) => test.success === true
    ).length,
  };

  return res.status(allSuccess ? 200 : 207).json(results); // 207 = Multi-Status
}
