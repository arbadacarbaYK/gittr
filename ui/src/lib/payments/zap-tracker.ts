// Zap tracking and history utilities
// Tracks zaps sent and received, displays counts
import { type Event } from "nostr-tools";
import { nip19 } from "nostr-tools";

// Helper to normalize pubkey/npub for comparison
function normalizePubkey(pubkey: string): string {
  if (!pubkey) return "";
  try {
    // If it's an npub, decode it
    if (pubkey.startsWith("npub")) {
      const decoded = nip19.decode(pubkey);
      return decoded.data as string;
    }
    // If it's already a hex pubkey, return as-is
    if (/^[0-9a-f]{64}$/i.test(pubkey)) {
      return pubkey.toLowerCase();
    }
    // If it's in some other format, try to extract hex
    return pubkey.toLowerCase();
  } catch {
    // If decoding fails, try to use as-is (might be hex already)
    return pubkey.toLowerCase();
  }
}

function notifyZapsUpdated(): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new Event("gittr:zaps-updated"));
  } catch {
    /* ignore */
  }
}

export interface ZapRecord {
  id: string; // Event ID or payment hash
  recipient: string; // pubkey/npub
  sender?: string; // pubkey/npub of who sent the zap
  amount: number; // sats
  comment?: string;
  createdAt: number;
  type: "repo" | "issue" | "pr" | "user";
  contextId?: string; // repo/issue/PR ID
  invoice?: string;
  status: "pending" | "paid" | "failed";
  /** `nip57` = kind 9735 zap receipt from relays; `gittr` or omitted = local gittr_zaps ledger */
  source?: "gittr" | "nip57";
}

// Store zap in history
export function recordZap(zap: ZapRecord): void {
  if (typeof window === "undefined") return;

  try {
    const zaps = JSON.parse(localStorage.getItem("gittr_zaps") || "[]");
    zaps.push(zap);
    // Keep only last 1000 zaps
    const recent = zaps.slice(-1000);
    localStorage.setItem("gittr_zaps", JSON.stringify(recent));
    notifyZapsUpdated();
  } catch {}
}

/** When LNbits/push polling confirms payment, flip the matching pending row. */
export function markZapPaid(zapId: string): void {
  if (typeof window === "undefined" || !zapId) return;
  try {
    const zaps = JSON.parse(
      localStorage.getItem("gittr_zaps") || "[]"
    ) as ZapRecord[];
    const i = zaps.findIndex((z) => z.id === zapId);
    if (i === -1) return;
    const row = zaps[i];
    if (!row) return;
    zaps[i] = { ...row, status: "paid" };
    localStorage.setItem("gittr_zaps", JSON.stringify(zaps));
    notifyZapsUpdated();
  } catch {
    /* ignore */
  }
}

// Get zap count for a recipient/context
export function getZapCount(
  recipient: string,
  contextId?: string,
  type?: string
): number {
  if (typeof window === "undefined") return 0;

  try {
    const zaps = JSON.parse(
      localStorage.getItem("gittr_zaps") || "[]"
    ) as ZapRecord[];
    const recNorm = normalizePubkey(recipient);
    const ctxNorm = contextId ? contextId.toLowerCase() : "";
    return zaps
      .filter(
        (z) =>
          normalizePubkey(z.recipient) === recNorm &&
          z.status === "paid" &&
          (!ctxNorm ||
            (z.contextId && z.contextId.toLowerCase() === ctxNorm)) &&
          (!type || z.type === type)
      )
      .reduce((sum, z) => sum + z.amount, 0);
  } catch {
    return 0;
  }
}

// Get zap history for a recipient/context
export function getZapHistory(
  recipient?: string,
  contextId?: string,
  limit = 50
): ZapRecord[] {
  if (typeof window === "undefined") return [];

  try {
    const zaps = JSON.parse(
      localStorage.getItem("gittr_zaps") || "[]"
    ) as ZapRecord[];
    let filtered = zaps;

    if (recipient) {
      filtered = filtered.filter((z) => z.recipient === recipient);
    }

    if (contextId) {
      filtered = filtered.filter((z) => z.contextId === contextId);
    }

    // Sort by creation time, newest first
    filtered.sort((a, b) => b.createdAt - a.createdAt);

    return filtered.slice(0, limit);
  } catch {
    return [];
  }
}

// Get total zap amount for a recipient/context
export function getZapTotal(recipient: string, contextId?: string): number {
  return getZapCount(recipient, contextId);
}

/** Map NIP-57 zap receipt (kind 9735) to a ZapRecord for the Your Zaps UI */
export function zapReceipt9735ToRecord(ev: Event): ZapRecord | null {
  if (ev.kind !== 9735) return null;
  const desc = ev.tags.find((t) => t[0] === "description")?.[1];
  if (!desc) return null;
  try {
    const zr = JSON.parse(desc) as {
      pubkey?: string;
      content?: string;
      tags?: string[][];
    };
    const amountTag = zr.tags?.find((t) => t[0] === "amount")?.[1];
    const msat = amountTag ? parseInt(amountTag, 10) : 0;
    const amountSats = msat > 0 ? Math.floor(msat / 1000) : 0;
    const recipientTag = zr.tags?.find((t) => t[0] === "p")?.[1] || "";
    const senderPub = zr.pubkey || "";
    const content = (zr.content || "") as string;
    const isRepoZap = /^Zap for .+\/.+/i.test(content.trim());
    const ctx = content.match(/^Zap for (.+)/i)?.[1]?.trim();
    return {
      id: ev.id,
      recipient: recipientTag,
      sender: senderPub || undefined,
      amount: amountSats,
      comment: content,
      createdAt: ev.created_at * 1000,
      type: isRepoZap ? "repo" : "user",
      contextId: isRepoZap ? ctx : undefined,
      status: "paid",
      source: "nip57",
    };
  } catch {
    return null;
  }
}

/** URL entity/repo pairs to match `Zap for entity/repo` in NIP-57 receipt content */
export function repoContextVariantsForMatch(
  entity: string,
  repo: string
): string[] {
  const out = new Set<string>();
  const add = (e: string, r: string) => out.add(`${e}/${r}`.toLowerCase());
  try {
    add(entity, repo);
    add(decodeURIComponent(entity), decodeURIComponent(repo));
    add(decodeURIComponent(entity), repo);
    add(entity, decodeURIComponent(repo));
  } catch {
    add(entity, repo);
  }
  return Array.from(out);
}

export function repoZapReceiptMatchesRepo(
  receiptContext: string | undefined,
  entity: string,
  repo: string
): boolean {
  if (!receiptContext?.trim()) return false;
  const c = receiptContext.trim().toLowerCase();
  return repoContextVariantsForMatch(entity, repo).includes(c);
}

/**
 * Repo header badge: sum NIP-57 receipts for this repo + local ledger rows that are not
 * already represented by a receipt (same amount, time window, sender when known).
 */
export function computeRepoZapBadgeTotal(
  ownerHex: string,
  entity: string,
  repo: string,
  nip57Events: Event[]
): { totalSats: number; networkSats: number; localExtraSats: number } {
  if (!ownerHex) {
    return { totalSats: 0, networkSats: 0, localExtraSats: 0 };
  }

  const recs = nip57Events
    .map((ev) => zapReceipt9735ToRecord(ev))
    .filter(
      (r): r is ZapRecord =>
        r != null &&
        r.type === "repo" &&
        repoZapReceiptMatchesRepo(r.contextId, entity, repo) &&
        normalizePubkey(r.recipient) === ownerHex
    );
  const networkSats = recs.reduce((s, r) => s + r.amount, 0);

  let localPaid: ZapRecord[] = [];
  try {
    const zaps = JSON.parse(
      localStorage.getItem("gittr_zaps") || "[]"
    ) as ZapRecord[];
    const ownerNorm = ownerHex;
    const ctxSet = new Set(repoContextVariantsForMatch(entity, repo));
    localPaid = zaps.filter(
      (z) =>
        z.status === "paid" &&
        z.type === "repo" &&
        normalizePubkey(z.recipient) === ownerNorm &&
        z.contextId &&
        ctxSet.has(z.contextId.trim().toLowerCase())
    );
  } catch {
    localPaid = [];
  }

  let localExtraSats = 0;
  for (const L of localPaid) {
    const dup = recs.some((R) => {
      if (R.amount !== L.amount) return false;
      if (Math.abs(R.createdAt - L.createdAt) > 25 * 60 * 1000) return false;
      if (L.sender && R.sender) {
        return normalizePubkey(L.sender) === normalizePubkey(R.sender);
      }
      if (!L.sender && !R.sender) return true;
      return false;
    });
    if (!dup) localExtraSats += L.amount;
  }

  return {
    totalSats: networkSats + localExtraSats,
    networkSats,
    localExtraSats,
  };
}
