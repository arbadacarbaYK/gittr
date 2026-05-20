/**
 * Operator-controlled list of publisher pubkeys to exclude from public listings
 * (explore, home, repositories sync, apps, sitemaps).
 *
 * gittr Pages directory: the nsite gateway also supports upstream **CURATION_USER**
 * (NIP-51 mute list) on manifests.json when set in gateway `.env`. Keep this blocklist
 * for gittr.space surfaces that do not use the gateway, and for pubkeys you want hidden
 * platform-wide even if not on the curator list.
 *
 * Configure with NEXT_PUBLIC_PUBLISHER_BLOCKLIST and/or PUBLISHER_BLOCKLIST
 * (comma, space, or semicolon separated 64-hex pubkeys and/or npub1… bech32).
 */
import type { GatewayStatusSiteRow } from "@/lib/gittr-pages/parse-gateway-status-html";
import { getRepoOwnerPubkey } from "@/lib/utils/entity-resolver";

import { nip19 } from "nostr-tools";

let cached: ReadonlySet<string> | null = null;

function parseBlocklistRaw(raw: string | undefined): Set<string> {
  const out = new Set<string>();
  if (!raw?.trim()) return out;
  for (const part of raw
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean)) {
    if (/^[0-9a-f]{64}$/i.test(part)) {
      out.add(part.toLowerCase());
      continue;
    }
    const lower = part.toLowerCase();
    if (lower.startsWith("npub1")) {
      try {
        const decoded = nip19.decode(part);
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

function loadMergedBlocklist(): ReadonlySet<string> {
  const pub = parseBlocklistRaw(process.env.NEXT_PUBLIC_PUBLISHER_BLOCKLIST);
  const serverOnly = parseBlocklistRaw(process.env.PUBLISHER_BLOCKLIST);
  return new Set([...pub, ...serverOnly]);
}

export function getPublisherBlocklist(): ReadonlySet<string> {
  if (!cached) {
    cached = loadMergedBlocklist();
  }
  return cached;
}

/** Test hook */
export function resetPublisherBlocklistCacheForTests(): void {
  cached = null;
}

export function isPublisherBlocklisted(
  pubkey: string | null | undefined
): boolean {
  if (!pubkey || !/^[0-9a-f]{64}$/i.test(pubkey)) return false;
  return getPublisherBlocklist().has(pubkey.toLowerCase());
}

export function isRepoFromBlocklistedOwner(repo: any): boolean {
  const pk = getRepoOwnerPubkey(repo, repo?.entity);
  return pk ? isPublisherBlocklisted(pk) : false;
}

/**
 * gittr Pages URLs often use the first DNS label as the owner's npub
 * (e.g. npub1….pages.gittr.space). Use that when manifest rows omit authorPubkeyHex.
 */
function pubkeyHexFromPagesSiteHostname(siteUrl: string): string | null {
  try {
    const host = new URL(siteUrl).hostname;
    const first = host.split(".")[0]?.trim() ?? "";
    if (!first.toLowerCase().startsWith("npub1")) return null;
    const decoded = nip19.decode(first);
    if (decoded.type === "npub" && typeof decoded.data === "string") {
      return decoded.data.toLowerCase();
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function filterGatewaySitesByPublisherBlocklist(
  sites: GatewayStatusSiteRow[]
): GatewayStatusSiteRow[] {
  if (sites.length === 0 || getPublisherBlocklist().size === 0) return sites;
  return sites.filter((s) => {
    let pk: string | undefined =
      s.authorPubkeyHex && /^[0-9a-f]{64}$/i.test(s.authorPubkeyHex)
        ? s.authorPubkeyHex.toLowerCase()
        : undefined;
    if (!pk) {
      const fromHost = pubkeyHexFromPagesSiteHostname(s.siteUrl);
      if (fromHost) pk = fromHost;
    }
    if (!pk) return true;
    return !isPublisherBlocklisted(pk);
  });
}

/**
 * Lines like `npub1…/repo-id` (e.g. from nostr-pushed-repos.txt) — omit if the
 * npub decodes to a blocklisted pubkey.
 */
export function filterRepoPathLinesByPublisherBlocklist(
  lines: string[]
): string[] {
  if (lines.length === 0 || getPublisherBlocklist().size === 0) return lines;
  return lines.filter((line) => {
    const slash = line.indexOf("/");
    if (slash <= 0) return true;
    const prefix = line.slice(0, slash).trim();
    if (!prefix.toLowerCase().startsWith("npub1")) return true;
    try {
      const decoded = nip19.decode(prefix);
      if (decoded.type === "npub" && typeof decoded.data === "string") {
        return !isPublisherBlocklisted(decoded.data);
      }
    } catch {
      /* keep malformed */
    }
    return true;
  });
}
