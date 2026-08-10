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
  | "bounty_cancelled"
  | "security_cve";

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
    // Match Settings defaults: social noise off; collaboration on; CVE strict opt-in.
    repo_watch: false,
    repo_star: false,
    repo_zap: false,
    issue_opened: true,
    issue_commented: true,
    pr_opened: true,
    pr_review: true,
    pr_merged: true,
    mention: true,
    bounty_funded: true,
    bounty_released: true,
    bounty_cancelled: true,
    // Strict opt-in: bot must also verify kind 30078 on relays — localStorage alone is not consent.
    security_cve: false,
  },
};

/** Partial prefs for merge/hydrate (events may be sparse, e.g. legacy CVE-only). */
export type PartialNotificationPrefs = {
  channels?: {
    nostr?: Partial<NotificationPrefs["channels"]["nostr"]>;
    telegram?: Partial<NotificationPrefs["channels"]["telegram"]>;
  };
  events?: Partial<Record<EventKey, boolean>>;
};

function deepMergePrefs(
  stored: PartialNotificationPrefs | null | undefined
): NotificationPrefs {
  const channels = {
    nostr: {
      ...DEFAULT_PREFS.channels.nostr,
      ...(stored?.channels?.nostr || {}),
    },
    telegram: {
      ...DEFAULT_PREFS.channels.telegram,
      ...(stored?.channels?.telegram || {}),
    },
  };
  const events = {
    ...DEFAULT_PREFS.events,
    ...(stored?.events || {}),
  } as Record<EventKey, boolean>;
  return { channels, events };
}

/**
 * Load notification preferences for a user
 * @param pubkey - Reserved for future recipient-scoped prefs (ignored today — browser localStorage only)
 * @returns Notification preferences or defaults
 */
export function loadNotificationPrefs(_pubkey?: string): NotificationPrefs {
  try {
    const stored = localStorage.getItem("gittr_notifications");
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<NotificationPrefs>;
      return deepMergePrefs(parsed);
    }
  } catch (error) {
    console.error("Failed to load notification preferences:", error);
  }
  return deepMergePrefs(null);
}

/**
 * Check if a specific event type should trigger notifications
 */
export function shouldNotify(
  eventType: EventKey,
  prefs: NotificationPrefs
): boolean {
  return prefs.events[eventType] === true;
}

export { DEFAULT_PREFS, deepMergePrefs };
