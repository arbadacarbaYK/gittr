import { handleOptionsRequest, setCorsHeaders } from "@/lib/api/cors";
import {
  formatTelegramNotificationHtml,
  telegramSendMessage,
} from "@/lib/notifications/telegram-api";

import type { NextApiRequest, NextApiResponse } from "next";

/**
 * API endpoint for sending Telegram DMs to individual users
 * Uses server-side TELEGRAM_BOT_TOKEN from environment
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

  const { userId, title, message, url } = req.body || {};

  if (!userId || !title || !message) {
    return res.status(400).json({
      error: "missing_params",
      message: "Missing userId, title, or message",
    });
  }

  const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!telegramBotToken) {
    console.error("TELEGRAM_BOT_TOKEN not configured in environment variables");
    return res.status(500).json({
      error: "not_configured",
      message: "Telegram bot token not configured",
    });
  }

  try {
    const { emoji, html } = formatTelegramNotificationHtml({
      title: String(title),
      message: String(message),
      url: url ? String(url) : undefined,
      linkLabel: "View details",
    });

    console.log("📤 [Telegram DM] Sending message:", {
      userId,
      emoji,
      title,
      messageLength: String(message).length,
      hasUrl: !!url,
    });

    const result = await telegramSendMessage({
      botToken: telegramBotToken,
      chatId: userId,
      text: html,
      parseMode: "HTML",
      disableWebPagePreview: true,
    });

    if (!result.ok) {
      console.warn("Telegram DM failed:", {
        userId,
        error: result.error,
        httpStatus: result.httpStatus,
        raw: result.raw,
      });
      return res.status(500).json({
        error: "send_failed",
        message: result.error,
      });
    }

    console.log("Telegram DM sent to user", userId, {
      messageId: result.messageId,
    });
    return res.status(200).json({
      status: "ok",
      message: "Telegram DM sent",
      messageId: result.messageId,
    });
  } catch (error: any) {
    console.error("Failed to send Telegram DM:", error);
    return res.status(500).json({
      error: "send_failed",
      message: error.message || "Failed to send Telegram DM",
    });
  }
}
