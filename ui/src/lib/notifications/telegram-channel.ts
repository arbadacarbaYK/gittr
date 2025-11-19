// Send Telegram channel announcements (for public events like bounties)
import type { NotificationData } from "./nostr-dm";

/**
 * Send a message to the public Telegram channel
 * Used for public announcements like bounties
 * @param data - Notification data
 * @returns Promise that resolves when message is sent
 */
export async function sendTelegramChannelAnnouncement(
  data: NotificationData
): Promise<void> {
  try {
    const telegramChatId = process.env.TELEGRAM_CHAT_ID;
    if (!telegramChatId) {
      console.warn("TELEGRAM_CHAT_ID not configured, skipping channel announcement");
      return;
    }

    // Get bot token from server-side env (via API endpoint)
    const response = await fetch("/api/notifications/send-telegram-channel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: data.title,
        message: data.message,
        url: data.url,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      console.warn("Telegram channel announcement failed:", error);
    } else {
      console.log("Telegram channel announcement sent");
    }
  } catch (error) {
    console.error("Failed to send Telegram channel announcement:", error);
    // Don't throw - announcements should be best-effort
  }
}

