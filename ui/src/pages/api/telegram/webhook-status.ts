import type { NextApiRequest, NextApiResponse } from "next";
import { setCorsHeaders, handleOptionsRequest } from "@/lib/api/cors";

/**
 * Check Telegram webhook status and configuration
 * 
 * GET /api/telegram/webhook-status
 * Returns webhook info and test results
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Handle OPTIONS request for CORS
  if (req.method === "OPTIONS") {
    handleOptionsRequest(res);
    return;
  }

  // Set CORS headers
  setCorsHeaders(res);

  if (req.method !== "GET") {
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
  const telegramChatId = process.env.TELEGRAM_CHAT_ID;

  if (!telegramBotToken) {
    return res.status(500).json({ 
      error: "not_configured",
      message: "TELEGRAM_BOT_TOKEN not configured" 
    });
  }

  try {
    // Get webhook info from Telegram
    const webhookInfoUrl = `https://api.telegram.org/bot${telegramBotToken}/getWebhookInfo`;
    const webhookResponse = await fetch(webhookInfoUrl);
    
    if (!webhookResponse.ok) {
      const errorText = await webhookResponse.text();
      return res.status(500).json({
        error: "telegram_api_error",
        message: `Failed to get webhook info: ${webhookResponse.status}`,
        details: errorText,
      });
    }

    const webhookInfo = await webhookResponse.json();
    
    // Get bot info
    const botInfoUrl = `https://api.telegram.org/bot${telegramBotToken}/getMe`;
    const botInfoResponse = await fetch(botInfoUrl);
    const botInfo = botInfoResponse.ok ? await botInfoResponse.json() : null;

    // Check if bot is in the channel (if chat ID is configured)
    let channelInfo = null;
    if (telegramChatId) {
      try {
        const chatInfoUrl = `https://api.telegram.org/bot${telegramBotToken}/getChat?chat_id=${telegramChatId}`;
        const chatInfoResponse = await fetch(chatInfoUrl);
        if (chatInfoResponse.ok) {
          channelInfo = await chatInfoResponse.json();
        }
      } catch (error) {
        // Bot might not have access to getChat
        console.warn("Could not get channel info:", error);
      }
    }

    return res.status(200).json({
      ok: true,
      webhook: webhookInfo.result,
      bot: botInfo?.result || null,
      channel: channelInfo?.result || null,
      configuration: {
        hasBotToken: !!telegramBotToken,
        hasChatId: !!telegramChatId,
        chatId: telegramChatId,
        webhookUrl: webhookInfo.result?.url || null,
        webhookConfigured: !!webhookInfo.result?.url,
        pendingUpdateCount: webhookInfo.result?.pending_update_count || 0,
        lastErrorDate: webhookInfo.result?.last_error_date || null,
        lastErrorMessage: webhookInfo.result?.last_error_message || null,
      },
      recommendations: [
        !webhookInfo.result?.url && "Webhook is not configured. Set it with: curl -X POST \"https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://yourdomain.com/api/telegram/webhook\"",
        webhookInfo.result?.last_error_message && `Webhook has errors: ${webhookInfo.result.last_error_message}`,
        webhookInfo.result?.pending_update_count > 0 && `There are ${webhookInfo.result.pending_update_count} pending updates`,
        !channelInfo && telegramChatId && "Bot might not have access to the channel. Make sure the bot is added as an admin.",
      ].filter(Boolean),
    });
  } catch (error: any) {
    console.error("Error checking webhook status:", error);
    return res.status(500).json({ 
      error: "check_failed", 
      message: error.message 
    });
  }
}
