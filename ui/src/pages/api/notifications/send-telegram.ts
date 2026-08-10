import { handleOptionsRequest, setCorsHeaders } from "@/lib/api/cors";

import type { NextApiRequest, NextApiResponse } from "next";

/**
 * API endpoint for sending Telegram DMs to individual users
 * Uses server-side TELEGRAM_BOT_TOKEN from environment
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

  const { userId, title, message, url } = req.body || {};

  if (!userId || !title || !message) {
    return res.status(400).json({
      error: "missing_params",
      message: "Missing userId, title, or message",
    });
  }

  // Get Telegram bot token from env
  const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!telegramBotToken) {
    console.error("TELEGRAM_BOT_TOKEN not configured in environment variables");
    return res.status(500).json({
      error: "not_configured",
      message: "Telegram bot token not configured",
    });
  }

  try {
    const escapeHtml = (s: string) =>
      String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");

    const escapedUrl = url
      ? String(url)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
      : "";

    const titleLower = title.toLowerCase();
    let emoji = "🔔";
    if (titleLower.includes("security") || titleLower.includes("vulnerabilit"))
      emoji = "🔒";
    else if (titleLower.includes("bounty")) emoji = "💰";
    else if (titleLower.includes("pull request") || titleLower.includes("pr"))
      emoji = "🔀";
    else if (titleLower.includes("issue")) emoji = "📝";
    else if (titleLower.includes("merged")) emoji = "✅";
    else if (titleLower.includes("comment")) emoji = "💬";

    // Plain text body (escape for HTML mode) — CVE DMs are already short + repo-first
    const linkText = url
      ? `<a href="${escapedUrl}">Open security issue</a>`
      : "";
    const telegramMessage = `${emoji} <b>${escapeHtml(title)}</b>\n\n${escapeHtml(
      message
    )}${url ? `\n\n${linkText}` : ""}`;

    console.log("📤 [Telegram DM] Sending message:", {
      userId,
      emoji,
      title,
      messageLength: message.length,
      hasUrl: !!url,
    });

    const telegramUrl = `https://api.telegram.org/bot${telegramBotToken}/sendMessage`;

    const telegramResponse = await fetch(telegramUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: userId,
        text: telegramMessage,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });

    if (!telegramResponse.ok) {
      const errorData = await telegramResponse.json();
      console.warn("Telegram DM failed:", errorData);
      return res.status(500).json({
        error: "send_failed",
        message: errorData.description || "Failed to send Telegram DM",
      });
    }

    console.log("Telegram DM sent to user", userId);
    return res.status(200).json({
      status: "ok",
      message: "Telegram DM sent",
    });
  } catch (error: any) {
    console.error("Failed to send Telegram DM:", error);
    return res.status(500).json({
      error: "send_failed",
      message: error.message || "Failed to send Telegram DM",
    });
  }
}
