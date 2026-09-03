/**
 * NIP-02 kind 3 contact list helpers.
 * Prefer `p` tags (spec); also merge gittr-style JSON content `{ p: [...] }`.
 *
 * Kind 3 is replaceable: a short publish wipes the previous follow graph.
 * Always merge onto the largest known list before signing.
 */

import { nip19 } from "nostr-tools";

const BACKUP_PREFIX = "gittr_contact_list_backup_";
const SESSION_PREFIX = "gittr_contact_list_session_";

/**
 * Fired after rememberContactList so TrustBadge / useWoTDistance can refresh
 * without waiting for a re-fetched kind 3 (Follow button already has the list).
 */
export const CONTACT_LIST_CHANGED_EVENT = "gittr:contact-list-changed";

export type ContactListChangedDetail = {
  ownerPubkey: string;
  pubkeys: string[];
};

/** Global queue so rapid Follow clicks cannot race two kind-3 publishes. */
let followPublishChain: Promise<void> = Promise.resolve();

export function enqueueFollowPublish<T>(fn: () => Promise<T>): Promise<T> {
  const run = followPublishChain.then(fn, fn);
  followPublishChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

export function normalizeContactPubkey(raw: string): string | null {
  const s = (raw || "").trim();
  if (!s) return null;

  // Hex pubkey fast path (common case).
  const hex = s.toLowerCase();
  if (/^[0-9a-f]{64}$/.test(hex)) return hex;

  // Some clients (non-compliant) may encode `p` tags using npub bech32.
  if (s.toLowerCase().startsWith("npub1")) {
    try {
      const decoded = nip19.decode(s) as { type?: string; data?: string };
      if (decoded?.type === "npub" && typeof decoded.data === "string") {
        return decoded.data.toLowerCase();
      }
    } catch {
      /* ignore invalid bech32 */
    }
  }

  return null;
}

export function uniqContactPubkeys(pubkeys: string[]): string[] {
  const out = new Set<string>();
  for (const p of pubkeys) {
    const hex = normalizeContactPubkey(p);
    if (hex) out.add(hex);
  }
  return Array.from(out);
}

/** Union of several contact lists (order not meaningful). */
export function mergeContactLists(
  ...lists: Array<string[] | null | undefined>
): string[] {
  const out = new Set<string>();
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const p of list) {
      const hex = normalizeContactPubkey(p);
      if (hex) out.add(hex);
    }
  }
  return Array.from(out);
}

export function parseContactListPubkeys(event: {
  tags?: string[][] | null;
  content?: string | null;
}): string[] {
  const out = new Set<string>();

  if (Array.isArray(event.tags)) {
    for (const tag of event.tags) {
      if (
        Array.isArray(tag) &&
        tag[0] === "p" &&
        typeof tag[1] === "string"
      ) {
        const pk = normalizeContactPubkey(tag[1]);
        if (pk) out.add(pk);
      }
    }
  }

  const trimmed = (event.content || "").trim();
  if (trimmed.startsWith("{")) {
    try {
      const data = JSON.parse(trimmed) as { p?: unknown };
      if (Array.isArray(data.p)) {
        for (const entry of data.p) {
          const rawPk =
            typeof entry === "string"
              ? entry
              : Array.isArray(entry)
              ? entry[0]
              : entry &&
                typeof entry === "object" &&
                typeof (entry as { pubkey?: string }).pubkey === "string"
              ? (entry as { pubkey: string }).pubkey
              : "";
          const pk =
            typeof rawPk === "string" ? normalizeContactPubkey(rawPk) : null;
          if (pk) {
            out.add(pk);
          }
        }
      }
    } catch {
      /* ignore */
    }
  }

  return Array.from(out);
}

/**
 * Persist follow list. By default never shrinks an existing backup
 * (partial relay fetches must not poison recovery).
 */
export function saveContactListBackup(
  ownerPubkey: string,
  pubkeys: string[],
  opts?: { allowShrink?: boolean }
): void {
  if (typeof window === "undefined") return;
  const hex = normalizeContactPubkey(ownerPubkey);
  if (!hex) return;
  const unique = uniqContactPubkeys(pubkeys);
  if (unique.length === 0) return;
  const prev = loadContactListBackup(hex);
  if (!opts?.allowShrink && prev.length > unique.length) {
    // Keep the larger known list; merge so we don't lose anyone.
    const merged = mergeContactLists(prev, unique);
    try {
      localStorage.setItem(
        `${BACKUP_PREFIX}${hex}`,
        JSON.stringify({
          pubkeys: merged,
          savedAt: Date.now(),
        })
      );
    } catch {
      /* quota */
    }
    return;
  }
  try {
    localStorage.setItem(
      `${BACKUP_PREFIX}${hex}`,
      JSON.stringify({
        pubkeys: unique,
        savedAt: Date.now(),
      })
    );
  } catch {
    /* quota / private mode */
  }
}

export function loadContactListBackup(ownerPubkey: string): string[] {
  if (typeof window === "undefined") return [];
  const hex = normalizeContactPubkey(ownerPubkey);
  if (!hex) return [];
  try {
    const raw = localStorage.getItem(`${BACKUP_PREFIX}${hex}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { pubkeys?: unknown };
    if (!Array.isArray(parsed.pubkeys)) return [];
    return uniqContactPubkeys(parsed.pubkeys.map((p) => String(p || "")));
  } catch {
    return [];
  }
}

/**
 * Same-tab session copy so remounting an entity page cannot lose the list
 * when localStorage is empty/blocked but we already loaded a full kind 3.
 */
export function saveContactListSession(
  ownerPubkey: string,
  pubkeys: string[],
  opts?: { allowShrink?: boolean }
): void {
  if (typeof window === "undefined") return;
  const hex = normalizeContactPubkey(ownerPubkey);
  if (!hex) return;
  const unique = uniqContactPubkeys(pubkeys);
  if (unique.length === 0 && !opts?.allowShrink) return;
  try {
    if (!opts?.allowShrink) {
      const prev = loadContactListSession(hex);
      if (prev.length > unique.length) {
        const merged = mergeContactLists(prev, unique);
        sessionStorage.setItem(
          `${SESSION_PREFIX}${hex}`,
          JSON.stringify({ pubkeys: merged, savedAt: Date.now() })
        );
        return;
      }
    }
    sessionStorage.setItem(
      `${SESSION_PREFIX}${hex}`,
      JSON.stringify({ pubkeys: unique, savedAt: Date.now() })
    );
  } catch {
    /* private mode */
  }
}

export function loadContactListSession(ownerPubkey: string): string[] {
  if (typeof window === "undefined") return [];
  const hex = normalizeContactPubkey(ownerPubkey);
  if (!hex) return [];
  try {
    const raw = sessionStorage.getItem(`${SESSION_PREFIX}${hex}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { pubkeys?: unknown };
    if (!Array.isArray(parsed.pubkeys)) return [];
    return uniqContactPubkeys(parsed.pubkeys.map((p) => String(p || "")));
  } catch {
    return [];
  }
}

/** Union of durable backup + session cache (never shrinks either alone). */
export function loadKnownContactList(ownerPubkey: string): string[] {
  return mergeContactLists(
    loadContactListBackup(ownerPubkey),
    loadContactListSession(ownerPubkey)
  );
}

/**
 * Persist both stores after a successful follow edit or a solid relay fetch.
 */
export function rememberContactList(
  ownerPubkey: string,
  pubkeys: string[],
  opts?: { allowShrink?: boolean }
): void {
  saveContactListBackup(ownerPubkey, pubkeys, opts);
  saveContactListSession(ownerPubkey, pubkeys, opts);
  if (typeof window === "undefined") return;
  const hex = normalizeContactPubkey(ownerPubkey);
  if (!hex) return;
  const detail: ContactListChangedDetail = {
    ownerPubkey: hex,
    pubkeys: loadKnownContactList(hex),
  };
  try {
    window.dispatchEvent(
      new CustomEvent(CONTACT_LIST_CHANGED_EVENT, { detail })
    );
  } catch {
    /* ignore */
  }
}

/**
 * Build the safest base list for a Follow edit:
 * union of relay contacts (prefer the union of ALL kind-3 events seen,
 * not only the newest — a tiny newer wipe must not discard a larger older list),
 * local backup, and in-memory state.
 */
export function resolveContactListBase(args: {
  relayContacts: string[] | null;
  relayCreatedAt: number;
  inMemory: string[];
  backup: string[];
  /** Largest single kind-3 list observed on any relay this fetch (even if not newest). */
  largestRelayListSize?: number;
}): {
  contacts: string[];
  uncertainEmpty: boolean;
  /** True when relay returned a much smaller list than backup (likely stale/partial). */
  relayLooksPartial: boolean;
} {
  const relay = uniqContactPubkeys(args.relayContacts || []);
  const memory = uniqContactPubkeys(args.inMemory || []);
  const backup = uniqContactPubkeys(args.backup || []);
  const largestLocal = Math.max(memory.length, backup.length);
  const largestRelay = Math.max(args.largestRelayListSize || 0, relay.length);
  const largestKnown = Math.max(largestLocal, largestRelay);

  const relayLooksPartial =
    relay.length > 0 &&
    largestKnown >= 5 &&
    relay.length < Math.max(2, Math.floor(largestKnown * 0.5));

  const contacts = mergeContactLists(relay, memory, backup);
  const uncertainEmpty =
    contacts.length === 0 &&
    !args.relayContacts &&
    memory.length === 0 &&
    backup.length === 0;

  return {
    contacts,
    uncertainEmpty: Boolean(uncertainEmpty),
    relayLooksPartial,
  };
}

/**
 * Whether publishing `nextCount` follows would dangerously shrink a known list.
 */
export function wouldWipeFollowList(args: {
  nextCount: number;
  backupSize: number;
  largestRelayListSize: number;
  inMemorySize: number;
  relayLooksPartial: boolean;
}): boolean {
  const known = Math.max(
    args.backupSize,
    args.largestRelayListSize,
    args.inMemorySize
  );
  if (known < 10) return false;
  if (args.nextCount >= Math.max(5, Math.floor(known * 0.5))) return false;
  return true;
}

/** Following count = unique `p` tags across kind-3 events for one author (union). */
export function followingCountFromContactEvents(
  events: Array<{ tags?: string[][] | null; content?: string | null }>
): number {
  return mergeContactLists(...events.map((e) => parseContactListPubkeys(e)))
    .length;
}

/**
 * Follower count from kind-3 events that tag `profileHex` (`#p` filter).
 * Keeps the newest event per author, then counts authors who still list them.
 */
export function followersCountFromContactEvents(
  profileHex: string,
  events: Array<{
    pubkey?: string;
    created_at?: number;
    tags?: string[][] | null;
    content?: string | null;
  }>
): number {
  const target = normalizeContactPubkey(profileHex);
  if (!target) return 0;

  const newestByAuthor = new Map<
    string,
    {
      created_at: number;
      tags?: string[][] | null;
      content?: string | null;
    }
  >();

  for (const ev of events) {
    const author = normalizeContactPubkey(ev.pubkey || "");
    if (!author) continue;
    const created = typeof ev.created_at === "number" ? ev.created_at : 0;
    const prev = newestByAuthor.get(author);
    if (!prev || created >= prev.created_at) {
      newestByAuthor.set(author, {
        created_at: created,
        tags: ev.tags,
        content: ev.content,
      });
    }
  }

  let count = 0;
  for (const ev of newestByAuthor.values()) {
    if (parseContactListPubkeys(ev).includes(target)) count += 1;
  }
  return count;
}
