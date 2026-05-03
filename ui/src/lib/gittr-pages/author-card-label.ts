import { nip19 } from "nostr-tools";

import type { GatewayStatusSiteRow } from "./parse-gateway-status-html";

function fullNpubForTooltip(row: {
  authorDisplay: string;
  authorPubkeyHex?: string;
}): string {
  const hex = row.authorPubkeyHex?.toLowerCase().replace(/^0x/, "");
  if (hex && /^[0-9a-f]{64}$/.test(hex)) {
    try {
      return nip19.npubEncode(hex);
    } catch {
      /* ignore */
    }
  }
  const d = row.authorDisplay.trim();
  if (/^npub1[a-z0-9]+$/i.test(d)) {
    return d;
  }
  if (/^[0-9a-f]{64}$/i.test(d)) {
    try {
      return nip19.npubEncode(d.toLowerCase());
    } catch {
      return d;
    }
  }
  return d;
}

/**
 * Short label for the card (human name when present; shortened npub when the gateway only had npub).
 */
export function cardAuthorPrimary(row: GatewayStatusSiteRow): string {
  const d = (row.authorDisplay || "").trim();
  if (!d) {
    return "";
  }
  if (/^npub1[a-z0-9]{20,}$/i.test(d)) {
    return `${d.slice(0, 12)}…${d.slice(-8)}`;
  }
  if (/^[0-9a-f]{64}$/i.test(d)) {
    try {
      const npub = nip19.npubEncode(d.toLowerCase());
      return `${npub.slice(0, 12)}…${npub.slice(-8)}`;
    } catch {
      return `${d.slice(0, 8)}…${d.slice(-6)}`;
    }
  }
  return d;
}

/**
 * Prefer full npub in tooltip when we can derive it; otherwise the display string.
 */
export function cardAuthorTooltip(row: GatewayStatusSiteRow): string {
  const npub = fullNpubForTooltip(row);
  const display = (row.authorDisplay || "").trim();
  if (!npub && !display) {
    return "";
  }
  if (npub && display && npub !== display) {
    return `${display} — ${npub}`;
  }
  return npub || display;
}

/** Extra strings so search matches pasted npub when the card shows a shortened label. */
export function authorSearchTokens(row: GatewayStatusSiteRow): string {
  const parts: string[] = [row.authorDisplay];
  const hex = row.authorPubkeyHex?.toLowerCase().replace(/^0x/, "");
  if (hex && /^[0-9a-f]{64}$/.test(hex)) {
    try {
      parts.push(nip19.npubEncode(hex));
    } catch {
      parts.push(hex);
    }
  }
  return parts.filter(Boolean).join(" ");
}
