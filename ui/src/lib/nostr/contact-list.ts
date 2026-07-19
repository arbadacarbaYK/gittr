/**
 * NIP-02 kind 3 contact list helpers.
 * Prefer `p` tags (spec); also merge gittr-style JSON content `{ p: [...] }`.
 */

const BACKUP_PREFIX = "gittr_contact_list_backup_";

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

/** Persist a non-empty follow list so a slow relay fetch cannot wipe it. */
export function saveContactListBackup(
  ownerPubkey: string,
  pubkeys: string[]
): void {
  if (typeof window === "undefined") return;
  const hex = (ownerPubkey || "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hex)) return;
  const unique = Array.from(
    new Set(
      pubkeys
        .map((p) => (p || "").toLowerCase())
        .filter((p) => /^[0-9a-f]{64}$/.test(p))
    )
  );
  if (unique.length === 0) return;
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
  const hex = (ownerPubkey || "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hex)) return [];
  try {
    const raw = localStorage.getItem(`${BACKUP_PREFIX}${hex}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { pubkeys?: unknown };
    if (!Array.isArray(parsed.pubkeys)) return [];
    return parsed.pubkeys
      .map((p) => String(p || "").toLowerCase())
      .filter((p) => /^[0-9a-f]{64}$/.test(p));
  } catch {
    return [];
  }
}
