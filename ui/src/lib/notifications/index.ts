// Main notification service - dispatches notifications to enabled channels
import { loadNotificationPrefs, shouldNotify, type EventKey } from "./prefs";
import { sendNostrDM, type NotificationData } from "./nostr-dm";
import { sendTelegramDM } from "./telegram-dm";
import { sendTelegramChannelAnnouncement } from "./telegram-channel";

export interface NotificationEventData {
  eventType: EventKey;
  title: string;
  message: string;
  url?: string;
  repoEntity?: string;
  repoName?: string;
  recipientPubkey: string; // Recipient's pubkey (hex) or npub
}

/**
 * Send notifications to a user based on their preferences
 * @param data - Notification event data
 */
export async function sendNotification(data: NotificationEventData): Promise<void> {
  try {
    // Load user's notification preferences
    const prefs = loadNotificationPrefs(data.recipientPubkey);

    // Check if this event type should trigger notifications
    if (!shouldNotify(data.eventType, prefs)) {
      console.log(`Notification skipped: ${data.eventType} disabled for user`);
      return;
    }

    const notificationData: NotificationData = {
      eventType: data.eventType,
      title: data.title,
      message: data.message,
      url: data.url,
      repoEntity: data.repoEntity,
      repoName: data.repoName,
    };

    // Send Nostr DM if enabled
    if (prefs.channels.nostr.enabled) {
      // Use npub from prefs if set, otherwise use recipientPubkey
      const recipient = prefs.channels.nostr.npub || data.recipientPubkey;
      await sendNostrDM(recipient, notificationData);
    }

    // Send Telegram DM if enabled (for private notifications like PRs/issues)
    if (prefs.channels.telegram.enabled && prefs.channels.telegram.userId) {
      await sendTelegramDM(prefs.channels.telegram.userId, notificationData);
    }

    // Send public channel announcement for bounties (in addition to DM if enabled)
    // Bounties are public events that should be announced to the community
    if (data.eventType === "bounty_funded" || data.eventType === "bounty_released") {
      await sendTelegramChannelAnnouncement(notificationData);
    }
  } catch (error) {
    console.error("Failed to send notification:", error);
    // Don't throw - notifications should be best-effort and not block user actions
  }
}

/**
 * Helper to format notification messages for common events
 */
export function formatNotificationMessage(
  eventType: EventKey,
  context: {
    repoEntity?: string;
    repoName?: string;
    issueId?: string;
    issueTitle?: string;
    prId?: string;
    prTitle?: string;
    authorName?: string;
    url?: string;
  }
): { title: string; message: string; url?: string } {
  const repo = context.repoEntity && context.repoName 
    ? `${context.repoEntity}/${context.repoName}`
    : "repository";

  switch (eventType) {
    case "issue_opened":
      return {
        title: `New issue in ${repo}`,
        message: context.issueTitle || "A new issue has been opened",
        url: context.url,
      };

    case "issue_commented":
      return {
        title: `New comment on issue #${context.issueId}`,
        message: `${context.authorName || "Someone"} commented on the issue`,
        url: context.url,
      };

    case "pr_opened":
      return {
        title: `New pull request in ${repo}`,
        message: context.prTitle || "A new pull request has been opened",
        url: context.url,
      };

    case "pr_review":
      return {
        title: `Review requested for PR #${context.prId}`,
        message: `${context.authorName || "Someone"} requested your review`,
        url: context.url,
      };

    case "pr_merged":
      return {
        title: `Pull request merged in ${repo}`,
        message: `Your pull request "${context.prTitle || ""}" has been merged!`,
        url: context.url,
      };

    case "bounty_funded":
      return {
        title: `Bounty funded on issue #${context.issueId}`,
        message: `A bounty has been added to the issue in ${repo}`,
        url: context.url,
      };

    case "bounty_released":
      return {
        title: `Bounty released!`,
        message: `You earned a bounty for your contribution to ${repo}`,
        url: context.url,
      };

    case "bounty_cancelled":
      return {
        title: `Bounty cancelled on issue #${context.issueId}`,
        message: `The bounty on "${context.issueTitle || "the issue"}" in ${repo} was cancelled because the issue was closed without a PR`,
        url: context.url,
      };

    case "mention":
      return {
        title: `You were mentioned in ${repo}`,
        message: `${context.authorName || "Someone"} mentioned you in ${context.issueId ? `issue #${context.issueId}` : context.prId ? `PR #${context.prId}` : "a post"}`,
        url: context.url,
      };

    default:
      return {
        title: "Notification",
        message: "An event occurred",
        url: context.url,
      };
  }
}

