import { handleOptionsRequest, setCorsHeaders } from "@/lib/api/cors";

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
    handleOptionsRequest(res);
    return;
  }

  // Set CORS headers
  setCorsHeaders(res);

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
          // Format the notification message with emojis and clickable link (same as send-telegram.ts)
          // Telegram HTML: Use <a href="url">link text</a> for clickable links
          // Escape HTML special characters in the URL
          const escapedUrl = url
            ? url
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
            : "";

          // Add emoji based on event type (case-insensitive)
          // Check in order: bounty first (before "issue" which might be in "bounty funded on issue")
          const titleLower = title.toLowerCase();
          let emoji = "🔔";
          if (titleLower.includes("bounty")) emoji = "💰";
          else if (
            titleLower.includes("pull request") ||
            titleLower.includes("pr")
          )
            emoji = "🔀";
          else if (titleLower.includes("issue")) emoji = "📝";
          else if (titleLower.includes("merged")) emoji = "✅";
          else if (titleLower.includes("comment")) emoji = "💬";

          // Format message with emoji, title, message, and clickable link
          const linkText = url
            ? `<a href="${escapedUrl}">🔗 View Details</a>`
            : "";
          const telegramMessage = `${emoji} <b>${title}</b>\n\n${message}${
            url ? `\n\n${linkText}` : ""
          }`;
          const telegramUrl = `https://api.telegram.org/bot${telegramBotToken}/sendMessage`;

          // Send DM to the user's Telegram user ID
          try {
            const telegramResponse = await fetch(telegramUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                chat_id: userId,
                text: telegramMessage,
                parse_mode: "HTML",
                disable_web_page_preview: false, // Allow link previews
              }),
            });

            const telegramResult = await telegramResponse.json();

            if (telegramResponse.ok) {
              results.tests.telegram = {
                success: true,
                result: { status: "ok", message: "Telegram DM sent" },
                constructed: {
                  userId,
                  title,
                  message,
                  url,
                  fullMessage: telegramMessage,
                  messageLength: telegramMessage.length,
                  apiUrl: telegramUrl.replace(telegramBotToken, "***"),
                  telegramResponse: telegramResult,
                },
              };
            } else {
              results.tests.telegram = {
                success: false,
                error:
                  telegramResult.description || "Failed to send Telegram DM",
                constructed: {
                  userId,
                  title,
                  message,
                  url,
                  fullMessage: telegramMessage,
                  messageLength: telegramMessage.length,
                  apiUrl: telegramUrl.replace(telegramBotToken, "***"),
                  telegramError: telegramResult,
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
