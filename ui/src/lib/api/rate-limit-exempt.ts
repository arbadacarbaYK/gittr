import type { NextApiRequest } from "next";
import { nip19 } from "nostr-tools";

function parsePubkeyAllowlist(raw: string | undefined): Set<string> {
  const out = new Set<string>();
  if (!raw?.trim()) return out;
  for (const part of raw.split(/[\s,;]+/)) {
    const token = part.trim();
    if (!token) continue;
    if (/^[0-9a-f]{64}$/i.test(token)) {
      out.add(token.toLowerCase());
      continue;
    }
    if (token.startsWith("npub")) {
      try {
        const decoded = nip19.decode(token);
        if (decoded.type === "npub" && typeof decoded.data === "string") {
          out.add(decoded.data.toLowerCase());
        }
      } catch {
        /* ignore invalid npub */
      }
    }
  }
  return out;
}

function parseIpAllowlist(raw: string | undefined): Set<string> {
  const out = new Set<string>();
  if (!raw?.trim()) return out;
  for (const part of raw.split(/[\s,;]+/)) {
    const ip = part.trim();
    if (ip) out.add(ip);
  }
  return out;
}

let pubkeyAllowlist: Set<string> | null = null;
let ipAllowlist: Set<string> | null = null;

function getPubkeyAllowlist(): Set<string> {
  if (!pubkeyAllowlist) {
    pubkeyAllowlist = parsePubkeyAllowlist(
      process.env.RATE_LIMIT_EXEMPT_PUBKEYS ||
        process.env.GITTR_RATE_LIMIT_EXEMPT_PUBKEYS
    );
  }
  return pubkeyAllowlist;
}

function getIpAllowlist(): Set<string> {
  if (!ipAllowlist) {
    ipAllowlist = parseIpAllowlist(
      process.env.RATE_LIMIT_EXEMPT_IPS ||
        process.env.GITTR_RATE_LIMIT_EXEMPT_IPS
    );
  }
  return ipAllowlist;
}

export function isRateLimitExemptPubkey(pubkey: string | undefined): boolean {
  if (!pubkey || !/^[0-9a-f]{64}$/i.test(pubkey)) return false;
  return getPubkeyAllowlist().has(pubkey.toLowerCase());
}

export function isRateLimitExemptIp(req: NextApiRequest): boolean {
  const allow = getIpAllowlist();
  if (allow.size === 0) return false;

  const headers = req.headers;
  const forwarded = headers["x-forwarded-for"];
  const realIp = headers["x-real-ip"];
  const candidates: string[] = [];
  if (typeof forwarded === "string") {
    candidates.push(...forwarded.split(",").map((s) => s.trim()));
  } else if (Array.isArray(forwarded)) {
    candidates.push(...forwarded.map((s) => String(s).trim()));
  }
  if (typeof realIp === "string") candidates.push(realIp.trim());

  return candidates.some((ip) => ip && allow.has(ip));
}

export function isRateLimitExemptRequest(
  req: NextApiRequest,
  pubkey?: string
): boolean {
  return (
    isRateLimitExemptIp(req) ||
    (pubkey ? isRateLimitExemptPubkey(pubkey) : false)
  );
}
