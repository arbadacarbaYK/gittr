import type { NextApiRequest, NextApiResponse } from "next";
import { setCorsHeaders, handleOptionsRequest } from "@/lib/api/cors";

/**
 * API endpoint for sending Telegram DMs to individual users
 * Uses server-side TELEGRAM_BOT_TOKEN from environment
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

  const { userId, title, message, url } = req.body || {};

  if (!userId || !title || !message) {
    return res.status(400).json({ error: "missing_params", message: "Missing userId, title, or message" });
  }

  // Get Telegram bot token from env
  const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!telegramBotToken) {
    console.error("TELEGRAM_BOT_TOKEN not configured in environment variables");
    return res.status(500).json({ error: "not_configured", message: "Telegram bot token not configured" });
  }

  try {
    // Format the notification message with emojis and clickable link
    // Telegram HTML: Use <a href="url">link text</a> for clickable links
    // Escape HTML special characters in the URL
    // Convert http:// to https:// for better Telegram link support (or keep http if needed)
    let escapedUrl = url ? url.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") : "";
    // Note: Telegram supports both http and https in HTML links, but https is preferred
    
    // Add emoji based on event type (case-insensitive)
    // Check in order: bounty first (before "issue" which might be in "bounty funded on issue")
    const titleLower = title.toLowerCase();
    let emoji = "🔔";
    if (titleLower.includes("bounty")) emoji = "💰";
    else if (titleLower.includes("pull request") || titleLower.includes("pr")) emoji = "🔀";
    else if (titleLower.includes("issue")) emoji = "📝";
    else if (titleLower.includes("merged")) emoji = "✅";
    else if (titleLower.includes("comment")) emoji = "💬";
    
    // Format message with emoji, title, message, and clickable link
    const linkText = url ? `<a href="${escapedUrl}">🔗 View Details</a>` : "";
    const telegramMessage = `${emoji} <b>${title}</b>\n\n${message}${url ? `\n\n${linkText}` : ""}`;
    
    // Log the message being sent (for debugging)
    console.log("📤 [Telegram DM] Sending message:", {
      userId,
      emoji,
      title,
      messageLength: message.length,
      hasUrl: !!url,
    });
    
    const telegramUrl = `https://api.telegram.org/bot${telegramBotToken}/sendMessage`;
    
    // Send DM to the user's Telegram user ID (not group ID)
    const telegramResponse = await fetch(telegramUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: userId, // User's Telegram user ID for DM
        text: telegramMessage,
        parse_mode: "HTML",
        disable_web_page_preview: false, // Allow link previews
      }),
    });
    
    if (!telegramResponse.ok) {
      const errorData = await telegramResponse.json();
      console.warn("Telegram DM failed:", errorData);
      return res.status(500).json({ 
        error: "send_failed", 
        message: errorData.description || "Failed to send Telegram DM" 
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
      message: error.message || "Failed to send Telegram DM" 
    });
  }
}

