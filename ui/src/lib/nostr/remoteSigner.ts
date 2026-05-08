import {
  type UnsignedEvent,
  generatePrivateKey,
  getEventHash,
  getPublicKey,
  nip04,
  nip19,
  signEvent,
} from "nostr-tools";
import type { Event as NostrEvent } from "nostr-tools";

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

export interface RemoteSignerConfig {
  remotePubkey: string;
  relays: string[];
  secret?: string;
  permissions?: string[];
  label?: string;
}

export interface RemoteSignerSession {
  remotePubkey: string;
  relays: string[];
  clientSecretKey: string;
  clientPubkey: string;
  userPubkey: string;
  secret?: string;
  permissions?: string[];
  label?: string;
  lastConnected: number;
}

export type RemoteSignerState = "idle" | "connecting" | "ready" | "error";

interface RemoteSignerDeps {
  publish: PublishFn;
  subscribe: SubscribeFn;
  addRelay?: RelayMutator;
  removeRelay?: RelayMutator;
}

interface PendingRequest {
  method: string;
  resolve: (value: any) => void;
  reject: (reason?: any) => void;
  timeout: ReturnType<typeof setTimeout>;
}

const STORAGE_KEY = WEB_STORAGE_KEYS.REMOTE_SIGNER_SESSION;
const REQUEST_TIMEOUT_MS = 15000;
const CONNECT_TIMEOUT_MS = 25000;
const CONNECT_RETRY_DELAYS_MS = [0, 1200, 2500];

const randomRequestId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);

const bytesToHex = (bytes: Uint8Array) =>
  Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

/**
 * Parse bunker:// or nostrconnect:// tokens
 */
export function parseRemoteSignerUri(input: string): RemoteSignerConfig {
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
    // Security hardening: signer-initiated bunker URIs should include a secret
    // to prevent relay-level hijacking/race attacks during pairing.
    if (!secret) {
      throw new Error(
        "Security: bunker:// token requires a secret parameter"
      );
    }
    const label = params.get("name") || params.get("label") || undefined;
    return {
      remotePubkey: pubkeyPart.toLowerCase(),
      relays,
      secret,
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
      remotePubkey: clientPubkey.toLowerCase(),
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
  private originalNostr: typeof window.nostr | undefined;
  private adapter: any;
  onStateChange?: (
    state: RemoteSignerState,
    session: RemoteSignerSession | null,
    error?: string
  ) => void;
  private lastError?: string;

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

  /**
   * Attempt to rehydrate existing session from storage.
   */
  async bootstrapFromStorage() {
    const stored = loadStoredRemoteSignerSession();
    if (!stored) return;
    try {
      console.log("[RemoteSigner] Restoring session from storage");
      await this.activateSession(stored);
      this.notifyState("ready");
    } catch (error: any) {
      console.error("[RemoteSigner] Failed to resume session:", error);
      this.clearSession();
      this.notifyState(
        "error",
        error?.message || "Failed to resume remote signer session"
      );
    }
  }

  /**
   * Pair using bunker/nostrconnect URI
   */
  async connect(uri: string) {
    const config = parseRemoteSignerUri(uri);
    this.notifyState("connecting");

    const generatedClientSecret = generatePrivateKey();
    const session: RemoteSignerSession = {
      remotePubkey: config.remotePubkey,
      relays: config.relays,
      clientSecretKey: generatedClientSecret, // generatePrivateKey returns hex string
      clientPubkey: "",
      userPubkey: "",
      secret: config.secret,
      permissions: config.permissions,
      label: config.label,
      lastConnected: Date.now(),
    };
    session.clientPubkey = getPublicKey(session.clientSecretKey);

    try {
      await this.ensureRelays(session.relays);
      await this.startSubscription(session);

      // NIP-46 connect params: [client_pubkey, optional_secret, optional_perms]
      // We previously sent remote pubkey as first param, which breaks some signers
      // (Amber may ACK connect but not establish request permissions for follow-ups).
      const connectParams = [session.clientPubkey];
      if (session.secret) {
        connectParams.push(session.secret);
      }
      if (session.permissions && session.permissions.length > 0) {
        connectParams.push(session.permissions.join(","));
      }
      let connectErr: unknown;
      let connectAcked = false;
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
          });
          await this.sendRequest(
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
          console.warn(
            `[RemoteSigner] connect attempt ${i + 1} failed:`,
            err instanceof Error ? err.message : err
          );
        }
      }
      if (connectErr) {
        const msg =
          connectErr instanceof Error ? connectErr.message : String(connectErr);
        // Compatibility: some signers establish pairing but don't return connect result.
        // Continue with get_public_key probe instead of hard-failing on connect timeout.
        if (/connect timed out|request connect timed out|timed out/i.test(msg)) {
          console.warn(
            "[RemoteSigner] connect timed out; continuing with get_public_key probe"
          );
        } else {
          throw connectErr;
        }
      }

      let remotePubkeyHex: unknown;
      let pubkeyErr: unknown;
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
        throw pubkeyErr;
      }
      if (!remotePubkeyHex || typeof remotePubkeyHex !== "string") {
        throw new Error("Remote signer did not return a pubkey");
      }
      session.userPubkey = remotePubkeyHex.toLowerCase();
      session.lastConnected = Date.now();

      await this.activateSession(session);
      this.notifyState("ready");

      return {
        session,
        npub: nip19.npubEncode(session.userPubkey),
      };
    } catch (error: any) {
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
    const session = this.requireSession();
    const payload = JSON.stringify(event);
    const result = await this.sendRequest(session, "sign_event", [payload]);
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
    await this.startSubscription(session);
    // Always capture current window.nostr before applying adapter
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
    this.session = null;
    persistRemoteSignerSession(null);
    this.unsubscribe?.();
    this.unsubscribe = undefined;
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

  private async startSubscription(session: RemoteSignerSession) {
    this.unsubscribe?.();
    this.unsubscribe = this.deps.subscribe(
      [
        {
          kinds: [24133],
          authors: [session.remotePubkey],
          "#p": [session.clientPubkey],
        },
        // Compatibility: some signers reply without correct `p` tags.
        // Keep this constrained to the signer pubkey.
        {
          kinds: [24133],
          authors: [session.remotePubkey],
        },
      ],
      session.relays,
      (event) => this.handleIncomingEvent(event)
    );
  }

  private async handleIncomingEvent(event: any) {
    const session = this.session;
    if (!session) return;
    if (!event || event.kind !== 24133) return;
    if (event.pubkey !== session.remotePubkey) return;
    const pTags = event.tags
      ?.filter((tag: any) => Array.isArray(tag) && tag[0] === "p")
      .map((tag: any) => tag[1]);
    const isForClient = !!pTags?.includes(session.clientPubkey);
    // If this is not clearly for this client, only allow it while waiting for connect ack.
    if (!isForClient) {
      const hasPendingConnect = [...this.pending.values()].some(
        (p) => p.method === "connect"
      );
      if (!hasPendingConnect) return;
    }
    console.log("[RemoteSigner] Received response event", {
      eventId: event.id?.slice?.(0, 12),
      author: event.pubkey?.slice?.(0, 12),
      hasPTagForClient: isForClient,
      pendingCount: this.pending.size,
    });
    // Decrypt payload
    try {
      const plaintext = await nip04.decrypt(
        session.clientSecretKey,
        event.pubkey,
        event.content
      );
      const message = JSON.parse(plaintext);
      console.log("[RemoteSigner] Decrypted response payload", {
        id: message?.id,
        hasError: !!message?.error,
        resultType: typeof message?.result,
      });
      let pending = message?.id ? this.pending.get(message.id) : undefined;
      // Some signers may return connect ack without request id.
      if (!pending && message?.result === "ack") {
        for (const [, p] of this.pending) {
          if (p.method === "connect") {
            pending = p;
            break;
          }
        }
      }
      if (!pending) {
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
    const id = randomRequestId();
    const payload = JSON.stringify({
      id,
      method,
      params,
    });
    const ciphertext = await nip04.encrypt(
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
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Remote signer request ${method} timed out`));
      }, timeoutMs);
      this.pending.set(id, { method, resolve, reject, timeout });
      // Publish only after pending handler is registered; otherwise a fast signer
      // response can arrive before we track `id`, causing dropped acks/timeouts.
      this.deps.publish(requestEvent, session.relays);
    });
  }

  private applyNip07Adapter() {
    if (typeof window === "undefined") return;
    // Prefer native NIP-07 extension when available; use remote adapter only
    // when there is no extension provider in the browser.
    if (this.originalNostr) {
      window.nostr = this.originalNostr;
      this.adapter = undefined;
      return;
    }
    const adapter = createRemoteNip07Adapter(this);
    this.adapter = adapter;
    window.nostr = adapter;
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
