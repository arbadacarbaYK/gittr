import { handleOptionsRequest, setCorsHeaders } from "@/lib/api/cors";

import type { NextApiRequest, NextApiResponse } from "next";

/**
 * API endpoint for sending messages to the public Telegram channel
 * Used for public announcements (e.g., bounties)
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

  const { title, message, url } = req.body || {};

  if (!title || !message) {
    return res
      .status(400)
      .json({ error: "missing_params", message: "Missing title or message" });
  }

  // Get Telegram bot token and channel ID from env
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
    // Format the notification message with emojis for channel announcements
    // Telegram HTML: Use <a href="url">link text</a> for clickable links
    // Escape HTML special characters in the URL
    const escapedUrl = url
      ? url.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      : "";

    // Bounty announcements get special formatting (case-insensitive)
    // Check in order: bounty first (before "issue" which might be in "bounty funded on issue")
    const titleLower = title.toLowerCase();
    let emoji = "💰";
    if (titleLower.includes("bounty")) emoji = "💰";
    else if (titleLower.includes("released")) emoji = "🎉";

    // Format message with emoji, title, message, and clickable link
    const linkText = url ? `<a href="${escapedUrl}">🔗 View Details</a>` : "";
    const telegramMessage = `${emoji} <b>${title}</b>\n\n${message}${
      url ? `\n\n${linkText}` : ""
    }`;
    const telegramUrl = `https://api.telegram.org/bot${telegramBotToken}/sendMessage`;

    // Send to the public channel
    const telegramResponse = await fetch(telegramUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: telegramChatId, // Channel ID
        text: telegramMessage,
        parse_mode: "HTML",
        disable_web_page_preview: false, // Allow link previews
      }),
    });

    if (!telegramResponse.ok) {
      const errorData = await telegramResponse.json();
      console.warn("Telegram channel message failed:", errorData);
      return res.status(500).json({
        error: "send_failed",
        message:
          errorData.description || "Failed to send Telegram channel message",
      });
    }

    console.log("Telegram channel announcement sent to", telegramChatId);
    return res.status(200).json({
      status: "ok",
      message: "Telegram channel announcement sent",
    });
  } catch (error: any) {
    console.error("Failed to send Telegram channel announcement:", error);
    return res.status(500).json({
      error: "send_failed",
      message: error.message || "Failed to send Telegram channel announcement",
    });
  }
}
