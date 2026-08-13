import { handleOptionsRequest, setCorsHeaders } from "@/lib/api/cors";
import {
  escapeTelegramHtml,
  telegramSendMessage,
} from "@/lib/notifications/telegram-api";

import type { NextApiRequest, NextApiResponse } from "next";

/**
 * API endpoint for sending messages to the public Telegram channel
 * Used for public announcements (e.g., bounties)
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

  const { title, message, url } = req.body || {};

  if (!title || !message) {
    return res
      .status(400)
      .json({ error: "missing_params", message: "Missing title or message" });
  }

  const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
  const telegramChatId = process.env.TELEGRAM_CHAT_ID;

  if (!telegramBotToken) {
    console.error("TELEGRAM_BOT_TOKEN not configured in environment variables");
    return res.status(500).json({
      error: "not_configured",
      message: "Telegram bot token not configured",
    });
  }

  if (!telegramChatId) {
    console.error("TELEGRAM_CHAT_ID not configured in environment variables");
    return res.status(500).json({
      error: "not_configured",
      message: "Telegram channel ID not configured",
    });
  }

  try {
    const titleLower = String(title).toLowerCase();
    let emoji = "💰";
    if (titleLower.includes("bounty")) emoji = "💰";
    else if (titleLower.includes("released")) emoji = "🎉";

    const escapedUrl = url ? escapeTelegramHtml(String(url)) : "";
    const linkText = url
      ? `<a href="${escapedUrl}">🔗 View Details</a>`
      : "";
    const telegramMessage = `${emoji} <b>${escapeTelegramHtml(
      String(title)
    )}</b>\n\n${escapeTelegramHtml(String(message))}${
      url ? `\n\n${linkText}` : ""
    }`;

    const result = await telegramSendMessage({
      botToken: telegramBotToken,
      chatId: telegramChatId,
      text: telegramMessage,
      parseMode: "HTML",
      disableWebPagePreview: false,
    });

    if (!result.ok) {
      console.warn("Telegram channel message failed:", {
        error: result.error,
        httpStatus: result.httpStatus,
        raw: result.raw,
      });
      return res.status(500).json({
        error: "send_failed",
        message: result.error,
      });
    }

    console.log("Telegram channel announcement sent to", telegramChatId, {
      messageId: result.messageId,
    });
    return res.status(200).json({
      status: "ok",
      message: "Telegram channel announcement sent",
      messageId: result.messageId,
    });
  } catch (error: any) {
    console.error("Failed to send Telegram channel announcement:", error);
    return res.status(500).json({
      error: "send_failed",
      message: error.message || "Failed to send Telegram channel announcement",
    });
  }
}
