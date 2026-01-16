import { handleOptionsRequest, setCorsHeaders } from "@/lib/api/cors";

import type { NextApiRequest, NextApiResponse } from "next";

/**
 * Simple in-memory cache to store recent verification messages from channel
 * Maps npub -> { messageId, proofFormat, timestamp }
 * Cleans up entries older than 1 hour
 */
const verificationCache = new Map<
  string,
  { messageId: number; proofFormat: string; timestamp: number }
>();

function cleanupCache() {
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  for (const [npub, data] of verificationCache.entries()) {
    if (data.timestamp < oneHourAgo) {
      verificationCache.delete(npub);
    }
  }
}

/**
 * Telegram Bot Webhook endpoint
 *
 * This endpoint receives updates from Telegram when:
 * - Users post messages in the configured channel (TELEGRAM_CHAT_ID)
 * - Users send messages to the bot directly
 *
 * For NIP-39 verification:
 * 1. User posts verification message in public channel
 * 2. Bot detects it, stores npub -> messageId mapping
 * 3. Bot replies in channel with message ID
 * 4. When user DMs bot, bot sends both User ID and message ID
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

  const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
  const telegramChatId = process.env.TELEGRAM_CHAT_ID;

  if (!telegramBotToken) {
    console.error("❌ [Telegram Webhook] TELEGRAM_BOT_TOKEN not configured");
    return res.status(500).json({ error: "not_configured" });
  }

  console.log("🔧 [Telegram Webhook] Configuration:", {
    hasBotToken: !!telegramBotToken,
    hasChatId: !!telegramChatId,
    chatId: telegramChatId,
  });

  try {
    const update = req.body;

    // Log incoming update for debugging
    console.log("📥 [Telegram Webhook] Received update:", {
      hasChannelPost: !!update.channel_post,
      hasEditedChannelPost: !!update.edited_channel_post,
      hasMessage: !!update.message,
      updateId: update.update_id,
      configuredChatId: telegramChatId,
    });

    // Handle channel post (message posted in channel)
    // NOTE: Channel posts don't have a 'from' field - they're anonymous
    // Users need to REPLY to a bot message or mention the bot to get their user ID
    if (update.channel_post) {
      const message = update.channel_post;
      const chatIdNum = message.chat.id;
      const chatId = chatIdNum.toString();
      const messageId = message.message_id;
      const text = message.text || "";

      console.log("📢 [Telegram Webhook] Channel post detected:", {
        chatId,
        chatIdNum,
        messageId,
        textPreview: text.substring(0, 50),
        configuredChatId: telegramChatId,
        chatUsername: message.chat.username,
        chatTitle: message.chat.title,
      });

      // Check if this is the configured channel
      // Channel IDs can be negative numbers with -100 prefix (e.g., -1003473049390)
      // Telegram API returns channel IDs as -100XXXXXXXXXX, but users might configure just XXXXXXXXXX
      // We normalize by removing -100 prefix and any leading minus
      const normalizeChatId = (id: string) => {
        // Remove -100 prefix if present (Telegram channel format)
        let normalized = id.replace(/^-100/, "");
        // Remove any remaining leading minus
        normalized = normalized.replace(/^-/, "");
        return normalized;
      };
      const normalizedChatId = normalizeChatId(chatId);
      const normalizedConfigChatId = normalizeChatId(telegramChatId || "");
      const chatIdMatches = normalizedChatId === normalizedConfigChatId;

      console.log("🔍 [Telegram Webhook] Chat ID comparison:", {
        receivedChatId: chatId,
        normalizedReceived: normalizedChatId,
        configuredChatId: telegramChatId,
        normalizedConfig: normalizedConfigChatId,
        matches: chatIdMatches,
      });

      if (chatIdMatches) {
        console.log("✅ [Telegram Webhook] Chat ID matches configured channel");
        // Check if message contains verification text pattern
        const verificationPattern = /verifying.*nostr.*public.*key/i;
        const matchesPattern = verificationPattern.test(text);
        console.log("🔍 [Telegram Webhook] Pattern check:", {
          textPreview: text.substring(0, 100),
          matchesPattern,
        });

        if (matchesPattern) {
          console.log("✅ [Telegram Webhook] Verification message detected!");

          // Extract npub from the message
          const npubMatch = text.match(/npub[a-z0-9]+/i);
          const npub = npubMatch ? npubMatch[0] : null;

          const channelName = message.chat.username || "gittrspace";
          const proofFormat = `${channelName}/${messageId}`;

          // Store in cache for later DM matching
          if (npub) {
            cleanupCache();
            verificationCache.set(npub, {
              messageId,
              proofFormat,
              timestamp: Date.now(),
            });
            console.log(
              `💾 [Telegram Webhook] Cached verification for npub: ${npub.substring(
                0,
                20
              )}...`
            );
          }

          try {
            // 1. Post a reply in the channel with verification info
            const replyUrl = `https://api.telegram.org/bot${telegramBotToken}/sendMessage`;
            const replyText =
              `✅ <b>Verification message detected!</b>\n\n` +
              `📋 <b>Your Information:</b>\n` +
              `• Message ID: <code>${messageId}</code>\n` +
              `• Proof format: <code>${proofFormat}</code>\n\n` +
              `💬 <b>To get your User ID:</b>\n` +
              `Send me a DM (@ngitspacebot) with your npub:\n` +
              `"<code>${npub || "npub1..."}</code>"\n\n` +
              `I'll match it to this message and send you both User ID and Message ID!`;

            console.log("📤 [Telegram Webhook] Sending channel reply:", {
              chatId,
              messageId,
              proofFormat,
              npub: npub ? npub.substring(0, 20) + "..." : null,
            });

            const replyResponse = await fetch(replyUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                chat_id: chatId,
                text: replyText,
                reply_to_message_id: messageId,
                parse_mode: "HTML",
              }),
            });

            if (replyResponse.ok) {
              console.log(
                `✅ [Telegram Webhook] Posted reply in channel for message ${messageId}`
              );
            } else {
              const errorText = await replyResponse.text();
              console.error(`❌ [Telegram Webhook] Failed to post reply:`, {
                status: replyResponse.status,
                statusText: replyResponse.statusText,
                error: errorText,
              });
            }
          } catch (error) {
            console.error(
              "❌ [Telegram Webhook] Error posting channel reply:",
              error
            );
          }
        } else {
          console.log(
            "⚠️ [Telegram Webhook] Message doesn't match verification pattern"
          );
        }
      } else {
        console.log(
          "⚠️ [Telegram Webhook] Chat ID doesn't match - ignoring message from different channel"
        );
      }
    }

    // Handle edited channel post (user might edit their verification message)
    if (update.edited_channel_post) {
      const message = update.edited_channel_post;
      const chatId = message.chat.id.toString();
      const text = message.text || "";

      if (chatId === telegramChatId) {
        const verificationPattern = /verifying.*nostr.*public.*key/i;
        if (verificationPattern.test(text)) {
          // Same handling as above - post a reply asking user to DM bot
          const messageId = message.message_id;
          const channelName = message.chat.username || "channel";
          const proofFormat = `${channelName}/${messageId}`;

          try {
            const replyUrl = `https://api.telegram.org/bot${telegramBotToken}/sendMessage`;
            await fetch(replyUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                chat_id: chatId,
                text:
                  `✅ Verification message detected!\n\n` +
                  `To complete verification, please:\n` +
                  `1. Start a conversation with me (@ngitspacebot) and send /start\n` +
                  `2. Then I'll send you your User ID and the proof format\n\n` +
                  `Your message ID: <code>${messageId}</code>\n` +
                  `Proof format: <code>${proofFormat}</code>`,
                reply_to_message_id: messageId,
                parse_mode: "HTML",
              }),
            });
          } catch (error) {
            console.error(
              "Error posting channel reply for edited message:",
              error
            );
          }
        }
      }
    }

    // Handle direct message to bot
    if (update.message && update.message.chat.type !== "channel") {
      const message = update.message;
      const chatId = message.chat.id;
      const text = message.text || "";

      // Help command or any message from user
      if (
        text.startsWith("/start") ||
        text.startsWith("/help") ||
        text.trim().length > 0
      ) {
        // Extract npub from DM message (user should include it to match channel post)
        const npubMatch = text.match(/npub[a-z0-9]+/i);
        const npub = npubMatch ? npubMatch[0] : null;

        // Check if message contains verification text
        const hasVerificationText =
          /verifying.*nostr.*public.*key/i.test(text) ||
          /verifying.*i.*control/i.test(text);

        // Clean up old cache entries
        cleanupCache();

        // Check if user posted verification in channel (match by npub from DM)
        const cachedVerification = npub ? verificationCache.get(npub) : null;

        console.log("💬 [Telegram Webhook] DM processing:", {
          chatId,
          hasNpub: !!npub,
          npub: npub ? npub.substring(0, 20) + "..." : null,
          cachedVerification: cachedVerification ? "found" : "not found",
          cacheSize: verificationCache.size,
        });

        let helpMessage = `👋 <b>Hello! I'm the gittr.space verification bot.</b>\n\n`;

        if (cachedVerification) {
          // User posted in channel and now DMed bot - send both User ID and Message ID!
          helpMessage +=
            `✅ <b>Verification Complete!</b>\n\n` +
            `📋 <b>Your Information:</b>\n` +
            `• User ID: <code>${chatId}</code>\n` +
            `• Message ID: <code>${cachedVerification.messageId}</code>\n` +
            `• Proof format: <code>${cachedVerification.proofFormat}</code>\n\n` +
            `🔐 <b>Use this in gittr.space:</b>\n` +
            `• Go to Settings → Profile → Verified Identities\n` +
            `• Platform: <code>telegram</code>\n` +
            `• User ID: <code>${chatId}</code>\n` +
            `• Proof: <code>${cachedVerification.proofFormat}</code>\n\n` +
            `✨ <b>You're all set!</b>`;

          // Remove from cache after sending
          verificationCache.delete(npub);
        } else if (hasVerificationText && npub) {
          // User sent verification message via DM but hasn't posted in channel yet
          helpMessage +=
            `✅ <b>Verification message detected!</b>\n\n` +
            `📋 <b>Your Telegram User ID:</b> <code>${chatId}</code>\n\n` +
            `📝 <b>Next Steps:</b>\n` +
            `1. Post this same message in the public channel (@gittrspace):\n` +
            `   "Verifying that I control the following Nostr public key: "${npub}"\n\n` +
            `2. After posting, I'll reply in the channel with your message ID\n\n` +
            `3. Then DM me again (/start) and I'll send you both User ID and Message ID!\n\n` +
            `💡 <b>Tip:</b> You can also get your User ID from @userinfobot or @MissRose_bot`;
        } else {
          // Regular help message
          helpMessage +=
            `📋 <b>Your Telegram User ID:</b> <code>${chatId}</code>\n\n` +
            `🔐 <b>To verify your Telegram identity for NIP-39:</b>\n\n` +
            `1. Post a message in the public channel (@gittrspace) with:\n` +
            `   "Verifying that I control the following Nostr public key: npub1..."\n\n` +
            `2. I'll reply in the channel with your message ID\n\n` +
            `3. Then DM me with your npub (the same one from your channel post) and I'll send you both User ID and Message ID!\n\n` +
            `💡 <b>Alternative ways to get your User ID:</b>\n` +
            `• Message @userinfobot or @MissRose_bot\n` +
            `• Telegram Desktop: Settings → Advanced → Experimental → Enable "Show Peer ID"\n` +
            `• Telegram Web: Check the URL when viewing your profile`;
        }

        try {
          const sendUrl = `https://api.telegram.org/bot${telegramBotToken}/sendMessage`;
          await fetch(sendUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: chatId,
              text: helpMessage,
            }),
          });
        } catch (error) {
          console.error("Error sending help message:", error);
        }
      }
    }

    // Always return 200 to acknowledge receipt
    return res.status(200).json({ ok: true });
  } catch (error: any) {
    console.error("Telegram webhook error:", error);
    return res
      .status(500)
      .json({ error: "webhook_error", message: error.message });
  }
}
