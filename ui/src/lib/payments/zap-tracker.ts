// Zap tracking and history utilities
// Tracks zaps sent and received, displays counts
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
  } catch {}
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
    return zaps
      .filter(
        (z) =>
          z.recipient === recipient &&
          z.status === "paid" &&
          (!contextId || z.contextId === contextId) &&
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
  limit: number = 50
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
