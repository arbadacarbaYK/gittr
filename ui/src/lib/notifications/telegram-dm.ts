// Send Telegram DM notifications
import type { NotificationData } from "./nostr-dm";

/**
 * Send a Telegram direct message to a user
 * @param userId - Telegram user ID (numeric, e.g., "123456789")
 * @param data - Notification data
 * @returns Promise that resolves when message is sent
 */
export async function sendTelegramDM(
  userId: string,
  data: NotificationData
): Promise<void> {
  try {
    // Get bot token from server-side env (via API endpoint)
    // Client-side can't access server env vars, so we use the API
    const response = await fetch("/api/notifications/send-telegram", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId,
        title: data.title,
        message: data.message,
        url: data.url,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      console.warn("Telegram DM failed:", error);
    } else {
      console.log("Telegram DM sent to user", userId);
    }
  } catch (error) {
    console.error("Failed to send Telegram DM:", error);
    // Don't throw - notifications should be best-effort
  }
}
