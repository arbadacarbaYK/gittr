import {
  SimplePool,
  type UnsignedEvent,
  generatePrivateKey,
  getEventHash,
  getPublicKey,
  nip04,
  nip19,
  signEvent,
} from "nostr-tools";
import type { Event as NostrEvent } from "nostr-tools";
import { nip44 as nip44v2 } from "nostr-tools-v2";

import { isGraspServer } from "../utils/grasp-servers";

import {
  isBunkerMainPoolBlocked,
  setBunkerMainPoolBlockedHosts,
} from "./bunker-main-pool-guard";
import { WEB_STORAGE_KEYS } from "./localStorage";

type PublishFn = (event: any, relays: string[]) => void;
type SubscribeFn = (
  filters: any[],
  relays: string[],
  onEvent: (event: any, isAfterEose: boolean, relayURL?: string) => void,
  maxDelayms?: number,
  onEose?: (relayUrl: string, minCreatedAt: number) => void,
  options?: any
) => () => void;
type RelayMutator = (url: string) => void;

/** Bunker URI: host is the remote signer (Amber) pubkey. */
export type ParsedBunkerUri = {
  mode: "bunker";
  remotePubkey: string;
  relays: string[];
  secret?: string;
  permissions?: string[];
  label?: string;
};

/**
 * nostrconnect URI: host is this app's client pubkey (not the signer).
 * The signer pubkey is learned from the first inbound kind 24133 during pairing.
 */
export type ParsedNostrConnectUri = {
  mode: "nostrconnect";
  clientPubkey: string;
  relays: string[];
  /** Pairing secret for the connect() RPC (and, for gittr Show QR, the client's hex private key). */
  secret?: string;
  permissions?: string[];
  label?: string;
};

export type ParsedRemoteSignerUri = ParsedBunkerUri | ParsedNostrConnectUri;

export interface RemoteSignerSession {
  /** Remote signer (Amber) pubkey — empty only briefly during nostrconnect discovery. */
  remotePubkey: string;
  /**
   * Bunker transport dial list. May historically include expansion; prefer
   * `uriRelays` for Amber-facing publish/subscribe.
   */
  relays: string[];
  /**
   * Relays from the bunker/nostrconnect URI (and optionally Amber-reported
   * signer relays). Authoritative for publish+subscribe preference — never
   * overwritten by dial expansion defaults.
   */
  uriRelays?: string[];
  clientSecretKey: string;
  clientPubkey: string;
  userPubkey: string;
  secret?: string;
  permissions?: string[];
  label?: string;
  lastConnected: number;
  /** True while waiting for the first inbound event to learn the signer pubkey. */
  nostrConnectPairing?: boolean;
}

export type RemoteSignerState = "idle" | "connecting" | "ready" | "error";

interface RemoteSignerDeps {
  publish: PublishFn;
  subscribe: SubscribeFn;
  addRelay?: RelayMutator;
  removeRelay?: RelayMutator;
  getRelayStatuses?: () => [string, number][];
}

interface PendingRequest {
  method: string;
  resolve: (value: any) => void;
  reject: (reason?: any) => void;
  timeout: ReturnType<typeof setTimeout>;
}

const STORAGE_KEY = WEB_STORAGE_KEYS.REMOTE_SIGNER_SESSION;
const REQUEST_TIMEOUT_MS = 15000;
const SIGN_EVENT_TIMEOUT_MS = 120000;
const CONNECT_TIMEOUT_MS = 25000;
/** While waiting for Amber, re-sub if bunker sockets drop. */
const SIGN_LISTEN_REFRESH_MS = 18000;
/** If no inbound 24133 after publish, republish the same request once. */
const SIGN_REPUBLISH_IF_SILENT_MS = 35000;
const CONNECT_RETRY_DELAYS_MS = [0, 1200, 2500];
const HEX_64_RE = /^[0-9a-f]{64}$/i;
export const DEFAULT_REMOTE_PERMISSIONS = [
  "get_public_key",
  "sign_event",
  "sign_event:30617",
  "sign_event:30618",
  "sign_event:10317",
  "sign_event:5",
  "nip04_encrypt",
  "nip04_decrypt",
  "nip44_encrypt",
  "nip44_decrypt",
];

/**
 * Extra NIP-46 relays when the bunker URI list is thin.
 * Damus last-resort only — browsers often fail wss://relay.damus.io under Cloudflare.
 * Do not put nos.lol/Damus ahead of AmberSettings defaults (oxtr / theforest / primal).
 */
const NIP46_PAIRING_RELAY_FALLBACKS = ["wss://relay.damus.io"];

/**
 * Amber bunker default relays (AmberSettings order): oxtr, theforest, primal.
 * nos.lol is optional after those. Must overlap QR pairing when user has no prior session.
 * Never include gittr Pyramid / GRASP hosts here.
 */
const NIP46_SIGNER_DEFAULT_RELAYS = [
  "wss://nostr.oxtr.dev",
  "wss://theforest.nostr1.com",
  "wss://relay.primal.net",
  "wss://nos.lol",
];

const normalizeRelayUrl = (url: string) =>
  url.trim().toLowerCase().replace(/\/+$/, "");

/**
 * Match nostr-tools SimplePool `_conn` keys. Their normalizeURL uses URL.href,
 * which keeps a trailing `/` (e.g. `wss://relay.damus.io/`). Our display
 * normalize strips it — lookups must accept both.
 */
function poolNormalizeUrl(url: string): string {
  try {
    const p = new URL(url.trim());
    p.pathname = p.pathname.replace(/\/+/g, "/");
    if (p.pathname.endsWith("/")) {
      p.pathname = p.pathname.slice(0, -1);
    }
    if (
      (p.port === "80" && p.protocol === "ws:") ||
      (p.port === "443" && p.protocol === "wss:")
    ) {
      p.port = "";
    }
    p.searchParams.sort();
    p.hash = "";
    return p.href;
  } catch {
    return normalizeRelayUrl(url);
  }
}

function relayUrlsMatch(a: string, b: string): boolean {
  return (
    normalizeRelayUrl(a) === normalizeRelayUrl(b) ||
    poolNormalizeUrl(a) === poolNormalizeUrl(b)
  );
}

/**
 * Per-relay OPEN budget. Opens run in parallel. Proceed as soon as one
 * bunker socket is OPEN so Push is not blocked waiting for all URI hosts.
 */
const BUNKER_RELAY_OPEN_BUDGET_MS = 15000;
/** First OPEN socket is enough to unblock Push; keepalive fills the rest. */
const BUNKER_PROCEED_WHEN_OPEN = 1;
/** Publish/subscribe on every OPEN URI relay, not a 1–2 host subset. */
export const BUNKER_PUBLISH_MAX_RELAYS = 8;
/** Do not treat a single Amber URI socket as "enough" when the bunker lists more. */
export const BUNKER_MIN_PREFERRED_OPEN = 3;
/** Quiet re-warm so Push/Save is not the first cold dial after hydrate. */
const BUNKER_KEEPALIVE_MS = 45000;
/**
 * Relays embedded in nostrconnect QR — must NOT include GRASP/git relays (they reject kind 24133).
 * Use signer-friendly WSS relays that overlap Amber's bunker defaults.
 */
export function getNip46PairingRelays(appRelays: string[], max = 5): string[] {
  const merged: string[] = [];
  const add = (url: string) => {
    const normalized = normalizeRelayUrl(url);
    if (
      normalized.startsWith("wss://") &&
      !merged.includes(normalized) &&
      !isGraspServer(normalized)
    ) {
      merged.push(normalized);
    }
  };
  NIP46_SIGNER_DEFAULT_RELAYS.forEach(add);
  NIP46_PAIRING_RELAY_FALLBACKS.forEach(add);
  appRelays.filter((r) => !isGraspServer(r)).forEach(add);
  return merged.slice(0, max);
}

/**
 * Merge URI/session bunker relays with Amber-friendly defaults for dialing.
 * Does not mutate the session — expansion is ephemeral connectivity only.
 * GRASP/gittr Pyramid hosts are excluded (they reject kind 24133).
 */
export function expandBunkerRelays(relays: string[]): string[] {
  const merged: string[] = [];
  const add = (url: string) => {
    const normalized = normalizeRelayUrl(url);
    if (
      normalized.startsWith("wss://") &&
      !merged.includes(normalized) &&
      !isGraspServer(normalized)
    ) {
      merged.push(normalized);
    }
  };
  (relays || []).forEach(add);
  NIP46_SIGNER_DEFAULT_RELAYS.forEach(add);
  NIP46_PAIRING_RELAY_FALLBACKS.forEach(add);
  return merged.slice(0, 8);
}

function looksLikeSignedNostrEvent(result: unknown): boolean {
  if (!result || typeof result !== "object") return false;
  const ev = result as { id?: unknown; sig?: unknown; pubkey?: unknown };
  return (
    typeof ev.id === "string" &&
    HEX_64_RE.test(ev.id) &&
    typeof ev.pubkey === "string" &&
    HEX_64_RE.test(ev.pubkey) &&
    typeof ev.sig === "string" &&
    /^[0-9a-f]{128}$/i.test(ev.sig)
  );
}

function uniqueNormalizedRelays(urls: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of urls || []) {
    const n = normalizeRelayUrl(raw);
    if (!n.startsWith("wss://") || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

function relayUrlSet(urls: string[]): Set<string> {
  return new Set(
    (urls || [])
      .map(normalizeRelayUrl)
      .filter((u) => u.startsWith("wss://") && !isGraspServer(u))
  );
}

/**
 * Best-effort recovery when older sessions persisted expandBunkerRelays into
 * `relays` without a separate `uriRelays` field. Shortest prefix whose expansion
 * covers the stored list is treated as the original URI list.
 */
export function recoverUriRelaysFromPossiblyExpanded(
  relays: string[]
): string[] {
  const normalized = (relays || [])
    .map(normalizeRelayUrl)
    .filter((u) => u.startsWith("wss://") && !isGraspServer(u));
  if (normalized.length === 0) return [];
  const storedSet = new Set(normalized);
  for (let len = 1; len <= normalized.length; len++) {
    const prefix = normalized.slice(0, len);
    const expanded = expandBunkerRelays(prefix);
    const expandedSet = new Set(expanded);
    if (
      storedSet.size === expandedSet.size &&
      [...storedSet].every((u) => expandedSet.has(u))
    ) {
      return prefix;
    }
  }
  return normalized;
}

/** Authoritative Amber-facing relays for a session (URI first, never expansion). */
export function getSessionUriRelays(session: {
  uriRelays?: string[];
  relays?: string[];
}): string[] {
  if (session.uriRelays && session.uriRelays.length > 0) {
    return session.uriRelays
      .map(normalizeRelayUrl)
      .filter((u) => u.startsWith("wss://") && !isGraspServer(u));
  }
  return recoverUriRelaysFromPossiblyExpanded(session.relays || []);
}

/**
 * Prefer OPEN sockets that intersect Amber URI (or signer-reported) relays.
 * Only fall back to other open expanded relays when zero preferred relays are open.
 */
export function preferUriOpenRelays(
  openRelays: string[],
  preferredRelays: string[],
  max = BUNKER_PUBLISH_MAX_RELAYS
): string[] {
  if (!openRelays.length) return [];
  const preferred = relayUrlSet(preferredRelays);
  if (preferred.size === 0) {
    return openRelays.slice(0, max).map(normalizeRelayUrl);
  }
  const preferredOpen = openRelays
    .map(normalizeRelayUrl)
    .filter((u) => preferred.has(u));
  if (preferredOpen.length > 0) {
    return [...new Set(preferredOpen)].slice(0, max);
  }
  return [...new Set(openRelays.map(normalizeRelayUrl))].slice(0, max);
}

export function bunkerRelayPublishOverlap(
  publishedUrls: string[],
  uriRelays: string[]
): {
  overlap: string[];
  publishedOnly: string[];
  uriOnly: string[];
  hasOverlap: boolean;
} {
  const published = relayUrlSet(publishedUrls);
  const uri = relayUrlSet(uriRelays);
  const overlap = [...published].filter((u) => uri.has(u));
  const publishedOnly = [...published].filter((u) => !uri.has(u));
  const uriOnly = [...uri].filter((u) => !published.has(u));
  return {
    overlap,
    publishedOnly,
    uriOnly,
    hasOverlap: overlap.length > 0,
  };
}

/** True when we published to Amber's list but left most of her relays unused. */
export function bunkerPublishIsThin(
  publishedUrls: string[],
  uriRelays: string[]
): boolean {
  const o = bunkerRelayPublishOverlap(publishedUrls, uriRelays);
  const want = Math.min(BUNKER_MIN_PREFERRED_OPEN, relayUrlSet(uriRelays).size);
  return o.uriOnly.length > 0 && o.overlap.length < Math.max(want, 1);
}

export const DEFAULT_REMOTE_SIGNER_LABEL = "gittr.space";

/**
 * Amber bunker still decrypts NIP-04 RPC. NIP-44-only `sign_event` can land
 * on Amber's relays (publish OK) and never pop a prompt. Prefer NIP-04 for
 * every Amber-waking RPC; keep NIP-44 primary for connect / get_public_key
 * (pairing already works).
 */
export function nip46PrimaryEncryption(method: string): "nip04" | "nip44" {
  if (
    method === "sign_event" ||
    method === "nip04_encrypt" ||
    method === "nip04_decrypt" ||
    method === "nip44_encrypt" ||
    method === "nip44_decrypt"
  ) {
    return "nip04";
  }
  return "nip44";
}

/** Dual-publish the other encryption so older Amber and newer bunkers both see it. */
export function nip46ShouldDualPublish(method: string): boolean {
  return (
    method === "connect" ||
    method === "get_public_key" ||
    method === "sign_event" ||
    method === "nip04_encrypt" ||
    method === "nip04_decrypt" ||
    method === "nip44_encrypt" ||
    method === "nip44_decrypt"
  );
}

/**
 * NIP-46 `connect` params — the ONE canonical layout every real signer parses:
 * `[remote-signer-pubkey, optional_secret, optional_requested_perms, optional_client_metadata]`.
 *
 * Verified against source of:
 * - Amber/quartz `BunkerRequestConnect.parse`: params[0]=remoteKey, params[1]=secret,
 *   params[2]=perms, params[3]=metadata (secret/perms back-filled with "" when metadata present)
 * - bunker46 `bunker-rpc.handler.ts`: secret = params[1], perms = params[2]
 * - nostr-tools `nip46.ts` BunkerSigner: sends [remoteSignerPubkey, secret]
 *
 * Any other layout makes Amber read a non-secret string as the secret → "invalid secret".
 */
function buildConnectParams(session: RemoteSignerSession): string[] {
  const perms =
    session.permissions && session.permissions.length > 0
      ? session.permissions.join(",")
      : DEFAULT_REMOTE_PERMISSIONS.join(",");

  const metadata = JSON.stringify({
    name: session.label || DEFAULT_REMOTE_SIGNER_LABEL,
    url:
      typeof window !== "undefined"
        ? window.location.origin
        : "https://gittr.space",
  });

  // Metadata must sit at index 3, so secret/perms slots are back-filled with ""
  // exactly like quartz's buildParams does.
  return [session.remotePubkey, session.secret || "", perms, metadata];
}

function toSignEventTemplate(event: UnsignedEvent): string {
  return JSON.stringify({
    kind: event.kind,
    content: event.content,
    tags: event.tags,
    created_at: event.created_at,
  });
}
const extractHexPubkey = (value: unknown): string | undefined => {
  if (typeof value === "string" && HEX_64_RE.test(value)) {
    return value.toLowerCase();
  }
  if (
    value &&
    typeof value === "object" &&
    typeof (value as any).pubkey === "string" &&
    HEX_64_RE.test((value as any).pubkey)
  ) {
    return ((value as any).pubkey as string).toLowerCase();
  }
  return undefined;
};

const randomRequestId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);

const bytesToHex = (bytes: Uint8Array) =>
  Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

type NostrConnectClientKeyEntry = {
  clientPubkey: string;
  clientSecretKey: string;
  createdAt: number;
};

const NOSTRCONNECT_KEY_TTL_MS = 30 * 60 * 1000;

const loadNostrConnectClientKeyMap = (): Record<
  string,
  NostrConnectClientKeyEntry
> => {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(WEB_STORAGE_KEYS.NOSTRCONNECT_CLIENT_KEYS);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as Record<string, NostrConnectClientKeyEntry>;
  } catch {
    return {};
  }
};

const persistNostrConnectClientKeyMap = (
  map: Record<string, NostrConnectClientKeyEntry>
) => {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      WEB_STORAGE_KEYS.NOSTRCONNECT_CLIENT_KEYS,
      JSON.stringify(map)
    );
  } catch {
    // Ignore storage errors (quota/private mode).
  }
};

export function rememberNostrConnectClientKey(
  clientPubkey: string,
  clientSecretKey: string
) {
  if (!HEX_64_RE.test(clientPubkey) || !HEX_64_RE.test(clientSecretKey)) return;
  const normalizedPubkey = clientPubkey.toLowerCase();
  const normalizedSecret = clientSecretKey.toLowerCase();
  const map = loadNostrConnectClientKeyMap();
  const now = Date.now();
  for (const [pubkey, entry] of Object.entries(map)) {
    if (
      !entry ||
      typeof entry.createdAt !== "number" ||
      now - entry.createdAt > NOSTRCONNECT_KEY_TTL_MS
    ) {
      delete map[pubkey];
    }
  }
  map[normalizedPubkey] = {
    clientPubkey: normalizedPubkey,
    clientSecretKey: normalizedSecret,
    createdAt: now,
  };
  persistNostrConnectClientKeyMap(map);
}

type BunkerClientKeyEntry = {
  remotePubkey: string;
  bunkerSecret: string;
  clientSecretKey: string;
  clientPubkey: string;
  createdAt: number;
};

const bunkerClientStorageKey = (
  remotePubkey: string,
  secret?: string
): string => `${remotePubkey.toLowerCase()}:${(secret || "").toLowerCase()}`;

const loadBunkerClientKeyMap = (): Record<string, BunkerClientKeyEntry> => {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(WEB_STORAGE_KEYS.BUNKER_CLIENT_KEYS);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as Record<string, BunkerClientKeyEntry>;
  } catch {
    return {};
  }
};

const persistBunkerClientKeyMap = (
  map: Record<string, BunkerClientKeyEntry>
) => {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      WEB_STORAGE_KEYS.BUNKER_CLIENT_KEYS,
      JSON.stringify(map)
    );
  } catch {
    // Ignore storage errors (quota/private mode).
  }
};

export function rememberBunkerClientKey(
  remotePubkey: string,
  secret: string | undefined,
  clientSecretKey: string
) {
  if (!HEX_64_RE.test(remotePubkey) || !HEX_64_RE.test(clientSecretKey)) return;
  const map = loadBunkerClientKeyMap();
  const key = bunkerClientStorageKey(remotePubkey, secret);
  const clientPubkey = getPublicKey(clientSecretKey).toLowerCase();
  map[key] = {
    remotePubkey: remotePubkey.toLowerCase(),
    bunkerSecret: (secret || "").toLowerCase(),
    clientSecretKey: clientSecretKey.toLowerCase(),
    clientPubkey,
    createdAt: Date.now(),
  };
  persistBunkerClientKeyMap(map);
}

function getStoredBunkerClientKey(
  remotePubkey: string,
  secret?: string
): { clientSecretKey: string; clientPubkey: string } | undefined {
  if (!HEX_64_RE.test(remotePubkey)) return undefined;
  const map = loadBunkerClientKeyMap();
  const entry = map[bunkerClientStorageKey(remotePubkey, secret)];
  if (
    !entry ||
    !HEX_64_RE.test(entry.clientSecretKey || "") ||
    !HEX_64_RE.test(entry.clientPubkey || "")
  ) {
    return undefined;
  }
  return {
    clientSecretKey: entry.clientSecretKey.toLowerCase(),
    clientPubkey: entry.clientPubkey.toLowerCase(),
  };
}

function getStoredNostrConnectClientKey(
  clientPubkey: string
): string | undefined {
  if (!HEX_64_RE.test(clientPubkey)) return undefined;
  const normalizedPubkey = clientPubkey.toLowerCase();
  const map = loadNostrConnectClientKeyMap();
  const entry = map[normalizedPubkey];
  if (!entry) return undefined;
  if (
    typeof entry.createdAt !== "number" ||
    Date.now() - entry.createdAt > NOSTRCONNECT_KEY_TTL_MS ||
    !HEX_64_RE.test(entry.clientSecretKey || "")
  ) {
    delete map[normalizedPubkey];
    persistNostrConnectClientKeyMap(map);
    return undefined;
  }
  return entry.clientSecretKey.toLowerCase();
}

const hexToBytes = (hex: string): Uint8Array => {
  const clean = hex.trim().toLowerCase();
  if (!/^[0-9a-f]+$/i.test(clean) || clean.length % 2 !== 0) {
    throw new Error("Invalid hex string");
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
};

function encryptNip44ForRemoteSigner(
  clientSecretKey: string,
  remotePubkey: string,
  plaintext: string
): string {
  const conversationKey = nip44v2.getConversationKey(
    hexToBytes(clientSecretKey),
    remotePubkey
  );
  return nip44v2.encrypt(plaintext, conversationKey);
}

async function encryptNip46RpcPayload(
  method: string,
  clientSecretKey: string,
  remotePubkey: string,
  plaintext: string
): Promise<{
  primary: string;
  primaryScheme: "nip04" | "nip44";
  dual: string | null;
  dualScheme: "nip04" | "nip44" | null;
}> {
  const primaryScheme = nip46PrimaryEncryption(method);
  let nip44Cipher: string | null = null;
  let nip04Cipher: string | null = null;
  try {
    nip44Cipher = encryptNip44ForRemoteSigner(
      clientSecretKey,
      remotePubkey,
      plaintext
    );
  } catch (error) {
    console.warn("[RemoteSigner] nip44 encrypt failed:", error);
  }
  try {
    nip04Cipher = await nip04.encrypt(clientSecretKey, remotePubkey, plaintext);
  } catch (error) {
    console.warn("[RemoteSigner] nip04 encrypt failed:", error);
  }
  const primary =
    primaryScheme === "nip04"
      ? nip04Cipher || nip44Cipher
      : nip44Cipher || nip04Cipher;
  if (!primary) {
    throw new Error("Could not encrypt the remote-signer request");
  }
  const usedPrimary: "nip04" | "nip44" =
    primary === nip04Cipher && primaryScheme === "nip04"
      ? "nip04"
      : primary === nip44Cipher
      ? "nip44"
      : "nip04";
  if (!nip46ShouldDualPublish(method)) {
    return {
      primary,
      primaryScheme: usedPrimary,
      dual: null,
      dualScheme: null,
    };
  }
  const dual =
    usedPrimary === "nip04"
      ? nip44Cipher && nip44Cipher !== primary
        ? nip44Cipher
        : null
      : nip04Cipher && nip04Cipher !== primary
      ? nip04Cipher
      : null;
  return {
    primary,
    primaryScheme: usedPrimary,
    dual,
    dualScheme: dual ? (usedPrimary === "nip04" ? "nip44" : "nip04") : null,
  };
}

async function decryptFromRemoteSigner(
  clientSecretKey: string,
  remotePubkey: string,
  ciphertext: string
): Promise<string> {
  try {
    const conversationKey = nip44v2.getConversationKey(
      hexToBytes(clientSecretKey),
      remotePubkey
    );
    return nip44v2.decrypt(ciphertext, conversationKey);
  } catch (nip44Err) {
    try {
      return await nip04.decrypt(clientSecretKey, remotePubkey, ciphertext);
    } catch (nip04Err) {
      throw new Error(
        `Decrypt failed (nip44: ${
          nip44Err instanceof Error ? nip44Err.message : String(nip44Err)
        }; nip04: ${
          nip04Err instanceof Error ? nip04Err.message : String(nip04Err)
        })`
      );
    }
  }
}

/**
 * Parse bunker:// or nostrconnect:// tokens
 */
export function parseRemoteSignerUri(input: string): ParsedRemoteSignerUri {
  if (!input || typeof input !== "string") {
    throw new Error("Remote signer token required");
  }
  const trimmed = input.trim();
  if (trimmed.startsWith("bunker://")) {
    const withoutScheme = trimmed.replace(/^bunker:\/\//i, "");
    const [pubkeyPart, query = ""] = withoutScheme.split("?");
    if (!pubkeyPart || pubkeyPart.length !== 64) {
      throw new Error("Invalid bunker token: missing remote signer pubkey");
    }
    const params = new URLSearchParams(query);
    const relays = params
      .getAll("relay")
      .map((relay) => relay.trim())
      .filter(Boolean);
    if (relays.length === 0) {
      throw new Error("Remote signer token missing relay query param");
    }
    const secret = params.get("secret")?.trim() || undefined;
    const permissions = params
      .get("perms")
      ?.split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    const label = params.get("name") || params.get("label") || undefined;
    return {
      mode: "bunker",
      remotePubkey: pubkeyPart.toLowerCase(),
      relays,
      secret,
      permissions,
      label,
    };
  }

  if (trimmed.startsWith("nostrconnect://")) {
    // nostrconnect://<client-pubkey>?relay=wss://...&secret=...&name=...&perms=sign_event:1,nip44_encrypt
    const withoutScheme = trimmed.replace(/^nostrconnect:\/\//i, "");
    const [clientPubkey, query = ""] = withoutScheme.split("?");
    if (!clientPubkey || clientPubkey.length !== 64) {
      throw new Error("Invalid nostrconnect URI: missing client pubkey");
    }
    const params = new URLSearchParams(query);
    const relays = params
      .getAll("relay")
      .map((relay) => relay.trim())
      .filter(Boolean);
    if (relays.length === 0) {
      throw new Error("nostrconnect URI missing relay");
    }
    const secret = params.get("secret") || undefined;
    const permissions = params
      .get("perms")
      ?.split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    const label = params.get("name") || undefined;
    return {
      mode: "nostrconnect",
      clientPubkey: clientPubkey.toLowerCase(),
      relays,
      secret,
      permissions,
      label,
    };
  }

  throw new Error(
    "Unsupported remote signer URI. Use bunker:// or nostrconnect://"
  );
}

export function loadStoredRemoteSignerSession(): RemoteSignerSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RemoteSignerSession;
    if (!parsed.remotePubkey || !parsed.clientSecretKey || !parsed.userPubkey) {
      return null;
    }
    // One-shot migration: old nostrconnect sessions embedded client private key in `secret`.
    if (
      typeof parsed.secret === "string" &&
      HEX_64_RE.test(parsed.secret) &&
      parsed.secret.toLowerCase() === parsed.clientSecretKey.toLowerCase()
    ) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    // Prefer Amber URI relays for publish/sub. Recover when older sessions
    // persisted expandBunkerRelays() into `relays` without uriRelays.
    if (!parsed.uriRelays || parsed.uriRelays.length === 0) {
      parsed.uriRelays = recoverUriRelaysFromPossiblyExpanded(
        parsed.relays || []
      );
    } else {
      parsed.uriRelays = parsed.uriRelays
        .map(normalizeRelayUrl)
        .filter((u) => u.startsWith("wss://") && !isGraspServer(u));
    }
    // Keep `relays` aligned with URI authority — dial expansion stays ephemeral.
    if (parsed.uriRelays.length > 0) {
      parsed.relays = [...parsed.uriRelays];
    }
    return parsed;
  } catch (error) {
    console.warn("[RemoteSigner] Failed to load stored session:", error);
    return null;
  }
}

export function persistRemoteSignerSession(
  session: RemoteSignerSession | null
) {
  if (typeof window === "undefined") return;
  try {
    if (!session) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    }
  } catch (error) {
    console.error("[RemoteSigner] Failed to persist session:", error);
  }
}

/**
 * Handles pairing with a remote signer (NIP-46) and exposes a NIP-07 compatible adapter.
 */
export class RemoteSignerManager {
  private deps: RemoteSignerDeps;
  private session: RemoteSignerSession | null = null;
  private state: RemoteSignerState = "idle";
  private pending = new Map<string, PendingRequest>();
  private unsubscribe?: () => void;
  private directPool = new SimplePool();
  private directUnsubscribe?: () => void;
  private pairingPubkeyHint?: string;
  /** Resolves after first inbound NIP-46 event during nostrconnect pairing. */
  private nostrConnectSignerResolved?: () => void;
  private originalNostr: typeof window.nostr | undefined;
  private adapter: any;
  onStateChange?: (
    state: RemoteSignerState,
    session: RemoteSignerSession | null,
    error?: string
  ) => void;
  private lastError?: string;
  private bootstrapInFlight: Promise<void> | null = null;
  /** True only after a successful NIP-46 RPC round-trip in this page lifetime. */
  private rpcHealthy = false;
  private healthProbeInFlight: Promise<void> | null = null;
  private bunkerWarmInFlight: Promise<void> | null = null;
  private bunkerKeepaliveTimer: ReturnType<typeof setInterval> | null = null;
  /** Shared dial so background warm and Push cannot resetDirectPool mid-flight. */
  private bunkerDialInFlight: Promise<string[]> | null = null;
  /** Last direct-pool publish targets — used for sign_event timeout diagnostics. */
  private lastPublishMeta?: {
    method: string;
    urls: string[];
    acked: boolean;
    uriRelays: string[];
  };
  /** NIP-04 + NIP-44 envelopes for the in-flight sign_event (silent republish). */
  private lastSignEventEnvelopes: any[] = [];
  /** Inbound kind 24133 while a sign_event is waiting (listen-path diagnostics). */
  private inboundDuringWait = 0;
  /** Dual-publish can replay an already-answered JSON-RPC id onto the next sign. */
  private completedRpcIds: string[] = [];

  constructor(deps: RemoteSignerDeps) {
    this.deps = deps;
    if (typeof window !== "undefined") {
      this.originalNostr = window.nostr;
    }
  }

  getSession() {
    return this.session;
  }

  getState() {
    return this.state;
  }

  getUserPubkey() {
    return this.session?.userPubkey;
  }

  /** Cached bunker/nostrconnect session exists and last NIP-46 RPC succeeded. */
  isRpcHealthy() {
    return !!(
      this.session?.userPubkey &&
      this.rpcHealthy &&
      this.state === "ready"
    );
  }

  /** Relays from the paired bunker URI — NIP-46 transport only, not user relay prefs. */
  getTransportRelayUrls(): string[] {
    const session = this.session;
    if (!session) return [];
    return getSessionUriRelays(session);
  }

  /**
   * Single-flight bootstrap — safe to call from push/sign while page load is still pairing.
   * Page load only hydrates cached identity; live Amber connect waits for ensureRpcHealthy.
   */
  ensureBootstrapped(): Promise<void> {
    if (this.session?.userPubkey && this.adapter) {
      return Promise.resolve();
    }
    if (this.state === "ready" && this.session?.userPubkey && this.rpcHealthy) {
      return Promise.resolve();
    }
    if (this.bootstrapInFlight) {
      return this.bootstrapInFlight;
    }
    if (!loadStoredRemoteSignerSession()) {
      return Promise.resolve();
    }
    this.bootstrapInFlight = this.bootstrapFromStorage().finally(() => {
      this.bootstrapInFlight = null;
    });
    return this.bootstrapInFlight;
  }

  /**
   * Warm bunker transport before signing. Cached pubkey alone is not proof Amber
   * can answer — `sign_event` is the live probe.
   *
   * Do NOT block Star/Push on a silent NIP-46 `connect` ack: Amber often ignores
   * reconnect `connect` (no popup) while still answering `sign_event`. Waiting
   * the full connect timeout then aborting never wakes the phone.
   */
  async ensureRpcHealthy(timeoutMs = CONNECT_TIMEOUT_MS): Promise<void> {
    if (this.isRpcHealthy()) return;
    if (this.healthProbeInFlight) {
      await this.healthProbeInFlight;
      if (this.isRpcHealthy()) return;
    }
    const session = this.session || loadStoredRemoteSignerSession();
    if (!session?.userPubkey) {
      throw new Error("Remote signer not paired");
    }
    this.healthProbeInFlight = (async () => {
      if (!this.session) {
        await this.activateSession(session);
      } else {
        // Hydrate-only left session in memory without bunker sockets. Warm
        // directPool + 24133 subscription before any RPC (no page-load dial).
        // Join any in-flight background warm so we do not resetDirectPool under it.
        if (this.bunkerWarmInFlight) {
          try {
            await this.bunkerWarmInFlight;
          } catch {
            /* warm logs its own failure */
          }
        }
        await this.prepareTransportForSession(this.requireSession());
      }

      const live = this.requireSession();
      const cachedPubkey =
        typeof live.userPubkey === "string" && HEX_64_RE.test(live.userPubkey)
          ? live.userPubkey.toLowerCase()
          : "";
      const uriRelays = getSessionUriRelays(live);
      const dialTargets =
        uriRelays.length > 0
          ? expandBunkerRelays(uriRelays)
          : this.buildBunkerTransportTargets(live);
      const allOpen = await this.listDirectOpenRelays(dialTargets);
      const preferredOpen = preferUriOpenRelays(allOpen, uriRelays);

      // Known identity + open Amber URI bunker sockets → skip blocking reconnect.
      // Prefer URI/signer relays; do not treat fallback-only OPEN as enough to skip.
      // signEvent() will wake Amber; mark healthy only after a successful RPC.
      if (cachedPubkey && preferredOpen.length > 0) {
        console.log(
          "[RemoteSigner] Transport open with cached identity — skipping connect probe; sign_event will wake Amber",
          {
            open: preferredOpen.length,
            preferred: preferredOpen,
            uriRelays,
          }
        );
        this.notifyState("connecting");
        return;
      }

      this.notifyState("connecting");
      try {
        const status = await this.reestablishConnection(live);
        if (status === "acked") {
          this.rpcHealthy = true;
          this.notifyState("ready");
        } else {
          // Soft: transport may still deliver sign_event even without connect ack.
          this.rpcHealthy = false;
          this.notifyState("connecting");
        }
      } catch (err) {
        this.rpcHealthy = false;
        const msg = err instanceof Error ? err.message : String(err);
        this.notifyState(
          "error",
          "Could not reach your remote signer. Open Amber (or your bunker app), keep it online, then try again."
        );
        throw new Error(
          `Remote signer is not responding (${msg}). Open your signer app (e.g. Amber) on your phone, make sure it is online and connected to its bunker relays, then try again.`
        );
      }
    })().finally(() => {
      this.healthProbeInFlight = null;
    });
    await this.healthProbeInFlight;
  }

  /**
   * Attempt to rehydrate existing session from storage.
   */
  /**
   * Rehydrate cached bunker identity for read-only UI (logged-in pubkey, adapter).
   * Does NOT call Amber — live NIP-46 connect runs on first sign via ensureRpcHealthy.
   * Viewing public repos must never wait on the phone signer.
   */
  async bootstrapFromStorage() {
    const stored = loadStoredRemoteSignerSession();
    if (!stored) return;
    try {
      console.log(
        "[RemoteSigner] Restoring session from storage (hydrate only — no Amber connect)"
      );
      this.rpcHealthy = false;
      this.session = stored;
      persistRemoteSignerSession(stored);
      // Claim bunker hosts for directPool before discovery re-dials them.
      this.claimBunkerHostsForDirectPool(
        getSessionUriRelays(stored).length > 0
          ? getSessionUriRelays(stored)
          : stored.relays
      );
      // Apply NIP-07 adapter so getPublicKey works; skip bunker relay dial + connect RPC.
      if (
        typeof window !== "undefined" &&
        window.nostr &&
        !this.originalNostr
      ) {
        this.originalNostr = window.nostr;
      }
      this.applyNip07Adapter();
      // "idle" + adapter = logged in for browsing; signing will probe Amber.
      this.notifyState("idle");
      this.scheduleBackgroundBunkerWarm();
    } catch (error: any) {
      console.error("[RemoteSigner] Failed to resume session:", error);
      this.rpcHealthy = false;
      if (stored.userPubkey) {
        try {
          this.session = stored;
          persistRemoteSignerSession(stored);
          this.applyNip07Adapter();
          this.notifyState("idle");
          this.scheduleBackgroundBunkerWarm();
          return;
        } catch {
          // Fall through to clear.
        }
      }
      this.clearSession();
      this.notifyState(
        "error",
        error?.message || "Failed to resume remote signer session"
      );
    }
  }

  /**
   * Re-send NIP-46 connect with permissions (page reload / stale session).
   * Returns `acked` when the signer answered connect (or already connected),
   * `soft` when connect timed out but we still have a cached identity — caller
   * must NOT mark rpcHealthy until a later RPC (usually sign_event) succeeds.
   */
  private async reestablishConnection(
    session: RemoteSignerSession,
    forceReset = false
  ): Promise<"acked" | "soft"> {
    if (!session.clientPubkey || !session.remotePubkey) {
      console.warn(
        "[RemoteSigner] Skipping reconnect — incomplete session (missing client or remote pubkey)"
      );
      return "soft";
    }

    if (forceReset) {
      try {
        await this.sendRequest(session, "logout", [], 5000);
      } catch {
        // Signer may already have dropped the session.
      }
    }

    // Same client key + same secret → Amber answers "ack" silently (no popup),
    // because it recognizes the app by our client pubkey.
    const connectParams = buildConnectParams(session);

    let connectTimedOut = false;
    try {
      await this.sendRequest(
        session,
        "connect",
        connectParams,
        CONNECT_TIMEOUT_MS
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/already connected/i.test(msg)) {
        // OK — signer still considers this client paired
      } else if (/timed out|connect timed out/i.test(msg)) {
        connectTimedOut = true;
        console.warn(
          "[RemoteSigner] connect on reestablish timed out; will rely on sign_event if identity is cached"
        );
      } else {
        throw err;
      }
    }

    // Session already stores the logged-in identity from pairing. Amber treats
    // get_public_key as its own permission and often prompts "read public key"
    // on every reconnect — even though gittr already knows the owner pubkey.
    // Only probe when we truly lack a cached identity.
    //
    // IMPORTANT: connect timeout must NOT mark the session healthy. Soft-return
    // so the caller can still send sign_event (which wakes Amber). Hard-fail
    // only when we have no identity to sign as.
    const cachedUserPubkey =
      typeof session.userPubkey === "string" &&
      HEX_64_RE.test(session.userPubkey)
        ? session.userPubkey.toLowerCase()
        : "";
    if (connectTimedOut) {
      if (cachedUserPubkey) {
        return "soft";
      }
      throw new Error(
        "Remote signer connect timed out — Amber did not answer on its bunker relays. Keep Amber open/online and try again."
      );
    }
    if (cachedUserPubkey) {
      return "acked";
    }

    try {
      const remotePubkeyHex = await this.sendRequest(
        session,
        "get_public_key",
        [],
        CONNECT_TIMEOUT_MS
      );
      if (
        typeof remotePubkeyHex === "string" &&
        HEX_64_RE.test(remotePubkeyHex)
      ) {
        session.userPubkey = remotePubkeyHex.toLowerCase();
        this.session = session;
        persistRemoteSignerSession(session);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        /timed out/i.test(msg)
          ? "Remote signer get_public_key timed out — Amber did not answer. Keep Amber open/online and try again."
          : msg
      );
    }
    return "acked";
  }

  /**
   * IMPORTANT: gittr must NEVER push its own relay list at the signer.
   * Per Amber's source, `switch_relays` ignores the client's params and answers
   * with the SIGNER's relays — sending our list only desyncs both sides and
   * breaks sign_event. NIP-46 transport stays on the URI relays; gittr publishes
   * signed events to app relays itself.
   */

  /**
   * Pair using bunker/nostrconnect URI
   */
  async connect(uri: string) {
    const config = parseRemoteSignerUri(uri);
    const previousSession = loadStoredRemoteSignerSession();
    const sessionMatchesConfig =
      config.mode === "bunker"
        ? (s: RemoteSignerSession) => s.remotePubkey === config.remotePubkey
        : (s: RemoteSignerSession) => s.clientPubkey === config.clientPubkey;
    const previousUserPubkey =
      previousSession &&
      sessionMatchesConfig(previousSession) &&
      typeof previousSession.userPubkey === "string" &&
      HEX_64_RE.test(previousSession.userPubkey)
        ? previousSession.userPubkey.toLowerCase()
        : undefined;
    const existingSessionUserPubkey =
      this.session &&
      sessionMatchesConfig(this.session) &&
      typeof this.session.userPubkey === "string" &&
      HEX_64_RE.test(this.session.userPubkey)
        ? this.session.userPubkey.toLowerCase()
        : undefined;
    const knownUserPubkey = existingSessionUserPubkey || previousUserPubkey;
    const bunkerSignerPubkeyFallback =
      config.mode === "bunker" ? config.remotePubkey : undefined;
    this.notifyState("connecting");

    const session: RemoteSignerSession = {
      remotePubkey: config.mode === "bunker" ? config.remotePubkey : "",
      relays: config.relays.map(normalizeRelayUrl),
      uriRelays: config.relays
        .map(normalizeRelayUrl)
        .filter((u) => u.startsWith("wss://") && !isGraspServer(u)),
      clientSecretKey: "",
      clientPubkey: "",
      userPubkey: "",
      secret: config.secret,
      permissions: config.permissions,
      label: config.label || DEFAULT_REMOTE_SIGNER_LABEL,
      lastConnected: Date.now(),
      nostrConnectPairing: config.mode === "nostrconnect",
    };

    if (config.mode === "bunker") {
      const storedBunkerClient =
        getStoredBunkerClientKey(config.remotePubkey, config.secret) ||
        (previousSession &&
        sessionMatchesConfig(previousSession) &&
        HEX_64_RE.test(previousSession.clientSecretKey || "")
          ? {
              clientSecretKey: previousSession.clientSecretKey,
              clientPubkey: previousSession.clientPubkey,
            }
          : undefined);
      if (storedBunkerClient) {
        session.clientSecretKey = storedBunkerClient.clientSecretKey;
        session.clientPubkey = storedBunkerClient.clientPubkey;
      } else {
        session.clientSecretKey = generatePrivateKey();
        session.clientPubkey = getPublicKey(session.clientSecretKey);
      }
      rememberBunkerClientKey(
        config.remotePubkey,
        config.secret,
        session.clientSecretKey
      );
    } else {
      const storedClientSecret = getStoredNostrConnectClientKey(
        config.clientPubkey
      );
      if (!storedClientSecret) {
        throw new Error(
          "No local nostrconnect client key found for this token. Generate a fresh token via Show QR and pair again."
        );
      }
      session.clientSecretKey = storedClientSecret;
      session.clientPubkey = getPublicKey(session.clientSecretKey);
      if (session.clientPubkey !== config.clientPubkey) {
        throw new Error(
          "nostrconnect URI pubkey does not match the secret — use Copy Token or scan the QR again without editing."
        );
      }
    }

    try {
      this.pairingPubkeyHint = undefined;
      this.nostrConnectSignerResolved = undefined;
      // Make pairing responses routable in handleIncomingEvent during connect phase.
      this.session = session;
      // Pairing: open bunker relays on directPool only (not the app relaypool).
      const pairingRelays =
        session.uriRelays && session.uriRelays.length > 0
          ? session.uriRelays
          : session.relays;
      await this.waitForDirectPoolRelays(pairingRelays, 8000);
      const transportRelays = await this.listDirectOpenRelays(pairingRelays);
      if (transportRelays.length === 0) {
        throw new Error(
          "Could not connect to any bunker relay. Check network/relay availability and retry."
        );
      }
      let nostrConnectWait: Promise<void> | undefined;
      if (config.mode === "nostrconnect") {
        const waitMs = 90000;
        nostrConnectWait = new Promise<void>((resolve, reject) => {
          const t = setTimeout(() => {
            this.nostrConnectSignerResolved = undefined;
            reject(
              new Error(
                "Timed out waiting for the remote signer. In Amber, approve the connection after scanning the QR, then tap Pair & Login."
              )
            );
          }, waitMs);
          this.nostrConnectSignerResolved = () => {
            clearTimeout(t);
            this.nostrConnectSignerResolved = undefined;
            resolve();
          };
        });
      }
      await this.startSubscription(session, transportRelays);
      if (nostrConnectWait) {
        await nostrConnectWait;
      }

      // Single canonical connect layout (see buildConnectParams) — retries only
      // cover relay/transport flakiness, never alternate param orders.
      const connectParams = buildConnectParams(session);
      let connectErr: unknown;
      let connectAcked = false;
      let connectResponse: unknown;
      for (let i = 0; i < CONNECT_RETRY_DELAYS_MS.length; i++) {
        const delay = CONNECT_RETRY_DELAYS_MS[i] ?? 0;
        if (delay > 0) {
          await new Promise((r) => setTimeout(r, delay));
        }
        try {
          console.log("[RemoteSigner] Sending connect request", {
            attempt: i + 1,
            relayCount: session.relays.length,
            remotePubkey: `${session.remotePubkey.slice(0, 12)}…`,
            mode: config.mode,
            clientPubkey: `${session.clientPubkey.slice(0, 8)}…`,
          });
          connectResponse = await this.sendRequest(
            session,
            "connect",
            connectParams,
            CONNECT_TIMEOUT_MS
          );
          connectErr = undefined;
          connectAcked = true;
          break;
        } catch (err) {
          connectErr = err;
          const errMsg = err instanceof Error ? err.message : String(err);
          if (/already connected/i.test(errMsg)) {
            // Amber: this client key is already paired — session is live.
            connectErr = undefined;
            connectAcked = true;
            break;
          }
          if (config.mode === "bunker" && /invalid secret/i.test(errMsg)) {
            throw new Error(
              "The signer rejected this bunker secret. Create a fresh bunker connection in your signer app and paste the new token — each secret pairs once."
            );
          }
          console.warn(
            `[RemoteSigner] connect attempt ${i + 1} failed:`,
            errMsg
          );
        }
      }
      if (connectErr) {
        const msg =
          connectErr instanceof Error ? connectErr.message : String(connectErr);
        // Compatibility: some signers establish pairing but don't return connect result.
        // Continue with get_public_key probe instead of hard-failing on connect timeout.
        if (
          /connect timed out|request connect timed out|timed out/i.test(msg)
        ) {
          console.warn(
            "[RemoteSigner] connect timed out; continuing with get_public_key probe"
          );
        } else {
          throw connectErr;
        }
      }

      let remotePubkeyHex: unknown;
      let pubkeyErr: unknown;
      const pubkeyFromConnect = extractHexPubkey(connectResponse);
      for (let i = 0; i < CONNECT_RETRY_DELAYS_MS.length; i++) {
        const delay = CONNECT_RETRY_DELAYS_MS[i] ?? 0;
        if (delay > 0) {
          await new Promise((r) => setTimeout(r, delay));
        }
        try {
          remotePubkeyHex = await this.sendRequest(
            session,
            "get_public_key",
            [],
            CONNECT_TIMEOUT_MS
          );
          pubkeyErr = undefined;
          break;
        } catch (err) {
          pubkeyErr = err;
          console.warn(
            `[RemoteSigner] get_public_key attempt ${i + 1} failed:`,
            err instanceof Error ? err.message : err
          );
        }
      }
      if (pubkeyErr) {
        if (config.mode === "nostrconnect") {
          throw pubkeyErr;
        }
        const pubkeyErrMsg =
          pubkeyErr instanceof Error ? pubkeyErr.message : String(pubkeyErr);
        if (
          /no permission|timed out/i.test(pubkeyErrMsg) &&
          (pubkeyFromConnect ||
            this.pairingPubkeyHint ||
            knownUserPubkey ||
            bunkerSignerPubkeyFallback)
        ) {
          remotePubkeyHex =
            pubkeyFromConnect ||
            this.pairingPubkeyHint ||
            knownUserPubkey ||
            bunkerSignerPubkeyFallback;
        } else {
          throw pubkeyErr;
        }
      }
      if (!remotePubkeyHex || typeof remotePubkeyHex !== "string") {
        if (config.mode === "nostrconnect") {
          throw new Error(
            "Remote signer did not return get_public_key for nostrconnect session"
          );
        }
        if (
          pubkeyFromConnect ||
          this.pairingPubkeyHint ||
          knownUserPubkey ||
          bunkerSignerPubkeyFallback
        ) {
          remotePubkeyHex =
            pubkeyFromConnect ||
            this.pairingPubkeyHint ||
            knownUserPubkey ||
            bunkerSignerPubkeyFallback;
        } else {
          throw new Error("Remote signer did not return a pubkey");
        }
      }
      const resolvedUserPubkey = String(remotePubkeyHex).toLowerCase();
      session.userPubkey = resolvedUserPubkey;
      session.lastConnected = Date.now();

      await this.activateSession(session);
      this.notifyState("ready");

      return {
        session,
        npub: nip19.npubEncode(session.userPubkey),
      };
    } catch (error: any) {
      this.nostrConnectSignerResolved = undefined;
      console.error("[RemoteSigner] Pairing failed:", error);
      this.clearSession();
      this.notifyState(
        "error",
        error?.message || "Remote signer pairing failed"
      );
      throw error;
    }
  }

  /**
   * Disconnect and restore original NIP-07 provider (if any)
   */
  disconnect() {
    this.clearSession();
    this.notifyState("idle");
  }

  /**
   * Sign event through remote signer (NIP-46 sign_event).
   */
  async signEvent(event: UnsignedEvent): Promise<NostrEvent> {
    // Warm bunker transport first (do not block on silent connect ack).
    // sign_event itself is the live Amber probe — keep the phone unlocked.
    await this.ensureRpcHealthy();
    const session = this.requireSession();
    const payload = toSignEventTemplate(event);
    try {
      const signed = await this.signEventWithSession(session, payload);
      this.rpcHealthy = true;
      this.notifyState("ready");
      return signed;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/no permission/i.test(msg)) {
        console.warn(
          "[RemoteSigner] sign_event denied — logout + NIP-46 connect retry"
        );
        this.rpcHealthy = false;
        await this.reestablishConnection(session, true);
        const signed = await this.signEventWithSession(session, payload);
        this.rpcHealthy = true;
        this.notifyState("ready");
        return signed;
      }
      if (/timed out/i.test(msg)) {
        // A second silent 120s retry only hides the failure from the user.
        // Drop zombie OPEN sockets so the NEXT attempt re-dials Amber relays.
        const uriRelays = getSessionUriRelays(session);
        const published = this.lastPublishMeta?.urls || [];
        const overlap = bunkerRelayPublishOverlap(published, uriRelays);
        console.warn("[RemoteSigner] sign_event timed out", {
          publishedUrls: published,
          uriRelays,
          overlap: overlap.overlap,
          publishedOnly: overlap.publishedOnly,
          uriOnly: overlap.uriOnly,
          hasOverlap: overlap.hasOverlap,
          lastAcked: this.lastPublishMeta?.acked,
          inboundDuringWait: this.inboundDuringWait,
        });
        this.rpcHealthy = false;
        try {
          this.resetDirectPool();
        } catch {
          /* ignore */
        }
        void this.ensureDirectTransport(session).catch(() => undefined);
        if (
          uriRelays.length > 0 &&
          !overlap.hasOverlap &&
          published.length > 0
        ) {
          throw new Error(
            "The signing request reached a relay Amber is not watching. Open Amber, confirm it is online on its bunker relays (from the bunker link — not gittr’s forge relays), then try again."
          );
        }
        if (bunkerPublishIsThin(published, uriRelays)) {
          throw new Error(
            `The signing request only reached ${overlap.overlap.length} of ${uriRelays.length} Amber bunker relays. Keep Amber open and unlocked, then try Push again — gittr will retry on more of those relays.`
          );
        }
        throw new Error(
          "The remote signer did not respond to the signing request. Open your signer app (e.g. Amber) on your phone, make sure it is online and connected, then try again."
        );
      }
      throw err;
    }
  }

  private async signEventWithSession(
    session: RemoteSignerSession,
    payload: string
  ): Promise<NostrEvent> {
    const result = await this.sendRequest(
      session,
      "sign_event",
      [payload],
      SIGN_EVENT_TIMEOUT_MS
    );
    const parsed = typeof result === "string" ? JSON.parse(result) : result;
    return parsed as NostrEvent;
  }

  async nip04Encrypt(pubkey: string, plaintext: string) {
    const session = this.requireSession();
    return this.sendRequest(session, "nip04_encrypt", [pubkey, plaintext]);
  }

  async nip04Decrypt(pubkey: string, ciphertext: string) {
    const session = this.requireSession();
    return this.sendRequest(session, "nip04_decrypt", [pubkey, ciphertext]);
  }

  async nip44Encrypt(pubkey: string, plaintext: string) {
    const session = this.requireSession();
    return this.sendRequest(session, "nip44_encrypt", [pubkey, plaintext]);
  }

  async nip44Decrypt(pubkey: string, ciphertext: string) {
    const session = this.requireSession();
    return this.sendRequest(session, "nip44_decrypt", [pubkey, ciphertext]);
  }

  private requireSession(): RemoteSignerSession {
    if (!this.session) {
      throw new Error("Remote signer not paired");
    }
    return this.session;
  }

  private notifyState(state: RemoteSignerState, message?: string) {
    this.state = state;
    this.lastError = message;
    this.onStateChange?.(state, this.session, message);
  }

  private async activateSession(session: RemoteSignerSession) {
    if (!session.uriRelays || session.uriRelays.length === 0) {
      session.uriRelays = recoverUriRelaysFromPossiblyExpanded(
        session.relays || []
      );
    }
    if (session.uriRelays.length > 0) {
      session.relays = [...session.uriRelays];
    }
    this.session = session;
    persistRemoteSignerSession(session);
    // Warm NIP-46 directPool only — never add bunker hosts into the app relaypool.
    const open = await this.ensureBunkerSocketsOpen(session);
    const uriRelays = getSessionUriRelays(session);
    await this.startSubscription(session, open.length > 0 ? open : uriRelays);
    // This ensures we preserve NIP-07 extension even if it loads after constructor
    if (typeof window !== "undefined" && window.nostr) {
      // Only update if we don't already have an original (first time activating)
      // or if current window.nostr is not our adapter (NIP-07 extension loaded)
      if (!this.originalNostr || window.nostr !== this.adapter) {
        this.originalNostr = window.nostr;
      }
    }
    this.applyNip07Adapter();
    this.startBunkerKeepalive();
  }

  /**
   * Warm directPool + NIP-46 subscription without Amber RPC.
   * Used on first sign after hydrate-only bootstrap.
   */
  private async prepareTransportForSession(session: RemoteSignerSession) {
    const open = await this.ensureBunkerSocketsOpen(session);
    if (open.length === 0) {
      const statuses = await this.snapshotDirectRelayStatuses(
        this.buildBunkerTransportTargets(session)
      );
      console.error(
        "[RemoteSigner] Bunker relay statuses after warm-up:",
        JSON.stringify(statuses)
      );
      throw new Error(
        "Could not open any bunker relay to reach Amber. Keep Amber open/unlocked on your phone, check mobile data/Wi‑Fi, then try Push again."
      );
    }
    try {
      await this.startSubscription(session, open);
    } catch (error) {
      console.warn(
        "[RemoteSigner] Failed to start subscription during transport warm-up:",
        error
      );
    }
    if (typeof window !== "undefined" && window.nostr) {
      if (!this.originalNostr || window.nostr !== this.adapter) {
        this.originalNostr = window.nostr;
      }
    }
    this.applyNip07Adapter();
    this.startBunkerKeepalive();
  }

  /**
   * Claim Amber bunker hosts for directPool and drop colliding main-pool sockets.
   * Discovery can use the rest of the relay list; these hosts stay blocked while
   * the session is paired (see bunker-main-pool-guard).
   */
  private claimBunkerHostsForDirectPool(relays: string[]) {
    const hosts = expandBunkerRelays(relays);
    setBunkerMainPoolBlockedHosts(hosts);
    this.freeMainPoolBunkerCollisions(hosts);
  }

  private releaseBunkerHostsFromDirectPool() {
    setBunkerMainPoolBlockedHosts(null);
  }

  /**
   * Open at least one bunker WebSocket. Serializes warm + Push dials so they
   * cannot resetDirectPool under each other. Frees main-pool collisions before
   * the first dial (not only after failure).
   *
   * Expansion is ephemeral for dialing only — never persisted into uriRelays /
   * session.relays. Returned URLs prefer Amber URI relays when those are OPEN.
   */
  private async ensureBunkerSocketsOpen(
    session: RemoteSignerSession,
    opts?: { quiet?: boolean }
  ): Promise<string[]> {
    if (this.bunkerDialInFlight) {
      return this.bunkerDialInFlight;
    }

    const quiet = !!opts?.quiet;
    const softWarn = (...args: unknown[]) => {
      if (quiet) {
        if (typeof console.debug === "function") console.debug(...args);
      } else {
        console.warn(...args);
      }
    };

    this.bunkerDialInFlight = (async () => {
      const uriRelays = getSessionUriRelays(session);
      if (!session.uriRelays || session.uriRelays.length === 0) {
        session.uriRelays = uriRelays;
        if (uriRelays.length > 0) {
          session.relays = [...uriRelays];
        }
        this.session = session;
        persistRemoteSignerSession(session);
      }
      const expanded = expandBunkerRelays(
        uriRelays.length > 0 ? uriRelays : session.relays || []
      );
      if (expanded.length > uriRelays.length) {
        console.log(
          "[RemoteSigner] Expanding bunker relays for dial (ephemeral)",
          {
            uri: uriRelays.length,
            dial: expanded.length,
          }
        );
      }

      this.claimBunkerHostsForDirectPool(
        uriRelays.length > 0 ? uriRelays : expanded
      );
      await this.waitForMainPoolBunkerSlotsClear();

      const preferOpen = (open: string[]) =>
        preferUriOpenRelays(open, uriRelays);

      let open = preferOpen(
        await this.listDirectOpenRelays(
          this.buildBunkerTransportTargets(session)
        )
      );
      if (open.length > 0) return open;

      // NIP-46 must use directPool only. Do NOT addRelay bunker URLs into the
      // app relaypool — duplicate sockets to the same hosts starve Amber transport.
      open = await this.ensureDirectTransport(session, undefined, { quiet });
      if (open.length === 0) {
        const dialTargets = this.buildBunkerTransportTargets(session);
        const snap = await this.snapshotDirectRelayStatuses(dialTargets);
        const anyConnecting = Object.values(snap).some((s) => s === 0);
        if (anyConnecting) {
          softWarn(
            "[RemoteSigner] Bunker sockets still CONNECTING — waiting instead of resetDirectPool",
            snap
          );
          await new Promise((r) => setTimeout(r, 8000));
          open = preferOpen(await this.listDirectOpenRelays(dialTargets));
          if (open.length > 0) return open;
        } else {
          softWarn(
            "[RemoteSigner] No bunker relays open after warm-up; resetting direct pool and retrying"
          );
          this.freeMainPoolBunkerCollisions(expanded);
          await this.waitForMainPoolBunkerSlotsClear();
          this.resetDirectPool();
          open = await this.ensureDirectTransport(session, undefined, {
            quiet,
          });
        }
      }
      if (open.length === 0) {
        const forced = [
          ...NIP46_SIGNER_DEFAULT_RELAYS,
          ...NIP46_PAIRING_RELAY_FALLBACKS,
        ].filter((u) => u.startsWith("wss://") && !isGraspServer(u));
        const snap = await this.snapshotDirectRelayStatuses(
          this.buildBunkerTransportTargets(session)
        );
        const stillConnecting = Object.values(snap).some((s) => s === 0);
        if (stillConnecting) {
          softWarn(
            "[RemoteSigner] Defaults skipped — in-flight bunker sockets still CONNECTING",
            snap
          );
          await new Promise((r) => setTimeout(r, 8000));
          open = preferOpen(
            await this.listDirectOpenRelays(
              this.buildBunkerTransportTargets(session)
            )
          );
        } else {
          softWarn(
            "[RemoteSigner] Still no bunker sockets — dialing signer default relays (not persisted)",
            forced
          );
          // Do NOT overwrite uriRelays / session.relays with defaults.
          this.claimBunkerHostsForDirectPool([...uriRelays, ...forced]);
          await this.waitForMainPoolBunkerSlotsClear();
          this.resetDirectPool();
          // Pass forced list so this attempt actually dials defaults (not only URI).
          open = await this.ensureDirectTransport(session, forced, { quiet });
        }
      }
      if (open.length === 0 && uriRelays.length > 0) {
        softWarn(
          "[RemoteSigner] Parallel bunker dial failed — trying Amber URI relays serially",
          uriRelays
        );
        for (const url of uriRelays) {
          if (await this.openDirectRelay(url, BUNKER_RELAY_OPEN_BUDGET_MS)) {
            open = preferOpen([url]);
            break;
          }
        }
      }
      return open;
    })().finally(() => {
      this.bunkerDialInFlight = null;
    });

    return this.bunkerDialInFlight;
  }

  private clearSession() {
    this.rpcHealthy = false;
    this.healthProbeInFlight = null;
    this.bunkerWarmInFlight = null;
    this.bunkerDialInFlight = null;
    this.lastPublishMeta = undefined;
    this.lastSignEventEnvelopes = [];
    this.completedRpcIds = [];
    this.releaseBunkerHostsFromDirectPool();
    this.stopBunkerKeepalive();
    this.nostrConnectSignerResolved = undefined;
    this.session = null;
    persistRemoteSignerSession(null);
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.directUnsubscribe?.();
    this.directUnsubscribe = undefined;
    this.pending.forEach(({ reject, timeout }) => {
      clearTimeout(timeout);
      reject(new Error("Remote signer disconnected"));
    });
    this.pending.clear();
    if (typeof window !== "undefined") {
      if (this.originalNostr) {
        window.nostr = this.originalNostr;
      } else {
        delete (window as any).nostr;
      }
    }
  }

  private async ensureRelays(relays: string[]) {
    if (!relays || relays.length === 0) return;
    relays.forEach((relay) => {
      if (this.deps.addRelay) {
        this.deps.addRelay(relay);
      }
    });
  }

  private resolveTransportRelays(relays: string[]): string[] {
    if (!relays || relays.length === 0) return [];
    const open = this.getOpenRelays(relays);
    // NIP-46 uses directPool for transport; do not hard-fail when the app relaypool
    // has not finished opening URI relays (e.g. Amber bunker primal/oxtr defaults).
    return open.length > 0 ? open : relays;
  }

  private resetDirectPool() {
    try {
      const conn = (this.directPool as any)._conn;
      if (conn && typeof conn === "object") {
        Object.keys(conn).forEach((url) => {
          try {
            conn[url]?.close?.();
          } catch {
            /* ignore */
          }
        });
      }
    } catch {
      /* ignore */
    }
    this.directUnsubscribe?.();
    this.directUnsubscribe = undefined;
    this.directPool = new SimplePool();
  }

  /** Drop a stuck SimplePool relay so ensureRelay can create a fresh socket. */
  private dropDirectRelay(url: string) {
    try {
      this.directPool.close([url, poolNormalizeUrl(url)]);
    } catch {
      /* ignore */
    }
    try {
      const conn = (this.directPool as any)._conn;
      if (conn && typeof conn === "object") {
        Object.keys(conn).forEach((k) => {
          if (relayUrlsMatch(k, url)) delete conn[k];
        });
      }
    } catch {
      /* ignore */
    }
  }

  private getDirectRelayFromPool(url: string): any | null {
    try {
      const conn = (this.directPool as any)._conn;
      if (!conn || typeof conn !== "object") return null;
      const key = Object.keys(conn).find((k) => relayUrlsMatch(k, url));
      return key ? conn[key] : null;
    } catch {
      return null;
    }
  }

  private async waitForRelayStatusOpen(
    relay: { status?: number; connect?: () => Promise<void> },
    timeoutMs: number
  ): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (relay.status === 1) return true;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    return relay.status === 1;
  }

  private async snapshotDirectRelayStatuses(
    relays: string[]
  ): Promise<Record<string, number | "missing">> {
    const out: Record<string, number | "missing"> = {};
    for (const url of relays) {
      const relay = this.getDirectRelayFromPool(url);
      out[normalizeRelayUrl(url)] =
        typeof relay?.status === "number" ? relay.status : "missing";
    }
    return out;
  }

  /**
   * Open one bunker relay without thrashing CONNECTING sockets.
   * nostr-tools ensureRelay returns an in-flight relay immediately on repeat
   * calls — short Promise.race timeouts were closing those and Amber never saw us.
   *
   * Cached CLOSED entries are never treated as success (SimplePool returns them
   * from ensureRelay without reconnecting). On ensureRelay race timeout, if the
   * socket is still CONNECTING we keep waiting for remaining budget instead of
   * giving up immediately.
   */
  private async openDirectRelay(
    url: string,
    budgetMs = BUNKER_RELAY_OPEN_BUDGET_MS
  ): Promise<boolean> {
    const started = Date.now();
    const remaining = () => Math.max(0, budgetMs - (Date.now() - started));

    const waitOpen = async (relay: any): Promise<boolean> => {
      if (!relay) return false;
      if (relay.status === 1) return true;
      if (relay.status === 0) {
        const waitMs = remaining();
        if (waitMs <= 0) return false;
        return this.waitForRelayStatusOpen(relay, waitMs);
      }
      if (relay.status === 2 || relay.status === 3) {
        // CLOSED/CLOSING — must reconnect; never treat as success.
        try {
          const waitMs = remaining();
          if (waitMs <= 0) return false;
          await Promise.race([
            relay.connect(),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error("connect timeout")), waitMs)
            ),
          ]);
        } catch {
          /* fall through to status check */
        }
        if (relay.status === 1) return true;
        if (relay.status === 0) {
          const waitMs = remaining();
          if (waitMs <= 0) return false;
          return this.waitForRelayStatusOpen(relay, waitMs);
        }
      }
      return relay.status === 1;
    };

    try {
      let relay = this.getDirectRelayFromPool(url);
      if (relay) {
        if (await waitOpen(relay)) return true;
        if (relay.status === 0) {
          return this.waitForRelayStatusOpen(
            relay,
            Math.max(remaining(), 2000)
          );
        }
        // CLOSED/CLOSING cache entry — SimplePool returns it without reconnecting.
        this.dropDirectRelay(url);
        relay = null;
      }
      if (!relay) {
        // Do not spend the whole OPEN budget on Promise.race — if ensureRelay
        // is still CONNECTING after this, keep waiting the remainder.
        const firstWait = Math.min(8000, Math.max(remaining(), 800));
        try {
          relay = await Promise.race([
            this.directPool.ensureRelay(url),
            new Promise((_, reject) =>
              setTimeout(
                () => reject(new Error("ensureRelay timeout")),
                firstWait
              )
            ),
          ]);
          if (await waitOpen(relay)) return true;
        } catch (error) {
          // Race lost — ensureRelay may still be connecting in _conn. Wait it out.
          const inFlight = this.getDirectRelayFromPool(url);
          if (inFlight?.status === 0) {
            if (await this.waitForRelayStatusOpen(inFlight, remaining())) {
              return true;
            }
          } else if (inFlight && (await waitOpen(inFlight))) {
            return true;
          }
          console.warn(
            `[RemoteSigner] openDirectRelay first pass failed for ${url}:`,
            error instanceof Error ? error.message : error
          );
        }
      }
    } catch (error) {
      console.warn(
        `[RemoteSigner] openDirectRelay first pass failed for ${url}:`,
        error instanceof Error ? error.message : error
      );
    }

    // One clean retry — never drop a CONNECTING socket to start over.
    const leftover = this.getDirectRelayFromPool(url);
    if (leftover?.status === 1) return true;
    if (leftover?.status === 0) {
      return this.waitForRelayStatusOpen(leftover, Math.max(remaining(), 800));
    }
    if (remaining() < 1500) {
      return leftover?.status === 1;
    }
    try {
      this.dropDirectRelay(url);
      const retryBudget = remaining();
      const relay: any = await Promise.race([
        this.directPool.ensureRelay(url),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error("ensureRelay retry timeout")),
            retryBudget
          )
        ),
      ]);
      return await waitOpen(relay);
    } catch (error) {
      const inFlight = this.getDirectRelayFromPool(url);
      if (inFlight?.status === 0 && remaining() > 0) {
        if (await this.waitForRelayStatusOpen(inFlight, remaining())) {
          return true;
        }
      }
      console.warn(
        `[RemoteSigner] openDirectRelay retry failed for ${url}:`,
        error instanceof Error ? error.message : error
      );
      return false;
    }
  }

  /**
   * Ordered bunker dial targets: Amber URI relays first, then known-good defaults.
   * Expansion is for connectivity only — session.uriRelays stays authoritative.
   */
  private buildBunkerTransportTargets(session: RemoteSignerSession): string[] {
    const uriRelays = getSessionUriRelays(session);
    return expandBunkerRelays(
      uriRelays.length > 0 ? uriRelays : session.relays || []
    );
  }

  /**
   * Main-pool sockets to the same bunker hosts steal browser connection slots.
   * Drop them before a fresh directPool dial — discovery can re-add later.
   */
  private freeMainPoolBunkerCollisions(relays: string[]) {
    if (!this.deps.removeRelay) return;
    const targets = new Set(
      expandBunkerRelays(relays).map((r) => normalizeRelayUrl(r))
    );
    const statuses = this.deps.getRelayStatuses?.() || [];
    let freed = 0;
    for (const [url] of statuses) {
      if (!targets.has(normalizeRelayUrl(url))) continue;
      try {
        this.deps.removeRelay(url);
        freed += 1;
      } catch {
        /* ignore */
      }
    }
    if (freed > 0) {
      // Debug only — browser may still log "WebSocket closed before established"
      // when we abort CONNECTING main-pool dials; that is intentional, not a failure.
      if (typeof console.debug === "function") {
        console.debug(
          `[RemoteSigner] Freed ${freed} main-pool socket(s) colliding with bunker hosts`
        );
      }
    }
  }

  /** Wait until main-pool bunker sockets are gone (or CLOSED) before dialing. */
  private async waitForMainPoolBunkerSlotsClear(timeoutMs = 3000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const leftovers = (this.deps.getRelayStatuses?.() || []).filter(
        ([url, status]) => isBunkerMainPoolBlocked(url) && status !== 3
      );
      if (leftovers.length === 0) return;
      for (const [url] of leftovers) {
        try {
          this.deps.removeRelay?.(url);
        } catch {
          /* ignore */
        }
      }
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  /** Open bunker WebSockets immediately — no Amber popup. File-fetch must not win the first dial. */
  private scheduleBackgroundBunkerWarm() {
    if (typeof window === "undefined" || !this.session?.userPubkey) return;
    void this.warmBunkerTransportQuietly();
    this.startBunkerKeepalive();
  }

  private startBunkerKeepalive() {
    if (typeof window === "undefined") return;
    if (this.bunkerKeepaliveTimer) return;
    this.bunkerKeepaliveTimer = setInterval(() => {
      if (!this.session?.userPubkey) {
        this.stopBunkerKeepalive();
        return;
      }
      if (
        typeof document !== "undefined" &&
        document.visibilityState === "hidden"
      ) {
        return;
      }
      void this.warmBunkerTransportQuietly();
    }, BUNKER_KEEPALIVE_MS);
  }

  private stopBunkerKeepalive() {
    if (this.bunkerKeepaliveTimer) {
      clearInterval(this.bunkerKeepaliveTimer);
      this.bunkerKeepaliveTimer = null;
    }
  }

  private async warmBunkerTransportQuietly() {
    const session = this.session;
    if (!session?.userPubkey) return;
    // Do not unsub/resub bunker listen while Push is waiting on Amber.
    if (this.pending.size > 0) return;
    if (this.bunkerWarmInFlight) return this.bunkerWarmInFlight;
    this.bunkerWarmInFlight = (async () => {
      try {
        const open = await this.ensureBunkerSocketsOpen(session, {
          quiet: true,
        });
        if (open.length > 0) {
          console.log("[RemoteSigner] Background bunker warm ready", {
            open: open.map((u) => normalizeRelayUrl(u)),
          });
          try {
            await this.startSubscription(session, open);
          } catch {
            /* subscription retry happens on sign */
          }
        } else {
          // Soft path — Push/ensureRpcHealthy will hard-fail with a clear error.
          // Avoid a stack of scary warns on every homepage idle warm.
          if (typeof console.debug === "function") {
            console.debug(
              "[RemoteSigner] Background bunker warm: no OPEN sockets yet",
              await this.snapshotDirectRelayStatuses(
                this.buildBunkerTransportTargets(session)
              )
            );
          }
        }
      } catch (error) {
        if (typeof console.debug === "function") {
          console.debug(
            "[RemoteSigner] Background bunker warm failed:",
            error instanceof Error ? error.message : error
          );
        }
      } finally {
        this.bunkerWarmInFlight = null;
      }
    })();
    return this.bunkerWarmInFlight;
  }

  /**
   * Re-open dead/stuck directPool sockets before publishing a NIP-46 request.
   * nostr-tools v1 relays never auto-reconnect: after a silent drop the
   * subscription is dead and trySend discards messages, so requests would
   * vanish and every RPC would "time out" even though Amber is online.
   *
   * Opens in parallel. Waits for several of Amber's URI relays (not the
   * first OPEN socket). Fallback-only OPEN does not stop waiting for URI relays.
   *
   * @param dialTargets Optional override list (e.g. forced signer defaults on
   *   the last ensureBunkerSocketsOpen attempt). When omitted, uses
   *   buildBunkerTransportTargets(session).
   */
  private async ensureDirectTransport(
    session: RemoteSignerSession,
    dialTargets?: string[],
    opts?: { quiet?: boolean }
  ): Promise<string[]> {
    const quiet = !!opts?.quiet;
    const softWarn = (...args: unknown[]) => {
      if (quiet) {
        if (typeof console.debug === "function") console.debug(...args);
      } else {
        console.warn(...args);
      }
    };
    const targets =
      dialTargets && dialTargets.length > 0
        ? expandBunkerRelays(dialTargets)
        : this.buildBunkerTransportTargets(session);
    if (targets.length === 0) return [];
    const uriRelays = getSessionUriRelays(session);
    const preferredNorm = new Set(uriRelays.map(normalizeRelayUrl));

    const alreadyOpen = await this.listDirectOpenRelays(targets);
    const alreadyNorm = new Set(alreadyOpen.map(normalizeRelayUrl));
    const preferredAlready =
      preferredNorm.size > 0
        ? uniqueNormalizedRelays(
            alreadyOpen.filter((u) => preferredNorm.has(normalizeRelayUrl(u)))
          )
        : uniqueNormalizedRelays(alreadyOpen);
    const wantPreferred = BUNKER_PROCEED_WHEN_OPEN;
    const toDial = targets.filter(
      (t) => !alreadyNorm.has(normalizeRelayUrl(t))
    );

    if (toDial.length > 0) {
      const openUrls = [...alreadyOpen];
      const overallMs = BUNKER_RELAY_OPEN_BUDGET_MS + 1500;
      await new Promise<void>((resolve) => {
        let pending = toDial.length;
        let finished = false;
        const finish = () => {
          if (finished) return;
          finished = true;
          resolve();
        };
        const timer = setTimeout(finish, overallMs);
        const preferredOpenCount = () =>
          openUrls.filter((u) =>
            preferredNorm.size === 0
              ? true
              : preferredNorm.has(normalizeRelayUrl(u))
          ).length;
        const onOneDone = () => {
          pending -= 1;
          if (preferredOpenCount() >= wantPreferred || pending <= 0) {
            clearTimeout(timer);
            finish();
          }
        };
        for (const url of toDial) {
          void this.openDirectRelay(url, BUNKER_RELAY_OPEN_BUDGET_MS).then(
            (ok) => {
              if (ok) openUrls.push(url);
              onOneDone();
            }
          );
        }
      });
    }

    const allOpen = await this.listDirectOpenRelays(targets);
    const preferredOpen = preferUriOpenRelays(
      allOpen,
      uriRelays.length > 0 ? uriRelays : allOpen,
      BUNKER_PUBLISH_MAX_RELAYS
    );
    if (preferredOpen.length > 0) {
      const usingFallbackOnly =
        preferredNorm.size > 0 &&
        preferredOpen.every((u) => !preferredNorm.has(normalizeRelayUrl(u)));
      console.log("[RemoteSigner] Direct transport ready", {
        open: preferredOpen.length,
        total: targets.length,
        openUrls: preferredOpen.map((u) => normalizeRelayUrl(u)),
        uriRelays,
        usingFallbackOnly,
        reused: preferredAlready.length,
      });
      if (this.pending.size === 0) {
        try {
          await this.startSubscription(session, preferredOpen);
        } catch (error) {
          console.warn(
            "[RemoteSigner] Failed to refresh subscription after transport ensure:",
            error
          );
        }
      }
    } else {
      softWarn(
        "[RemoteSigner] No OPEN bunker sockets",
        await this.snapshotDirectRelayStatuses(targets)
      );
    }
    return preferredOpen;
  }

  private async waitForDirectPoolRelays(relays: string[], timeoutMs = 8000) {
    const targets = relays
      .map((r) => normalizeRelayUrl(r))
      .filter((r) => r.startsWith("wss://"));
    if (targets.length === 0) return;
    // Prefer the shared openDirectRelay path (longer budget, no thrash).
    await Promise.all(
      targets.map((url) =>
        this.openDirectRelay(
          url,
          Math.max(timeoutMs, BUNKER_RELAY_OPEN_BUDGET_MS)
        )
      )
    );
  }

  private async listDirectOpenRelays(relays: string[]): Promise<string[]> {
    const open: string[] = [];
    for (const url of relays) {
      const relay = this.getDirectRelayFromPool(url);
      if (relay?.status === 1) open.push(url);
    }
    return open;
  }

  /**
   * Publish via SimplePool and prefer waiting for at least one relay OK.
   * nostr-tools trySend silently drops when the socket is not OPEN — so we
   * only publish to OPEN relays. Missing OK acks are warned (some relays omit
   * them for kind 24133) but do not hard-fail if sockets were OPEN — callers
   * that need a live Amber wake (sign_event) should check `acked` and repair.
   */
  private async publishDirectConfirmed(
    relays: string[],
    event: any,
    timeoutMs = 2500
  ): Promise<{ urls: string[]; acked: boolean }> {
    const open = await this.listDirectOpenRelays(relays);
    const publishTargets = open.length > 0 ? open : [];
    if (publishTargets.length === 0) {
      throw new Error("No bunker relay connected for remote signer publish");
    }

    return await new Promise<{ urls: string[]; acked: boolean }>(
      (resolve, reject) => {
        const okRelays: string[] = [];
        let settled = false;
        const finish = (urls: string[], acked: boolean) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve({ urls, acked });
        };
        const timer = setTimeout(() => {
          if (okRelays.length > 0) {
            // Record every OPEN target we published to (not only the first OK).
            finish(uniqueNormalizedRelays([...publishTargets]), true);
            return;
          }
          console.warn(
            "[RemoteSigner] Direct publish got no OK ack; continuing because bunker sockets were OPEN",
            { eventId: event?.id, relays: publishTargets }
          );
          finish(uniqueNormalizedRelays([...publishTargets]), false);
        }, timeoutMs);
        try {
          const pub = this.directPool.publish(publishTargets, event);
          pub.on("ok", (relayUrl: string) => {
            okRelays.push(relayUrl);
            if (
              uniqueNormalizedRelays(okRelays).length >= publishTargets.length
            ) {
              finish(uniqueNormalizedRelays([...publishTargets]), true);
            }
          });
          pub.on("failed", (relayUrl: string) => {
            console.warn("[RemoteSigner] Direct publish failed on", relayUrl);
          });
        } catch (error) {
          settled = true;
          clearTimeout(timer);
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      }
    );
  }

  private async waitForRelayOpen(relays: string[], timeoutMs = 8000) {
    if (!this.deps.getRelayStatuses || relays.length === 0) return;
    const targets = new Set(relays.map((r) => normalizeRelayUrl(r)));
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const statuses = this.deps.getRelayStatuses();
      const hasOpenTarget = statuses.some(([url, state]) => {
        return state === 1 && targets.has(normalizeRelayUrl(url));
      });
      if (hasOpenTarget) return;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    const statuses = this.deps.getRelayStatuses?.() || [];
    const bunkerStatuses = statuses.filter(([url]) =>
      targets.has(normalizeRelayUrl(url))
    );
    console.warn(
      "[RemoteSigner] No bunker relay reached OPEN state in app relaypool before timeout (direct pool may still work)",
      {
        bunkerStatuses: bunkerStatuses.map(([url, state]) => ({
          url,
          state,
        })),
      }
    );
  }

  private getOpenRelays(relays: string[]): string[] {
    if (!this.deps.getRelayStatuses || relays.length === 0) return relays;
    const wanted = new Set(relays.map((r) => normalizeRelayUrl(r)));
    const openByNorm = new Set(
      this.deps
        .getRelayStatuses()
        .filter(
          ([url, state]) => state === 1 && wanted.has(normalizeRelayUrl(url))
        )
        .map(([url]) => normalizeRelayUrl(url))
    );
    return relays.filter((relay) => openByNorm.has(normalizeRelayUrl(relay)));
  }

  private async publishWithRelayRetry(
    event: any,
    sessionRelays: string[],
    baseRelays: string[],
    maxAttempts = 4
  ) {
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const open = this.getOpenRelays(baseRelays);
      const candidateRelays = open.length > 0 ? open : baseRelays;
      if (candidateRelays.length === 0) {
        await new Promise((resolve) => setTimeout(resolve, 300));
        continue;
      }
      try {
        this.deps.publish(event, candidateRelays);
        console.log("[RemoteSigner] Published via relaypool", {
          eventId: event?.id,
          relays: candidateRelays,
        });
        return;
      } catch (error) {
        lastError = error;
        const message =
          error instanceof Error ? error.message : String(error ?? "");
        if (
          message.includes("InvalidStateError") ||
          message.includes("CONNECTING state")
        ) {
          console.warn("[RemoteSigner] Publish retry due to connecting state", {
            eventId: event?.id,
            attempt,
            relays: candidateRelays,
          });
          await new Promise((resolve) => setTimeout(resolve, 350));
          continue;
        }
        throw error;
      }
    }
    if (lastError) throw lastError;
    throw new Error(
      `No bunker relay connected (OPEN) for request publish (${sessionRelays.join(
        ", "
      )})`
    );
  }

  private async startSubscription(
    session: RemoteSignerSession,
    relaysOverride?: string[]
  ) {
    // Unsub mid-wait drops Amber's 24133 reply in the gap. Keep the live sub.
    if (this.pending.size > 0 && this.directUnsubscribe) {
      return;
    }
    this.unsubscribe?.();
    this.directUnsubscribe?.();
    this.unsubscribe = undefined;
    const relays =
      relaysOverride && relaysOverride.length > 0
        ? relaysOverride
        : getSessionUriRelays(session).length > 0
        ? getSessionUriRelays(session)
        : session.relays;
    const wideNostrConnect =
      !!session.nostrConnectPairing &&
      (!session.remotePubkey || session.remotePubkey.length === 0);
    const filters = wideNostrConnect
      ? [
          {
            kinds: [24133],
            "#p": [session.clientPubkey],
          },
        ]
      : [
          {
            kinds: [24133],
            authors: [session.remotePubkey],
            "#p": [session.clientPubkey],
          },
          {
            kinds: [24133],
            authors: [session.remotePubkey],
          },
        ];

    // NIP-46 responses only on directPool. Do NOT subscribe via the app
    // relaypool — that silently addRelay's bunker hosts and starves Amber.

    const sub: any = this.directPool.sub(relays, filters as any[]);
    const onEvent = (event: any) => {
      const kind = typeof event?.kind === "number" ? event.kind : -1;
      const id = typeof event?.id === "string" ? event.id.slice(0, 12) : "none";
      const pub =
        typeof event?.pubkey === "string" ? event.pubkey.slice(0, 12) : "none";
      console.log(
        `[RemoteSigner] DirectPool inbound kind=${kind} id=${id} pub=${pub}`
      );
      if (this.pending.size > 0) this.inboundDuringWait += 1;
      void this.handleIncomingEvent(event);
    };
    sub.on("event", onEvent);
    this.directUnsubscribe = () => {
      try {
        sub.off?.("event", onEvent);
        sub.unsub?.();
      } catch {
        // ignore cleanup errors
      }
    };
  }

  private rememberCompletedRpcId(id?: string) {
    if (!id || this.completedRpcIds.includes(id)) return;
    this.completedRpcIds.push(id);
    if (this.completedRpcIds.length > 32) {
      this.completedRpcIds.shift();
    }
  }

  private async handleIncomingEvent(event: any) {
    const session = this.session;
    if (!session) return;
    if (!event || event.kind !== 24133) return;
    const wideNostrConnect =
      !!session.nostrConnectPairing &&
      (!session.remotePubkey || session.remotePubkey.length === 0);
    const pTags = event.tags
      ?.filter((tag: any) => Array.isArray(tag) && tag[0] === "p")
      .map((tag: any) => tag[1]);
    const isForClient = !!pTags?.includes(session.clientPubkey);
    if (wideNostrConnect) {
      if (!isForClient) return;
    } else {
      const isExpectedAuthor = event.pubkey === session.remotePubkey;
      if (!isExpectedAuthor) {
        return;
      }
    }
    // Some signers omit the client p-tag on connect ACK only.
    if (!isForClient) {
      const hasPendingConnect = [...this.pending.values()].some(
        (p) => p.method === "connect"
      );
      if (!hasPendingConnect) {
        return;
      }
    }
    console.log("[RemoteSigner] Received response event", {
      eventId: event.id?.slice?.(0, 12),
      author: event.pubkey?.slice?.(0, 12),
      hasPTagForClient: isForClient,
      pendingCount: this.pending.size,
    });
    // Decrypt payload
    try {
      const plaintext = await decryptFromRemoteSigner(
        session.clientSecretKey,
        event.pubkey,
        event.content
      );
      const message = JSON.parse(plaintext);
      if (
        typeof message?.id === "string" &&
        this.completedRpcIds.includes(message.id)
      ) {
        return;
      }
      if (wideNostrConnect) {
        if (!session.secret || message?.result !== session.secret) {
          return;
        }
        session.remotePubkey = String(event.pubkey).toLowerCase();
        session.nostrConnectPairing = false;
        this.nostrConnectSignerResolved?.();
        void this.startSubscription(
          session,
          this.getOpenRelays(session.relays)
        );
      }
      const hintedPubkey = extractHexPubkey(message?.result);
      if (hintedPubkey) {
        this.pairingPubkeyHint = hintedPubkey;
      }
      console.log("[RemoteSigner] Decrypted response payload", {
        id: message?.id,
        hasError: !!message?.error,
        resultType: typeof message?.result,
      });
      let pending = message?.id ? this.pending.get(message.id) : undefined;
      const pendingConnectList = [...this.pending.values()].filter(
        (p) => p.method === "connect"
      );
      const errStr =
        message?.error === undefined || message?.error === null
          ? ""
          : typeof message.error === "string"
          ? message.error
          : String(message.error);
      // Amber (and some signers) may use a session-scoped JSON-RPC id that does not
      // match our per-request id, so strict pending.get(message.id) never resolves.
      if (!pending && message?.id && pendingConnectList.length === 1) {
        if (/already connected/i.test(errStr)) {
          pending = pendingConnectList[0];
          message.error = undefined;
          message.result = "ack";
        } else if (!message.error) {
          const result = message?.result;
          // bunker46 (and NIP-46 nostrconnect responses) echo the pairing
          // secret as the connect result instead of "ack".
          const secretEcho =
            typeof result === "string" &&
            !!this.session?.secret &&
            result === this.session.secret;
          const maybeConnectDone =
            secretEcho ||
            result === "ack" ||
            result === "ok" ||
            result === true ||
            result === "" ||
            (typeof result === "string" && HEX_64_RE.test(result)) ||
            (typeof result === "object" && result?.ok === true);
          if (maybeConnectDone) {
            pending = pendingConnectList[0];
            if (result === true || result === "ok" || result === "") {
              message.result = "ack";
            }
          }
        }
      }
      // Some signers return responses without request id.
      if (!pending && !message?.id) {
        const pendingConnect =
          pendingConnectList.length === 1 ? pendingConnectList[0] : undefined;
        const pendingGetPubkey = [...this.pending.values()].find(
          (p) => p.method === "get_public_key"
        );
        const result = message?.result;
        const maybeAck =
          result === "ack" ||
          result === "ok" ||
          result === true ||
          (typeof result === "object" && result?.ok === true);
        const maybePubkey =
          (typeof result === "string" && HEX_64_RE.test(result)) ||
          (typeof result?.pubkey === "string" && HEX_64_RE.test(result.pubkey));
        if (pendingConnect && maybeAck) {
          pending = pendingConnect;
          if (
            typeof result === "object" &&
            result?.pubkey &&
            !message?.result
          ) {
            message.result = result.pubkey;
          } else if (result === true || result === "ok") {
            message.result = "ack";
          }
        } else if (pendingGetPubkey && maybePubkey) {
          pending = pendingGetPubkey;
          if (
            typeof result === "object" &&
            typeof result?.pubkey === "string"
          ) {
            message.result = result.pubkey;
          }
        }
      }
      if (!pending) {
        const pendingGetPubkey = [...this.pending.values()].find(
          (p) => p.method === "get_public_key"
        );
        if (pendingGetPubkey && this.pairingPubkeyHint) {
          pending = pendingGetPubkey;
          message.result = this.pairingPubkeyHint;
        }
      }
      if (!pending) {
        const pendingSignList = [...this.pending.values()].filter(
          (p) => p.method === "sign_event"
        );
        if (
          pendingSignList.length === 1 &&
          !message.error &&
          looksLikeSignedNostrEvent(message?.result)
        ) {
          pending = pendingSignList[0];
        }
      }
      if (!pending) {
        console.debug("[RemoteSigner] Unmatched response payload", {
          id: message?.id,
          hasError: !!message?.error,
          resultType: typeof message?.result,
        });
        return;
      }
      if (message?.id && this.pending.has(message.id)) {
        this.rememberCompletedRpcId(message.id);
        this.pending.delete(message.id);
      } else {
        for (const [pid, p] of this.pending) {
          if (p === pending) {
            this.rememberCompletedRpcId(pid);
            if (typeof message?.id === "string") {
              this.rememberCompletedRpcId(message.id);
            }
            this.pending.delete(pid);
            break;
          }
        }
      }
      clearTimeout(pending.timeout);
      if (message.error) {
        pending.reject(new Error(message.error));
      } else {
        this.rpcHealthy = true;
        if (this.state !== "ready" && this.session?.userPubkey) {
          this.notifyState("ready");
        }
        pending.resolve(message.result);
      }
    } catch (error) {
      console.error("[RemoteSigner] Failed to decrypt response:", {
        eventId: event.id,
        author: event.pubkey,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Keep the NIP-46 response subscription alive while sign_event is pending.
   * nostr-tools v1 does not auto-reconnect; file-fetch WebSocket churn can
   * drop bunker sockets after publish. Do not resetDirectPool here.
   */
  private async refreshSignEventListenPath(session: RemoteSignerSession) {
    const uriRelays = getSessionUriRelays(session);
    const published = this.lastPublishMeta?.urls || [];
    const targets = uniqueNormalizedRelays([...uriRelays, ...published]);
    if (targets.length === 0) return;
    const open = await this.listDirectOpenRelays(targets);
    const openNorm = new Set(open.map((u) => normalizeRelayUrl(u)));
    const missing = targets.filter((t) => !openNorm.has(normalizeRelayUrl(t)));
    await Promise.all(
      missing
        .slice(0, 4)
        .map((url) => this.openDirectRelay(url, BUNKER_RELAY_OPEN_BUDGET_MS))
    );
    const again = await this.listDirectOpenRelays(targets);
    const preferred = preferUriOpenRelays(again, uriRelays);
    const listenOn = preferred.length > 0 ? preferred : again;
    if (listenOn.length === 0) return;
    // Re-open missing sockets only. Do not unsub the live 24133 listener.
    if (this.pending.size === 0) {
      await this.startSubscription(session, listenOn);
    }
  }

  private async sendRequest(
    session: RemoteSignerSession,
    method: string,
    params: unknown[],
    timeoutMs = REQUEST_TIMEOUT_MS
  ): Promise<any> {
    // Repair the dedicated NIP-46 transport first — dead sockets silently
    // swallow requests AND responses (the "push fails silently" symptom).
    // Do not addRelay bunker URLs into the app pool (socket starvation).
    const openDirect = await this.ensureDirectTransport(session);
    if (openDirect.length === 0) {
      throw new Error(
        "Could not open any bunker relay to reach Amber. Keep Amber open/unlocked on your phone, check mobile data/Wi‑Fi, then try Push again."
      );
    }
    const id = randomRequestId();
    const payload = JSON.stringify({
      id,
      method,
      params,
    });
    const encrypted = await encryptNip46RpcPayload(
      method,
      session.clientSecretKey,
      session.remotePubkey,
      payload
    );
    const buildRpcEvent = (content: string) => {
      const event: any = {
        kind: 24133,
        created_at: Math.floor(Date.now() / 1000),
        content,
        tags: [["p", session.remotePubkey]],
        pubkey: getPublicKey(session.clientSecretKey),
      };
      event.id = getEventHash(event);
      event.sig = signEvent(event, session.clientSecretKey);
      return event;
    };
    const requestEvent = buildRpcEvent(encrypted.primary);
    const dualEvent = encrypted.dual ? buildRpcEvent(encrypted.dual) : null;
    if (method === "sign_event") {
      this.lastSignEventEnvelopes = dualEvent
        ? [requestEvent, dualEvent]
        : [requestEvent];
    }
    console.log("[RemoteSigner] Encrypting RPC", {
      method,
      primary: encrypted.primaryScheme,
      dual: encrypted.dualScheme,
    });
    const shouldDualPublish = !!dualEvent;
    return new Promise((resolve, reject) => {
      let listenRefresh: ReturnType<typeof setInterval> | null = null;
      let republishedOnce = false;
      const waitStarted = Date.now();
      if (method === "sign_event") this.inboundDuringWait = 0;
      const finishListen = () => {
        if (listenRefresh) {
          clearInterval(listenRefresh);
          listenRefresh = null;
        }
      };
      const timeout = setTimeout(() => {
        finishListen();
        this.pending.delete(id);
        reject(new Error(`Remote signer request ${method} timed out`));
      }, timeoutMs);
      this.pending.set(id, {
        method,
        resolve: (value) => {
          finishListen();
          resolve(value);
        },
        reject: (reason) => {
          finishListen();
          reject(reason);
        },
        timeout,
      });
      if (method === "sign_event") {
        listenRefresh = setInterval(() => {
          if (!this.pending.has(id)) {
            finishListen();
            return;
          }
          void this.refreshSignEventListenPath(session).catch(() => undefined);
          if (
            !republishedOnce &&
            this.inboundDuringWait === 0 &&
            Date.now() - waitStarted >= SIGN_REPUBLISH_IF_SILENT_MS
          ) {
            republishedOnce = true;
            const urls = this.lastPublishMeta?.urls || [];
            if (urls.length > 0) {
              const envelopes =
                this.lastSignEventEnvelopes.length > 0
                  ? this.lastSignEventEnvelopes
                  : [requestEvent];
              console.warn(
                "[RemoteSigner] No inbound 24133 after publish — republishing sign_event once",
                { envelopes: envelopes.length }
              );
              for (const ev of envelopes) {
                void this.publishDirectConfirmed(urls, ev, 4000).catch(
                  () => undefined
                );
              }
            }
          }
        }, SIGN_LISTEN_REFRESH_MS);
      }
      // Publish only after pending handler is registered; otherwise a fast signer
      // response can arrive before we track `id`, causing dropped acks/timeouts.
      void (async () => {
        try {
          // Publish NIP-46 only on directPool — app relaypool publish would
          // dial bunker hosts again and fight for the same browser sockets.
          // Prefer Amber URI/signer relays among OPEN sockets.
          const uriRelays = getSessionUriRelays(session);
          let publishTargets = preferUriOpenRelays(
            openDirect.length > 0 ? openDirect : [],
            uriRelays
          );
          if (publishTargets.length === 0) {
            publishTargets =
              openDirect.length > 0
                ? openDirect
                : uriRelays.length > 0
                ? uriRelays
                : session.relays;
          }
          let published = await this.publishDirectConfirmed(
            publishTargets,
            requestEvent
          );
          this.lastPublishMeta = {
            method,
            urls: published.urls,
            acked: published.acked,
            uriRelays,
          };
          // sign_event: zombie OPEN sockets often soft-continue without OK —
          // Amber never sees the request. Reset + republish once before waiting.
          if (method === "sign_event" && !published.acked) {
            console.warn(
              "[RemoteSigner] sign_event publish had no relay OK — resetting bunker transport and retrying once"
            );
            this.resetDirectPool();
            const reopened = await this.ensureDirectTransport(session);
            publishTargets = preferUriOpenRelays(reopened, uriRelays);
            if (publishTargets.length === 0) {
              throw new Error(
                "Could not reopen bunker relays after publish without OK. Open Amber and try again."
              );
            }
            published = await this.publishDirectConfirmed(
              publishTargets,
              requestEvent,
              4000
            );
            this.lastPublishMeta = {
              method,
              urls: published.urls,
              acked: published.acked,
              uriRelays,
            };
          }
          const overlap = bunkerRelayPublishOverlap(published.urls, uriRelays);
          console.log("[RemoteSigner] Published via direct pool", {
            eventId: requestEvent.id,
            method,
            relays: published.urls,
            acked: published.acked,
            uriRelays,
            overlap: overlap.overlap,
            hasUriOverlap: overlap.hasOverlap,
            uriOnly: overlap.uriOnly,
          });
          if (method === "sign_event" && overlap.uriOnly.length > 0) {
            const extra = overlap.uriOnly;
            await Promise.all(
              extra.map((url) =>
                this.openDirectRelay(url, BUNKER_RELAY_OPEN_BUDGET_MS)
              )
            );
            const extraOpen = await this.listDirectOpenRelays(extra);
            if (extraOpen.length > 0) {
              try {
                await this.startSubscription(
                  session,
                  uniqueNormalizedRelays([...published.urls, ...extraOpen])
                );
                const extraPub = await this.publishDirectConfirmed(
                  extraOpen,
                  requestEvent,
                  4000
                );
                published = {
                  urls: uniqueNormalizedRelays([
                    ...published.urls,
                    ...extraPub.urls,
                  ]),
                  acked: published.acked || extraPub.acked,
                };
                this.lastPublishMeta = {
                  method,
                  urls: published.urls,
                  acked: published.acked,
                  uriRelays,
                };
                console.log(
                  "[RemoteSigner] sign_event republished to remaining Amber URI relays",
                  {
                    extra: extraOpen,
                    all: published.urls,
                  }
                );
              } catch (extraErr) {
                console.warn(
                  "[RemoteSigner] Could not fan-out sign_event to remaining Amber relays",
                  extraErr instanceof Error ? extraErr.message : extraErr
                );
              }
            }
          }
          if (
            method === "sign_event" &&
            uriRelays.length > 0 &&
            !bunkerRelayPublishOverlap(published.urls, uriRelays).hasOverlap
          ) {
            console.warn(
              "[RemoteSigner] sign_event published with no overlap vs Amber URI relays — Amber may not see this request",
              {
                published: published.urls,
                uriRelays,
                publishedOnly: overlap.publishedOnly,
              }
            );
          }
          if (shouldDualPublish && dualEvent) {
            // Same JSON-RPC id, other encryption (NIP-04 vs NIP-44).
            try {
              const okFallback = await this.publishDirectConfirmed(
                publishTargets.length > 0
                  ? publishTargets
                  : uriRelays.length > 0
                  ? uriRelays
                  : session.relays,
                dualEvent,
                6000
              );
              console.log("[RemoteSigner] Published fallback via direct pool", {
                eventId: dualEvent.id,
                method,
                scheme: encrypted.dualScheme,
                relays: okFallback.urls,
                acked: okFallback.acked,
              });
            } catch (fallbackErr) {
              console.warn(
                "[RemoteSigner] Fallback publish not acknowledged:",
                fallbackErr instanceof Error ? fallbackErr.message : fallbackErr
              );
            }
          }
        } catch (error) {
          clearTimeout(timeout);
          const pending = this.pending.get(id);
          this.pending.delete(id);
          const err =
            error instanceof Error
              ? error
              : new Error(String(error ?? "Publish failed"));
          if (pending) pending.reject(err);
          else {
            finishListen();
            reject(err);
          }
        }
      })();
    });
  }

  private applyNip07Adapter() {
    if (typeof window === "undefined") return;
    // When a NIP-46 session is active, `window.nostr` must point at the remote
    // adapter. If we restored the browser extension here (previous behaviour),
    // `getPublicKey` / signing would use the extension while NostrContext still
    // shows the bunker's pubkey — breaking explore, file fetch, and anything
    // that keys off `window.nostr` vs context.
    if (this.session) {
      const adapter = createRemoteNip07Adapter(this);
      this.adapter = adapter;
      window.nostr = adapter as typeof window.nostr;
      return;
    }
    if (this.originalNostr) {
      window.nostr = this.originalNostr;
      this.adapter = undefined;
      return;
    }
    delete (window as unknown as { nostr?: unknown }).nostr;
    this.adapter = undefined;
  }
}

function createRemoteNip07Adapter(manager: RemoteSignerManager) {
  return {
    getPublicKey: async () => {
      const pubkey = manager.getUserPubkey();
      if (!pubkey) {
        throw new Error("Remote signer not paired");
      }
      return pubkey;
    },
    signEvent: (event: UnsignedEvent) => manager.signEvent(event),
    getRelays: async () => {
      const session = manager.getSession();
      if (!session) return {};
      const relays = getSessionUriRelays(session);
      return relays.reduce<Record<string, { read: boolean; write: boolean }>>(
        (acc, relay) => {
          acc[relay] = { read: true, write: true };
          return acc;
        },
        {}
      );
    },
    nip04: {
      encrypt: (pubkey: string, plaintext: string) =>
        manager.nip04Encrypt(pubkey, plaintext),
      decrypt: (pubkey: string, ciphertext: string) =>
        manager.nip04Decrypt(pubkey, ciphertext),
    },
    nip44: {
      encrypt: (pubkey: string, plaintext: string) =>
        manager.nip44Encrypt(pubkey, plaintext),
      decrypt: (pubkey: string, ciphertext: string) =>
        manager.nip44Decrypt(pubkey, ciphertext),
    },
  };
}
