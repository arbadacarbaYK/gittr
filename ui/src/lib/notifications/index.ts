// Main notification service - dispatches via server deliver (recipient consent)
import { type EventKey } from "./prefs";
import { sendTelegramChannelAnnouncement } from "./telegram-channel";
import type { NotificationData } from "./nostr-dm";

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
 * Send notifications to a user based on THEIR registered preferences
 * (kind 30078 + server consent), not the actor's localStorage.
 */
export async function sendNotification(
  data: NotificationEventData
): Promise<void> {
  try {
    const response = await fetch("/api/notifications/deliver", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipientPubkey: data.recipientPubkey,
        eventType: data.eventType,
        title: data.title,
        message: data.message,
        url: data.url,
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      console.warn("Notification deliver failed:", err);
    } else {
      const result = await response.json().catch(() => ({}));
      if (result.status === "skipped") {
        console.log(
          `Notification skipped for ${data.eventType}:`,
          result.reason
        );
      }
    }

    // Public channel announcements for bounties (community feed — not opt-in DMs)
    if (
      data.eventType === "bounty_funded" ||
      data.eventType === "bounty_released"
    ) {
      const notificationData: NotificationData = {
        eventType: data.eventType,
        title: data.title,
        message: data.message,
        url: data.url,
        repoEntity: data.repoEntity,
        repoName: data.repoName,
      };
      await sendTelegramChannelAnnouncement(notificationData);
    }
  } catch (error) {
    console.error("Failed to send notification:", error);
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
  const repo =
    context.repoEntity && context.repoName
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
        message: `Your pull request "${
          context.prTitle || ""
        }" has been merged!`,
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
        message: `The bounty on "${
          context.issueTitle || "the issue"
        }" in ${repo} was cancelled because the issue was closed without a PR`,
        url: context.url,
      };

    case "mention":
      return {
        title: `You were mentioned in ${repo}`,
        message: `${context.authorName || "Someone"} mentioned you in ${
          context.issueId
            ? `issue #${context.issueId}`
            : context.prId
            ? `PR #${context.prId}`
            : "a post"
        }`,
        url: context.url,
      };

    case "security_cve":
      return {
        title: `Security alert for ${repo}`,
        message:
          context.issueTitle ||
          "A confirmed CRITICAL/HIGH vulnerability affects a pinned direct dependency",
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
