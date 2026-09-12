import { nip19 } from "nostr-tools";

import { ownerProfileHref } from "../utils/entity-resolver";

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

/**
 * Profile path for a Pages card author. Only when we have hex or npub —
 * a display name alone must not become `/{name}`.
 */
export function cardAuthorProfileHref(row: {
  authorDisplay?: string;
  authorPubkeyHex?: string;
}): string | null {
  const hex = authorPubkeyHexNormalized(row.authorPubkeyHex);
  if (hex) {
    return ownerProfileHref(hex);
  }
  const d = (row.authorDisplay || "").trim();
  if (/^npub1[a-z0-9]+$/i.test(d) || /^[0-9a-f]{64}$/i.test(d)) {
    return ownerProfileHref(d);
  }
  return null;
}

export function authorPubkeyHexNormalized(
  hex: string | undefined
): string | null {
  const h = String(hex || "")
    .toLowerCase()
    .replace(/^0x/, "")
    .trim();
  return /^[0-9a-f]{64}$/.test(h) ? h : null;
}

/** Hostname shown like Apps' package id. */
export function siteHostname(siteUrl: string): string {
  try {
    return new URL(siteUrl).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function siteKindLabel(
  kind: GatewayStatusSiteRow["siteKind"]
): string | null {
  if (kind === "named") return "Named";
  if (kind === "root") return "Npub site";
  return null;
}

export function formatPagesStatCount(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "0";
  if (n < 1000) return String(Math.trunc(n));
  const k = n / 1000;
  const s = k >= 10 ? k.toFixed(0) : k.toFixed(1);
  return `${s.replace(/\.0$/, "")}k`;
}
