// Send Telegram DM notifications
import type { NotificationData } from "./nostr-dm";

/**
 * Send a Telegram direct message to a user
 * @param userId - Telegram user ID (numeric, e.g., "123456789")
 * @param data - Notification data
 * @returns Promise that resolves when message is sent
 */
export async function sendTelegramDM(
  _userId: string,
  _data: NotificationData
): Promise<void> {
  // DMs are sent by POST /api/notifications/deliver using the recipient's
  // saved Telegram id. The old public send-telegram route is closed.
  console.warn(
    "sendTelegramDM is unused: delivery uses the recipient consent store"
  );
}
