import { handleOptionsRequest, setCorsHeaders } from "@/lib/api/cors";

import type { NextApiRequest, NextApiResponse } from "next";

/**
 * Telegram Bot Webhook
 *
 * Personal notifications: when a user DMs /start, we already know their
 * Telegram user id (message.chat.id). They paste that into
 * Settings → Notifications. No public channel dance.
 *
 * The public channel (TELEGRAM_CHAT_ID / @gittrspace) is for platform
 * announcements only — this webhook ignores channel posts for auth.
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method === "OPTIONS") {
    handleOptionsRequest(res, req);
    return;
  }

  setCorsHeaders(res, req);

  if (req.method !== "POST") {
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!telegramBotToken) {
    console.error("❌ [Telegram Webhook] TELEGRAM_BOT_TOKEN not configured");
    return res.status(500).json({ error: "not_configured" });
  }

  try {
    const update = req.body || {};

    // Channel posts are announcements / noise — do not run identity auth there.
    if (update.channel_post || update.edited_channel_post) {
      return res.status(200).json({ ok: true, ignored: "channel_post" });
    }

    // Direct message to the bot
    const message = update.message;
    if (!message || message.chat?.type === "channel") {
      return res.status(200).json({ ok: true });
    }

    const chatId = message.chat.id;
    const text = String(message.text || "");
    const isCommand =
      text.startsWith("/start") ||
      text.startsWith("/help") ||
      text.trim().length === 0;

    // Any DM (especially /start) → return their User ID. That is enough for
    // Settings → Notifications. Spoofing is mitigated because only this chat
    // receives the ID privately, and DMs only go to that same chat id.
    const reply = isCommand
      ? [
          "👋 <b>gittr notifications</b>",
          "",
          "Your Telegram User ID (private — only you see this):",
          `<code>${chatId}</code>`,
          "",
          "Paste it into gittr.space → <b>Settings → Notifications</b>, enable Telegram, and save.",
          "",
          "The public @gittrspace channel is for announcements only — you do <b>not</b> need to post anything there to get notifications.",
        ].join("\n")
      : [
          "Your Telegram User ID:",
          `<code>${chatId}</code>`,
          "",
          "Paste it in Settings → Notifications on gittr.space.",
          "Send /start anytime to see this again.",
        ].join("\n");

    try {
      const sendUrl = `https://api.telegram.org/bot${telegramBotToken}/sendMessage`;
      const tgRes = await fetch(sendUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: reply,
          parse_mode: "HTML",
          disable_web_page_preview: true,
        }),
      });
      if (!tgRes.ok) {
        console.error(
          "❌ [Telegram Webhook] sendMessage failed:",
          await tgRes.text()
        );
      }
    } catch (error) {
      console.error("Error sending DM reply:", error);
    }

    return res.status(200).json({ ok: true });
  } catch (error: any) {
    console.error("Telegram webhook error:", error);
    return res
      .status(500)
      .json({ error: "webhook_error", message: error.message });
  }
}
