/**
 * NIP-02 kind 3 contact list helpers.
 * Prefer `p` tags (spec); also merge gittr-style JSON content `{ p: [...] }`.
 *
 * Kind 3 is replaceable: a short publish wipes the previous follow graph.
 * Always merge onto the largest known list before signing.
 */

const BACKUP_PREFIX = "gittr_contact_list_backup_";

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
  const hex = (raw || "").toLowerCase().trim();
  return /^[0-9a-f]{64}$/.test(hex) ? hex : null;
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
export function mergeContactLists(...lists: Array<string[] | null | undefined>): string[] {
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
        typeof tag[1] === "string" &&
        /^[0-9a-f]{64}$/i.test(tag[1])
      ) {
        out.add(tag[1].toLowerCase());
      }
    }
  }

  const trimmed = (event.content || "").trim();
  if (trimmed.startsWith("{")) {
    try {
      const data = JSON.parse(trimmed) as { p?: unknown };
      if (Array.isArray(data.p)) {
        for (const entry of data.p) {
          const pk =
            typeof entry === "string"
              ? entry
              : Array.isArray(entry)
                ? entry[0]
                : entry &&
                    typeof entry === "object" &&
                    typeof (entry as { pubkey?: string }).pubkey === "string"
                  ? (entry as { pubkey: string }).pubkey
                  : "";
          if (typeof pk === "string" && /^[0-9a-f]{64}$/i.test(pk)) {
            out.add(pk.toLowerCase());
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
 * Build the safest base list for a Follow edit:
 * union of newest relay event, local backup, and in-memory state.
 * Prefer newest created_at for "isFollowing" semantics, but never drop
 * pubkeys that only exist on a larger older list / backup.
 */
export function resolveContactListBase(args: {
  relayContacts: string[] | null;
  relayCreatedAt: number;
  inMemory: string[];
  backup: string[];
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

  const relayLooksPartial =
    relay.length > 0 &&
    largestLocal >= 5 &&
    relay.length < Math.max(2, Math.floor(largestLocal * 0.5));

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
