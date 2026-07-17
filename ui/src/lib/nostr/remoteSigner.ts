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
  relays: string[];
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

/** Relays signers like Amber reliably use for NIP-46 (pairing + sign_event). */
const NIP46_PAIRING_RELAY_FALLBACKS = ["wss://relay.damus.io", "wss://nos.lol"];

/** Amber bunker default relays — must overlap QR pairing when user has no prior session. */
const NIP46_SIGNER_DEFAULT_RELAYS = [
  "wss://relay.primal.net",
  "wss://theforest.nostr1.com",
  "wss://nostr.oxtr.dev",
];

const normalizeRelayUrl = (url: string) =>
  url.trim().toLowerCase().replace(/\/+$/, "");

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

export const DEFAULT_REMOTE_SIGNER_LABEL = "gittr.space";

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

function encryptForRemoteSigner(
  clientSecretKey: string,
  remotePubkey: string,
  plaintext: string
): Promise<string> {
  try {
    const conversationKey = nip44v2.getConversationKey(
      hexToBytes(clientSecretKey),
      remotePubkey
    );
    return Promise.resolve(nip44v2.encrypt(plaintext, conversationKey));
  } catch (error) {
    console.warn(
      "[RemoteSigner] nip44 encrypt failed, falling back to nip04:",
      error
    );
    return nip04.encrypt(clientSecretKey, remotePubkey, plaintext);
  }
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
    return (this.session?.relays || []).map(normalizeRelayUrl);
  }

  /**
   * Single-flight bootstrap — safe to call from push/sign while page load is still pairing.
   */
  ensureBootstrapped(): Promise<void> {
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
   * Live probe before signing. Cached pubkey alone is not proof Amber can answer.
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
      }
      this.notifyState("connecting");
      try {
        await this.reestablishConnection(this.requireSession());
        this.rpcHealthy = true;
        this.notifyState("ready");
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
  async bootstrapFromStorage() {
    const stored = loadStoredRemoteSignerSession();
    if (!stored) return;
    try {
      console.log("[RemoteSigner] Restoring session from storage");
      this.rpcHealthy = false;
      this.notifyState("connecting");
      await this.activateSession(stored);
      // Many signers (Amber/bunker) require a fresh connect RPC after reload
      // before sign_event works — otherwise responses are "no permission".
      try {
        await this.reestablishConnection(this.requireSession());
        this.rpcHealthy = true;
        this.notifyState("ready");
      } catch (reconnectErr) {
        this.rpcHealthy = false;
        console.warn(
          "[RemoteSigner] Reconnect on bootstrap failed; keeping cached session (not ready until Amber answers)",
          reconnectErr instanceof Error ? reconnectErr.message : reconnectErr
        );
        // Keep adapter + cached pubkey for UI, but do NOT claim ready — otherwise
        // callers start a 120s sign_event that never reaches Amber.
        this.notifyState(
          "error",
          "Remote signer session restored but Amber did not respond. Open the signer app and try again."
        );
      }
    } catch (error: any) {
      console.error("[RemoteSigner] Failed to resume session:", error);
      this.rpcHealthy = false;
      if (stored.userPubkey) {
        try {
          await this.activateSession({ ...stored, lastConnected: Date.now() });
          this.notifyState(
            "error",
            "Remote signer session cached but not connected. Open Amber and try again."
          );
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
   */
  private async reestablishConnection(
    session: RemoteSignerSession,
    forceReset = false
  ) {
    if (!session.clientPubkey || !session.remotePubkey) {
      console.warn(
        "[RemoteSigner] Skipping reconnect — incomplete session (missing client or remote pubkey)"
      );
      return;
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
        console.warn(
          "[RemoteSigner] connect on reestablish timed out; probing get_public_key"
        );
      } else {
        throw err;
      }
    }

    try {
      await this.sendRequest(session, "get_public_key", [], CONNECT_TIMEOUT_MS);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/no permission/i.test(msg) && session.userPubkey) {
        console.warn(
          "[RemoteSigner] get_public_key denied but cached userPubkey exists — sign may still work after user approves on device"
        );
        return;
      }
      throw err;
    }
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
      relays: config.relays,
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
      await this.ensureRelays(session.relays);
      await this.waitForRelayOpen(session.relays, 2500);
      await this.waitForDirectPoolRelays(session.relays, 8000);
      const transportRelays = this.resolveTransportRelays(session.relays);
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
    // Probe first so we fail in ~25s with a clear Amber hint instead of
    // waiting the full 120s sign timeout on a dead/stale session.
    await this.ensureRpcHealthy();
    const session = this.requireSession();
    const payload = toSignEventTemplate(event);
    try {
      return await this.signEventWithSession(session, payload);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/no permission/i.test(msg)) {
        console.warn(
          "[RemoteSigner] sign_event denied — logout + NIP-46 connect retry"
        );
        this.rpcHealthy = false;
        await this.reestablishConnection(session, true);
        this.rpcHealthy = true;
        this.notifyState("ready");
        return await this.signEventWithSession(session, payload);
      }
      if (/timed out/i.test(msg)) {
        // A second silent 120s retry only hides the failure from the user.
        // Repair transport for the NEXT attempt, then fail loudly with a hint.
        console.warn("[RemoteSigner] sign_event timed out");
        this.rpcHealthy = false;
        void this.ensureDirectTransport(session).catch(() => undefined);
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
    this.session = session;
    persistRemoteSignerSession(session);
    await this.ensureRelays(session.relays);
    await this.waitForRelayOpen(session.relays, 6000);
    const openRelays = this.getOpenRelays(session.relays);
    await this.startSubscription(
      session,
      openRelays.length > 0 ? openRelays : session.relays
    );
    // This ensures we preserve NIP-07 extension even if it loads after constructor
    if (typeof window !== "undefined" && window.nostr) {
      // Only update if we don't already have an original (first time activating)
      // or if current window.nostr is not our adapter (NIP-07 extension loaded)
      if (!this.originalNostr || window.nostr !== this.adapter) {
        this.originalNostr = window.nostr;
      }
    }
    this.applyNip07Adapter();
  }

  private clearSession() {
    this.rpcHealthy = false;
    this.healthProbeInFlight = null;
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

  /**
   * Re-open dead directPool sockets before publishing a NIP-46 request.
   * nostr-tools v1 relays never auto-reconnect: after a silent drop the
   * subscription is dead and trySend discards messages, so requests would
   * vanish and every RPC would "time out" even though Amber is online.
   */
  private async ensureDirectTransport(session: RemoteSignerSession) {
    const targets = session.relays.filter((r) =>
      normalizeRelayUrl(r).startsWith("wss://")
    );
    if (targets.length === 0) return;
    let reconnected = false;
    await Promise.all(
      targets.map(async (url) => {
        try {
          const relay: any = await Promise.race([
            this.directPool.ensureRelay(url),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error("ensureRelay timeout")), 5000)
            ),
          ]);
          // 3 = CLOSED. Never touch CONNECTING/OPEN sockets — re-dialing a
          // connecting socket replaces it and thrashes the connection.
          if (relay && relay.status === 3) {
            await Promise.race([
              relay.connect(),
              new Promise((_, reject) =>
                setTimeout(() => reject(new Error("connect timeout")), 5000)
              ),
            ]);
            reconnected = true;
          }
        } catch {
          // Other relays may still work; publish path retries too.
        }
      })
    );
    if (reconnected) {
      console.log(
        "[RemoteSigner] Direct transport re-opened; refreshing NIP-46 subscription"
      );
      try {
        await this.startSubscription(session);
      } catch (error) {
        console.warn(
          "[RemoteSigner] Failed to refresh subscription after reconnect:",
          error
        );
      }
    }
  }

  private async waitForDirectPoolRelays(relays: string[], timeoutMs = 8000) {
    const targets = relays
      .map((r) => normalizeRelayUrl(r))
      .filter((r) => r.startsWith("wss://"));
    if (targets.length === 0) return;
    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        try {
          sub.unsub();
        } catch {
          /* ignore */
        }
        resolve();
      };
      const sub = this.directPool.sub(targets, [{ kinds: [1], limit: 0 }]);
      sub.on("eose", finish);
      setTimeout(finish, Math.min(timeoutMs, 4000));
    });
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
    console.warn(
      "[RemoteSigner] No bunker relay reached OPEN state before timeout; continuing"
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
    this.unsubscribe?.();
    this.directUnsubscribe?.();
    const relays =
      relaysOverride && relaysOverride.length > 0
        ? relaysOverride
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

    // Keep legacy app relaypool subscription (best-effort).
    try {
      this.unsubscribe = this.deps.subscribe(filters, relays, (event) =>
        this.handleIncomingEvent(event)
      );
    } catch (error) {
      console.warn("[RemoteSigner] relaypool subscribe failed:", error);
      this.unsubscribe = undefined;
    }

    // Dedicated direct NIP-46 subscription path.
    const sub: any = this.directPool.sub(relays, filters as any[]);
    const onEvent = (event: any) => {
      const kind = typeof event?.kind === "number" ? event.kind : -1;
      const id = typeof event?.id === "string" ? event.id.slice(0, 12) : "none";
      const pub =
        typeof event?.pubkey === "string" ? event.pubkey.slice(0, 12) : "none";
      console.log(
        `[RemoteSigner] DirectPool inbound kind=${kind} id=${id} pub=${pub}`
      );
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
        console.debug("[RemoteSigner] Unmatched response payload", {
          id: message?.id,
          hasError: !!message?.error,
          resultType: typeof message?.result,
        });
        return;
      }
      if (message?.id && this.pending.has(message.id)) {
        this.pending.delete(message.id);
      } else {
        for (const [pid, p] of this.pending) {
          if (p === pending) {
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

  private async sendRequest(
    session: RemoteSignerSession,
    method: string,
    params: unknown[],
    timeoutMs = REQUEST_TIMEOUT_MS
  ): Promise<any> {
    await this.ensureRelays(session.relays);
    // Repair the dedicated NIP-46 transport first — dead sockets silently
    // swallow requests AND responses (the "push fails silently" symptom).
    await this.ensureDirectTransport(session);
    await this.waitForRelayOpen(session.relays, 6000);
    const id = randomRequestId();
    const payload = JSON.stringify({
      id,
      method,
      params,
    });
    const ciphertext = await encryptForRemoteSigner(
      session.clientSecretKey,
      session.remotePubkey,
      payload
    );
    const requestEvent: any = {
      kind: 24133,
      created_at: Math.floor(Date.now() / 1000),
      content: ciphertext,
      tags: [["p", session.remotePubkey]],
      pubkey: getPublicKey(session.clientSecretKey),
    };
    requestEvent.id = getEventHash(requestEvent);
    requestEvent.sig = signEvent(requestEvent, session.clientSecretKey);
    const shouldDualPublishForPairing =
      method === "connect" || method === "get_public_key";
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Remote signer request ${method} timed out`));
      }, timeoutMs);
      this.pending.set(id, { method, resolve, reject, timeout });
      // Publish only after pending handler is registered; otherwise a fast signer
      // response can arrive before we track `id`, causing dropped acks/timeouts.
      void (async () => {
        try {
          await this.publishWithRelayRetry(
            requestEvent,
            session.relays,
            session.relays
          );
          // Also publish through dedicated SimplePool path, isolated from app relaypool.
          try {
            this.directPool.publish(session.relays, requestEvent);
            console.log("[RemoteSigner] Published via direct pool", {
              eventId: requestEvent.id,
              method,
              relays: session.relays,
            });
          } catch {
            // ignore direct publish errors here; retry path above already handled.
          }
          if (shouldDualPublishForPairing) {
            // Amber compatibility: during pairing, publish a second envelope using
            // explicit NIP-04 encryption (same request id) in case signer is not
            // accepting our NIP-44 envelope for this connection.
            try {
              const nip04Ciphertext = await nip04.encrypt(
                session.clientSecretKey,
                session.remotePubkey,
                payload
              );
              if (!nip04Ciphertext || nip04Ciphertext === ciphertext) return;
              const fallbackEvent: any = {
                kind: 24133,
                created_at: Math.floor(Date.now() / 1000),
                content: nip04Ciphertext,
                tags: [["p", session.remotePubkey]],
                pubkey: getPublicKey(session.clientSecretKey),
              };
              fallbackEvent.id = getEventHash(fallbackEvent);
              fallbackEvent.sig = signEvent(
                fallbackEvent,
                session.clientSecretKey
              );
              await this.publishWithRelayRetry(
                fallbackEvent,
                session.relays,
                session.relays
              );
              try {
                this.directPool.publish(session.relays, fallbackEvent);
                console.log(
                  "[RemoteSigner] Published fallback via direct pool",
                  {
                    eventId: fallbackEvent.id,
                    method,
                    relays: session.relays,
                  }
                );
              } catch {
                // ignore direct publish errors for fallback envelope
              }
            } catch {
              // Ignore fallback path failures and rely on primary envelope.
            }
          }
        } catch (error) {
          clearTimeout(timeout);
          this.pending.delete(id);
          reject(
            error instanceof Error
              ? error
              : new Error(String(error ?? "Publish failed"))
          );
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
      return session.relays.reduce<
        Record<string, { read: boolean; write: boolean }>
      >((acc, relay) => {
        acc[relay] = { read: true, write: true };
        return acc;
      }, {});
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
