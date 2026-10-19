// Send Telegram channel announcements (for public events like bounties)
import type { NotificationData } from "./nostr-dm";

/**
 * Send a message to the public Telegram channel
 * Used for public announcements like bounties
 * @param data - Notification data
 * @returns Promise that resolves when message is sent
 */
export async function sendTelegramChannelAnnouncement(
  _data: NotificationData
): Promise<void> {
  // The public channel route is closed. The server posts after a bounty
  // payment succeeds (create-withdraw / release), not from the browser.
}
