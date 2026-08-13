/**
 * Kind 30078 notification preferences (NIP-78).
 * Public on relays: channels + event toggles. Telegram User ID is server-only.
 */
import {
  DEFAULT_PREFS,
  type EventKey,
  type NotificationPrefs,
  deepMergePrefs,
} from "./prefs";

export const KIND_NOTIFICATION_PREFS = 30078;
/** Canonical replaceable d-tag for full notification prefs. */
export const NOTIFICATION_PREFS_D_TAG = "gittr/notifications";
/** Legacy CVE-only d-tag (still hydrated for security_cve). */
export const LEGACY_CVE_OPT_IN_D_TAG = "gittr/security-cve";

// Back-compat aliases used by older CVE helpers / bot
export const KIND_CVE_OPT_IN = KIND_NOTIFICATION_PREFS;
export const CVE_OPT_IN_D_TAG = LEGACY_CVE_OPT_IN_D_TAG;

export type NotificationPrefsEventLike = {
  kind: number;
  pubkey?: string;
  content?: string;
  tags?: string[][];
  created_at?: number;
  id?: string;
  sig?: string;
};

export type NotificationPrefsEventContent = {
  v: 1;
  channels: { nostr: boolean; telegram: boolean };
  events: Partial<Record<EventKey, boolean>>;
};

const EVENT_KEYS: EventKey[] = [
  "repo_watch",
  "repo_star",
  "repo_zap",
  "issue_opened",
  "issue_commented",
  "pr_opened",
  "pr_review",
  "pr_merged",
  "mention",
  "bounty_funded",
  "bounty_released",
  "bounty_cancelled",
  "security_cve",
];

export function getNotificationPrefsDTag(
  event: NotificationPrefsEventLike
): string | null {
  for (const t of event.tags || []) {
    if (Array.isArray(t) && t[0] === "d" && typeof t[1] === "string") {
      return t[1];
    }
  }
  return null;
}

export function buildNotificationPrefsContent(
  prefs: NotificationPrefs
): NotificationPrefsEventContent {
  const events: Partial<Record<EventKey, boolean>> = {};
  for (const key of EVENT_KEYS) {
    events[key] = !!prefs.events[key];
  }
  return {
    v: 1,
    channels: {
      nostr: !!prefs.channels.nostr.enabled,
      telegram: !!prefs.channels.telegram.enabled,
    },
    events,
  };
}

export function buildNotificationPrefsUnsignedEvent(
  pubkey: string,
  prefs: NotificationPrefs
): {
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
  pubkey: string;
} {
  return {
    kind: KIND_NOTIFICATION_PREFS,
    created_at: Math.floor(Date.now() / 1000),
    tags: [["d", NOTIFICATION_PREFS_D_TAG]],
    content: JSON.stringify(buildNotificationPrefsContent(prefs)),
    pubkey,
  };
}

/**
 * Parse relay content into NotificationPrefs (no telegram userId).
 * Supports:
 * - new: { v, channels, events }
 * - legacy CVE: { enabled, channels? } → maps to security_cve + channels
 */
export function parseNotificationPrefsContent(
  content: string | undefined | null
): NotificationPrefs | null {
  if (!content || typeof content !== "string") return null;
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return null;

    // Legacy CVE-only shape
    if (
      typeof parsed.enabled === "boolean" &&
      (parsed.events === undefined || parsed.events === null)
    ) {
      const channels = (parsed.channels || {}) as {
        nostr?: boolean;
        telegram?: boolean;
      };
      return deepMergePrefs({
        channels: {
          nostr: { enabled: channels.nostr ?? true },
          telegram: { enabled: channels.telegram ?? false },
        },
        events: { security_cve: parsed.enabled },
      });
    }

    const ch = (parsed.channels || {}) as {
      nostr?: boolean;
      telegram?: boolean;
    };
    const ev = (parsed.events || {}) as Partial<Record<EventKey, boolean>>;
    return deepMergePrefs({
      channels: {
        nostr: { enabled: ch.nostr ?? DEFAULT_PREFS.channels.nostr.enabled },
        telegram: {
          enabled: ch.telegram ?? DEFAULT_PREFS.channels.telegram.enabled,
        },
      },
      events: ev,
    });
  } catch {
    return null;
  }
}

export function pickLatestNotificationPrefsEvent(
  events: NotificationPrefsEventLike[]
): NotificationPrefsEventLike | null {
  const matching = events.filter((e) => {
    if (e.kind !== KIND_NOTIFICATION_PREFS) return false;
    const d = getNotificationPrefsDTag(e);
    return d === NOTIFICATION_PREFS_D_TAG || d === LEGACY_CVE_OPT_IN_D_TAG;
  });
  if (matching.length === 0) return null;
  // Prefer canonical d over legacy when same created_at-ish: sort by created_at,
  // then prefer gittr/notifications.
  matching.sort((a, b) => {
    const dt = (b.created_at || 0) - (a.created_at || 0);
    if (dt !== 0) return dt;
    const ad = getNotificationPrefsDTag(a);
    const bd = getNotificationPrefsDTag(b);
    if (ad === NOTIFICATION_PREFS_D_TAG && bd !== NOTIFICATION_PREFS_D_TAG)
      return -1;
    if (bd === NOTIFICATION_PREFS_D_TAG && ad !== NOTIFICATION_PREFS_D_TAG)
      return 1;
    return 0;
  });
  return matching[0] || null;
}

export function isSecurityCveOptedIn(
  event: NotificationPrefsEventLike | null | undefined
): boolean {
  if (!event) return false;
  const prefs = parseNotificationPrefsContent(event.content);
  return prefs?.events.security_cve === true;
}

/** @deprecated use isSecurityCveOptedIn */
export function isCveOptedIn(
  event: NotificationPrefsEventLike | null | undefined
): boolean {
  return isSecurityCveOptedIn(event);
}

/** @deprecated use pickLatestNotificationPrefsEvent */
export function pickLatestCveOptIn(
  events: NotificationPrefsEventLike[]
): NotificationPrefsEventLike | null {
  return pickLatestNotificationPrefsEvent(events);
}

/** Legacy helpers kept for older call sites */
export function buildCveOptInUnsignedEvent(
  pubkey: string,
  enabled: boolean,
  channels?: { nostr?: boolean; telegram?: boolean }
) {
  const prefs = deepMergePrefs({
    channels: {
      nostr: { enabled: channels?.nostr ?? true },
      telegram: { enabled: channels?.telegram ?? false },
    },
    events: { security_cve: enabled },
  });
  // Publish under canonical d going forward
  return buildNotificationPrefsUnsignedEvent(pubkey, prefs);
}

export function parseCveOptInContent(content: string | null | undefined) {
  const prefs = parseNotificationPrefsContent(content);
  if (!prefs) return null;
  return {
    enabled: !!prefs.events.security_cve,
    v: 1 as const,
    channels: {
      nostr: !!prefs.channels.nostr.enabled,
      telegram: !!prefs.channels.telegram.enabled,
    },
  };
}

export function getCveOptInDTag(event: NotificationPrefsEventLike) {
  return getNotificationPrefsDTag(event);
}

export function buildCveOptInContent(
  enabled: boolean,
  channels?: { nostr?: boolean; telegram?: boolean }
) {
  return {
    enabled: !!enabled,
    v: 1 as const,
    channels: {
      nostr: channels?.nostr ?? true,
      telegram: channels?.telegram ?? false,
    },
  };
}
