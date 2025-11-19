// Load notification preferences from localStorage
export type Channel = "nostr" | "telegram";

export type EventKey =
  | "repo_watch"
  | "repo_star"
  | "repo_zap"
  | "issue_opened"
  | "issue_commented"
  | "pr_opened"
  | "pr_review"
  | "pr_merged"
  | "mention"
  | "bounty_funded"
  | "bounty_released"
  | "bounty_cancelled";

export type NotificationPrefs = {
  channels: {
    nostr: { enabled: boolean; npub?: string };
    telegram: { enabled: boolean; handle?: string; userId?: string }; // userId is the Telegram user ID for DMs
  };
  events: Record<EventKey, boolean>;
};

const DEFAULT_PREFS: NotificationPrefs = {
  channels: {
    nostr: { enabled: true, npub: "" },
    telegram: { enabled: false, handle: "" },
  },
  events: {
    repo_watch: true,
    repo_star: true,
    repo_zap: true,
    issue_opened: true,
    issue_commented: true,
    pr_opened: true,
    pr_review: true,
    pr_merged: true,
    mention: true,
    bounty_funded: true,
    bounty_released: true,
    bounty_cancelled: true,
  },
};

/**
 * Load notification preferences for a user
 * @param pubkey - User's pubkey (full 64-char hex or npub)
 * @returns Notification preferences or defaults
 */
export function loadNotificationPrefs(pubkey?: string): NotificationPrefs {
  try {
    const stored = localStorage.getItem("gittr_notifications");
    if (stored) {
      const parsed = JSON.parse(stored);
      return { ...DEFAULT_PREFS, ...parsed };
    }
  } catch (error) {
    console.error("Failed to load notification preferences:", error);
  }
  return DEFAULT_PREFS;
}

/**
 * Check if a specific event type should trigger notifications
 */
export function shouldNotify(eventType: EventKey, prefs: NotificationPrefs): boolean {
  return prefs.events[eventType] === true;
}

