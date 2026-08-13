/**
 * Server-side notification delivery prefs.
 * Telegram userId stays here — never on public relays.
 *
 * Runtime file (production: /opt/ngit/data/notifications-consent.json) is
 * server-owned. Deploy must never upload/overwrite it from a laptop.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

import { DEFAULT_PREFS, type EventKey } from "./prefs";

export type NotificationConsentRecord = {
  nostr: boolean;
  telegram: boolean;
  telegramUserId?: string;
  events: Partial<Record<EventKey, boolean>>;
  updatedAt: string;
};

export type NotificationConsentStore = {
  updatedAt?: string;
  byPubkey: Record<string, NotificationConsentRecord>;
};

export class ConsentStoreUnreadableError extends Error {
  constructor(file: string, cause?: unknown) {
    super(
      `notification consent store unreadable at ${file} — refusing to treat as empty (would risk wiping opt-ins)`
    );
    this.name = "ConsentStoreUnreadableError";
    if (cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = cause;
    }
  }
}

export function resolveNotificationConsentPath(explicit?: string): string {
  if (explicit) return explicit;
  if (process.env.NOTIFICATIONS_CONSENT_PATH)
    return process.env.NOTIFICATIONS_CONSENT_PATH;
  if (process.env.CVE_CONSENT_PATH) return process.env.CVE_CONSENT_PATH;
  const cwd = process.cwd();
  const primary = /[/\\]ui$/.test(cwd)
    ? join(cwd, "..", "data", "notifications-consent.json")
    : join(cwd, "data", "notifications-consent.json");
  const legacy = /[/\\]ui$/.test(cwd)
    ? join(cwd, "..", "data", "cve-consent.json")
    : join(cwd, "data", "cve-consent.json");
  if (existsSync(primary)) return primary;
  if (existsSync(legacy)) return legacy;
  return primary;
}

function migrateLegacyRecord(raw: any): NotificationConsentRecord | null {
  if (!raw || typeof raw !== "object") return null;
  // New shape
  if (raw.events && typeof raw.events === "object") {
    return {
      nostr: !!raw.nostr,
      telegram: !!raw.telegram,
      telegramUserId: raw.telegramUserId
        ? String(raw.telegramUserId).trim()
        : undefined,
      events: { ...raw.events },
      updatedAt: raw.updatedAt || new Date().toISOString(),
    };
  }
  // Old CVE-only shape: { enabled, nostr, telegram, telegramUserId }
  if (typeof raw.enabled === "boolean") {
    return {
      nostr: raw.nostr ?? true,
      telegram: !!raw.telegram,
      telegramUserId: raw.telegramUserId
        ? String(raw.telegramUserId).trim()
        : undefined,
      events: {
        ...Object.fromEntries(
          Object.entries(DEFAULT_PREFS.events).map(([k, v]) => [k, v])
        ),
        security_cve: raw.enabled,
      },
      updatedAt: raw.updatedAt || new Date().toISOString(),
    };
  }
  return null;
}

function parseConsentStoreFromDisk(file: string): NotificationConsentStore {
  const raw = JSON.parse(readFileSync(file, "utf8")) as {
    updatedAt?: string;
    byPubkey?: Record<string, unknown>;
  };
  const byPubkey: Record<string, NotificationConsentRecord> = {};
  for (const [pk, val] of Object.entries(raw.byPubkey || {})) {
    const migrated = migrateLegacyRecord(val);
    if (migrated) byPubkey[pk.toLowerCase()] = migrated;
  }
  return { updatedAt: raw.updatedAt, byPubkey };
}

/**
 * Load consent store. Missing file → empty (create path).
 * Corrupt / unreadable existing file → throws (do not silently empty).
 */
export function loadNotificationConsentStore(
  path?: string
): NotificationConsentStore {
  const file = resolveNotificationConsentPath(path);
  if (!existsSync(file)) return { byPubkey: {} };
  try {
    return parseConsentStoreFromDisk(file);
  } catch (e) {
    if (e instanceof ConsentStoreUnreadableError) throw e;
    throw new ConsentStoreUnreadableError(file, e);
  }
}

/** Soft load for delivery lookups — never invent empty over a corrupt file. */
export function getNotificationConsent(
  pubkey: string,
  path?: string
): NotificationConsentRecord | null {
  try {
    const store = loadNotificationConsentStore(path);
    return store.byPubkey[pubkey.toLowerCase()] || null;
  } catch (e) {
    if (e instanceof ConsentStoreUnreadableError) {
      console.error("[notification-consent]", e.message);
      return null;
    }
    throw e;
  }
}

export type SaveConsentOptions = {
  /**
   * Allow writing `{ byPubkey: {} }` over an existing non-empty file.
   * Default false — protects against load-error / empty-deploy wipes.
   * Per-user opt-out still uses upsert (keeps the pubkey row).
   */
  allowEmptyOverwrite?: boolean;
};

function onDiskPubkeyCount(file: string): number {
  if (!existsSync(file)) return 0;
  try {
    return Object.keys(parseConsentStoreFromDisk(file).byPubkey).length;
  } catch {
    // Unreadable existing file: treat as non-empty so we refuse empty wipe
    return Number.POSITIVE_INFINITY;
  }
}

export function saveNotificationConsentStore(
  store: NotificationConsentStore,
  path?: string,
  options?: SaveConsentOptions
): string {
  const file = resolveNotificationConsentPath(path);
  mkdirSync(dirname(file), { recursive: true });
  // Always write to canonical notifications-consent.json going forward
  const canonical = file.includes("cve-consent.json")
    ? file.replace(/cve-consent\.json$/, "notifications-consent.json")
    : file;
  const incomingCount = Object.keys(store.byPubkey || {}).length;
  const existingCount = onDiskPubkeyCount(canonical);
  if (
    incomingCount === 0 &&
    existingCount > 0 &&
    !options?.allowEmptyOverwrite
  ) {
    throw new Error(
      `refusing to overwrite non-empty notification consent store (${existingCount} pubkey(s)) with empty store at ${canonical}; set allowEmptyOverwrite if intentional`
    );
  }
  const body: NotificationConsentStore = {
    updatedAt: new Date().toISOString(),
    byPubkey: store.byPubkey,
  };
  const tmp = `${canonical}.tmp.${process.pid}.${Date.now()}`;
  writeFileSync(tmp, JSON.stringify(body, null, 2) + "\n");
  renameSync(tmp, canonical);
  return canonical;
}

export function upsertNotificationConsent(
  pubkey: string,
  record: Omit<NotificationConsentRecord, "updatedAt">,
  path?: string
): NotificationConsentRecord {
  const store = loadNotificationConsentStore(path);
  const pk = pubkey.toLowerCase();
  const next: NotificationConsentRecord = {
    nostr: !!record.nostr,
    telegram: !!record.telegram,
    telegramUserId:
      record.telegram && record.telegramUserId
        ? String(record.telegramUserId).trim()
        : undefined,
    events: { ...record.events },
    updatedAt: new Date().toISOString(),
  };
  store.byPubkey[pk] = next;
  saveNotificationConsentStore(store, path);
  return next;
}

/** Effective event toggle: consent store → default prefs. */
export function consentAllowsEvent(
  record: NotificationConsentRecord | null,
  eventType: EventKey
): boolean {
  if (!record) {
    // No registration: only deliver if default would (collaboration on, CVE off)
    return DEFAULT_PREFS.events[eventType] === true;
  }
  if (typeof record.events[eventType] === "boolean") {
    return record.events[eventType] === true;
  }
  return DEFAULT_PREFS.events[eventType] === true;
}

// --- Back-compat aliases for CVE bot / old imports ---
export type CveConsentRecord = NotificationConsentRecord;
export const resolveCveConsentPath = resolveNotificationConsentPath;
export const loadCveConsentStore = loadNotificationConsentStore;
export const saveCveConsentStore = saveNotificationConsentStore;
export const upsertCveConsent = (
  pubkey: string,
  record: {
    enabled: boolean;
    nostr: boolean;
    telegram: boolean;
    telegramUserId?: string;
  },
  path?: string
) =>
  upsertNotificationConsent(
    pubkey,
    {
      nostr: record.nostr,
      telegram: record.telegram,
      telegramUserId: record.telegramUserId,
      events: { security_cve: record.enabled },
    },
    path
  );
export const getCveConsent = getNotificationConsent;
