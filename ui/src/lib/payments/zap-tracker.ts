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

/** Millisats from embedded zap request (kind 9734) tags. */
export function amountMsatFromZapRequestTags(
  tags: string[][] | undefined
): number {
  if (!Array.isArray(tags)) return 0;
  for (const t of tags) {
    if (!Array.isArray(t) || t.length < 2) continue;
    if (String(t[0]).toLowerCase() !== "amount") continue;
    const v = String(t[1]).trim();
    const n = parseInt(v, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

/**
 * Satoshis from a BOLT11 invoice human-readable prefix (BOLT #11).
 * Supports lnbc / lntb / lnbcrt. Returns 0 for "any amount" invoices (no numeric HRP).
 */
export function satoshisFromBolt11Invoice(bolt11: string | undefined): number {
  if (!bolt11 || typeof bolt11 !== "string") return 0;
  const lower = bolt11.trim().toLowerCase();
  const m = lower.match(/^(lnbc|lntb|lnbcrt)(?:(\d+)([munp]?))?1/);
  if (!m || !m[2]) return 0;
  const num = parseInt(m[2], 10);
  if (!Number.isFinite(num) || num <= 0) return 0;
  const mult = m[3] || "";
  const e =
    mult === "m"
      ? -3
      : mult === "u"
      ? -6
      : mult === "n"
      ? -9
      : mult === "p"
      ? -12
      : 0;
  return Math.round(num * Math.pow(10, 8 + e));
}

function parseEmbeddedZapRequestJson(
  desc: string
): { tags: string[][]; content: string; pubkey: string } | null {
  let raw: unknown;
  try {
    raw = JSON.parse(desc);
  } catch {
    return null;
  }
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const tags = Array.isArray(o.tags) ? (o.tags as string[][]) : [];
  const content = typeof o.content === "string" ? o.content : "";
  const pubkey = typeof o.pubkey === "string" ? o.pubkey : "";
  return { tags, content, pubkey };
}

/** Map NIP-57 zap receipt (kind 9735) to a ZapRecord for the Your Zaps UI */
export function zapReceipt9735ToRecord(ev: Event): ZapRecord | null {
  if (ev.kind !== 9735) return null;
  const desc = ev.tags.find((t) => t[0] === "description")?.[1];
  if (!desc) return null;
  const bolt11 = ev.tags.find((t) => t[0] === "bolt11")?.[1];
  const outerRecipient = ev.tags.find((t) => t[0] === "p")?.[1]?.trim() || "";
  const outerZapper = ev.tags.find((t) => t[0] === "P")?.[1]?.trim() || "";

  try {
    const zr = parseEmbeddedZapRequestJson(desc);
    if (!zr) return null;

    const msat = amountMsatFromZapRequestTags(zr.tags);
    let amountSats = msat > 0 ? Math.floor(msat / 1000) : 0;
    if (amountSats <= 0 && bolt11) {
      amountSats = satoshisFromBolt11Invoice(bolt11);
    }

    const innerRecipient =
      zr.tags?.find((t) => t[0] === "p")?.[1]?.trim() || "";
    const recipientTag = innerRecipient || outerRecipient;

    const senderPub = (zr.pubkey || outerZapper || "").trim();
    const content = zr.content || "";
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

  /** Pending rows only count toward the badge for a short window (invoice flows often stay pending until relay receipt or manual confirm). */
  const PENDING_BADGE_MAX_AGE_MS = 72 * 60 * 60 * 1000;

  let localLedgerRows: ZapRecord[] = [];
  try {
    const zaps = JSON.parse(
      localStorage.getItem("gittr_zaps") || "[]"
    ) as ZapRecord[];
    const ownerNorm = ownerHex;
    const ctxSet = new Set(repoContextVariantsForMatch(entity, repo));
    const now = Date.now();
    localLedgerRows = zaps.filter((z) => {
      const pendingFresh =
        z.status === "pending" && z.createdAt > now - PENDING_BADGE_MAX_AGE_MS;
      if (!(z.status === "paid" || pendingFresh)) return false;
      return (
        z.type === "repo" &&
        normalizePubkey(z.recipient) === ownerNorm &&
        !!z.contextId &&
        ctxSet.has(z.contextId.trim().toLowerCase())
      );
    });
  } catch {
    localLedgerRows = [];
  }

  let localExtraSats = 0;
  for (const L of localLedgerRows) {
    const dup = recs.some((R) => {
      if (Math.abs(R.amount - L.amount) > 1) return false;
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
