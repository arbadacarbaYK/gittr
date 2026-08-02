/**
 * Web of Trust (WoT) helpers — extension, oracle API, and display labels.
 * @see https://nostr-wot.com/docs
 */
import { nip19 } from "nostr-tools";

export const KIND_CONTACT_LIST = 3;

export const DEFAULT_WOT_ORACLE_URL = "https://wot-oracle.mappingbitcoin.com";

export const DEFAULT_WOT_MAX_HOPS = 4;

export type WoTDistanceSource =
  | "extension"
  | "oracle"
  | "follows"
  | "self"
  /** Follow list miss and oracle/extension unavailable — not a confirmed Outside. */
  | "unavailable";

export type WoTDistanceResult = {
  /** null = no path (Outside) OR unknown when source is "unavailable" */
  hops: number | null;
  mutual?: boolean;
  source: WoTDistanceSource;
};

export type WoTOracleDistanceResponse = {
  from?: string;
  to?: string;
  /** Oracle v1 field name */
  hops?: number | null;
  /** Some docs use `distance` instead of `hops` */
  distance?: number | null;
  path_count?: number;
  paths?: number;
  mutual_follow?: boolean;
  mutual?: boolean;
};

const CACHE_TTL_MS = 5 * 60 * 1000;
const distanceCache = new Map<
  string,
  { value: WoTDistanceResult | null; expires: number }
>();

function cacheKey(fromHex: string, toHex: string): string {
  return `${fromHex.toLowerCase()}:${toHex.toLowerCase()}`;
}

/** Drop oracle cache entries (all, or for one viewer) after a follow change. */
export function clearWoTDistanceCache(viewerHex?: string | null): void {
  const viewer = normalizeHexPubkey(viewerHex);
  if (!viewer) {
    distanceCache.clear();
    return;
  }
  const prefix = `${viewer}:`;
  for (const key of Array.from(distanceCache.keys())) {
    if (key.startsWith(prefix)) distanceCache.delete(key);
  }
}

export function normalizeHexPubkey(
  pubkey: string | null | undefined
): string | null {
  if (!pubkey || typeof pubkey !== "string") return null;
  const trimmed = pubkey.trim();
  if (/^[0-9a-f]{64}$/i.test(trimmed)) return trimmed.toLowerCase();
  if (trimmed.startsWith("npub")) {
    try {
      const decoded = nip19.decode(trimmed);
      if (decoded.type === "npub" && typeof decoded.data === "string") {
        return decoded.data.toLowerCase();
      }
    } catch {
      return null;
    }
  }
  return null;
}

export function hopsFromOracleBody(
  body: WoTOracleDistanceResponse
): number | null {
  const raw =
    body.hops !== undefined && body.hops !== null
      ? body.hops
      : body.distance !== undefined && body.distance !== null
      ? body.distance
      : null;
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  if (raw < 0) return null;
  return Math.floor(raw);
}

export function wotLabel(
  hops: number | null,
  opts?: { loggedOut?: boolean }
): string {
  if (opts?.loggedOut) return "—";
  if (hops === null) return "Outside your network";
  if (hops === 0) return "";
  if (hops === 1) return "In your network";
  return `${hops} hops from you`;
}

/** Label for a full WoT result (preferred over hops-only). */
export function wotResultLabel(
  result: WoTDistanceResult | null | undefined
): string {
  if (!result) return "Outside your network";
  if (result.source === "unavailable") return "Distance unknown";
  if (result.hops === null) return "Outside your network";
  if (result.hops === 0) return "";
  if (result.hops === 1) return "In your network";
  return `${result.hops} hops from you`;
}

export function wotResultTitle(
  result: WoTDistanceResult | null | undefined
): string {
  if (!result || result.source === "unavailable") {
    return "Web of Trust distance unknown — trust oracle unreachable and this pubkey is not in your follow list. People you follow still show as In your network.";
  }
  const label = wotResultLabel(result);
  return result.mutual ? `${label} (mutual follow)` : `${label} · Web of Trust`;
}

/** Shown on your own profile — how people who follow you see you. */
export function wotSelfPreviewLabel(): string {
  return "Followers see: In their network";
}

export function wotSelfPreviewTitle(): string {
  return "People who follow you see your profile one hop away (In their network). Others see distance from their own follow graph.";
}

export function wotBadgeClassName(
  hops: number | null,
  opts?: { unavailable?: boolean }
): string {
  if (opts?.unavailable) {
    return "border-gray-600/70 text-gray-400 bg-gray-900/30";
  }
  if (hops === null) return "border-gray-600/80 text-gray-400 bg-gray-900/40";
  if (hops === 1) return "border-green-600/60 text-green-300 bg-green-950/50";
  if (hops === 2) return "border-cyan-600/50 text-cyan-300 bg-cyan-950/40";
  if (hops === 3) return "border-amber-600/50 text-amber-300 bg-amber-950/40";
  return "border-orange-600/50 text-orange-300 bg-orange-950/40";
}

export function parseContactListPubkeys(tags: string[][]): Set<string> {
  const out = new Set<string>();
  for (const tag of tags) {
    if (tag[0] !== "p" || !tag[1]) continue;
    const hex = normalizeHexPubkey(tag[1]);
    if (hex) out.add(hex);
  }
  return out;
}

export async function fetchWoTDistanceFromExtension(
  viewerHex: string,
  targetHex: string
): Promise<WoTDistanceResult | null> {
  if (typeof window === "undefined") return null;
  const wot = window.nostr?.wot;
  if (!wot?.getDistance) return null;

  if (viewerHex === targetHex) {
    return { hops: 0, source: "self" };
  }

  let targetArg = targetHex;
  try {
    targetArg = nip19.npubEncode(targetHex);
  } catch {
    /* use hex */
  }

  try {
    const hops = await wot.getDistance(targetArg);
    if (hops === null || hops === undefined) return null;
    if (typeof hops !== "number" || !Number.isFinite(hops)) return null;
    const rounded = Math.floor(hops);
    if (rounded < 0) return null;
    return {
      hops: rounded,
      source: rounded === 0 ? "self" : "extension",
    };
  } catch {
    return null;
  }
}

export async function fetchWoTDistanceFromOracle(
  viewerHex: string,
  targetHex: string,
  maxHops: number = DEFAULT_WOT_MAX_HOPS
): Promise<WoTDistanceResult | null> {
  if (viewerHex === targetHex) {
    return { hops: 0, source: "self" };
  }

  const key = cacheKey(viewerHex, targetHex);
  const cached = distanceCache.get(key);
  if (cached && cached.expires > Date.now()) {
    return cached.value;
  }

  const params = new URLSearchParams({
    from: viewerHex,
    to: targetHex,
    max_hops: String(maxHops),
  });

  try {
    const res = await fetch(`/api/wot/distance?${params.toString()}`);
    if (!res.ok) {
      // Do not cache as Outside — oracle 502 ≠ "no path".
      const unavailable: WoTDistanceResult = {
        hops: null,
        source: "unavailable",
      };
      distanceCache.set(key, {
        value: unavailable,
        expires: Date.now() + 60_000,
      });
      return unavailable;
    }
    const body = (await res.json()) as WoTOracleDistanceResponse;
    const hops = hopsFromOracleBody(body);
    if (hops === null) {
      // Oracle answered: no path within max_hops → confirmed Outside.
      const outside: WoTDistanceResult = { hops: null, source: "oracle" };
      distanceCache.set(key, {
        value: outside,
        expires: Date.now() + CACHE_TTL_MS,
      });
      return outside;
    }
    const result: WoTDistanceResult = {
      hops,
      mutual: Boolean(body.mutual_follow ?? body.mutual),
      source: "oracle",
    };
    distanceCache.set(key, {
      value: result,
      expires: Date.now() + CACHE_TTL_MS,
    });
    return result;
  } catch {
    const unavailable: WoTDistanceResult = {
      hops: null,
      source: "unavailable",
    };
    distanceCache.set(key, {
      value: unavailable,
      expires: Date.now() + 60_000,
    });
    return unavailable;
  }
}

export function distanceFromFollowSet(
  viewerHex: string,
  targetHex: string,
  follows: Set<string> | null | undefined
): WoTDistanceResult | null {
  if (!follows) return null;
  if (viewerHex === targetHex) return { hops: 0, source: "self" };
  if (follows.has(targetHex.toLowerCase())) {
    return { hops: 1, source: "follows" };
  }
  return null;
}

export async function resolveWoTDistance(opts: {
  viewerHex: string | null;
  targetHex: string | null;
  follows?: Set<string> | null;
  maxHops?: number;
}): Promise<WoTDistanceResult | null> {
  const viewer = normalizeHexPubkey(opts.viewerHex);
  const target = normalizeHexPubkey(opts.targetHex);
  if (!viewer || !target) return null;
  if (viewer === target) return { hops: 0, source: "self" };

  // Direct follow is authoritative for "In your network" — check before
  // extension/oracle graphs that can miss people you actually follow.
  const fromFollows = distanceFromFollowSet(viewer, target, opts.follows);
  if (fromFollows) return fromFollows;

  const fromExtension = await fetchWoTDistanceFromExtension(viewer, target);
  if (fromExtension && fromExtension.hops != null && fromExtension.hops > 0) {
    return fromExtension;
  }

  const fromOracle = await fetchWoTDistanceFromOracle(
    viewer,
    target,
    opts.maxHops ?? DEFAULT_WOT_MAX_HOPS
  );
  if (fromOracle) {
    // Oracle confirmed Outside, hops, or unavailable — all are results.
    return fromOracle;
  }

  if (fromExtension) return fromExtension;

  // No follow, no extension, no oracle answer → treat as unknown, not Outside.
  return { hops: null, source: "unavailable" };
}
