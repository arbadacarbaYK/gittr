/**
 * Unified Nostr signing resolver.
 * Supports NIP-07 extensions, NIP-46 remote signers, and stored nsec keys.
 */
import { getNostrPrivateKey } from "@/lib/security/encryptedStorage";
import type { Event as NostrEvent, UnsignedEvent } from "nostr-tools";

import {
  type RemoteSignerManager,
  loadStoredRemoteSignerSession,
} from "./remoteSigner";

export const NO_SIGNING_METHOD_MESSAGE =
  "No signing method available.\n\nPlease use a NIP-07 extension (like Alby or nos2x), pair with a remote signer (NIP-46 bunker/nostrconnect), or configure a private key in Settings.";

export type NostrSignerSource = "nip07" | "remote" | "nsec";

export interface ResolvedNostrSigner {
  source: NostrSignerSource;
  signEvent: (event: UnsignedEvent | NostrEvent) => Promise<NostrEvent>;
  getPublicKey: () => Promise<string>;
  /** Set when signing via stored nsec */
  privateKey?: string;
  /** True when `window.nostr` is the active signing backend */
  usesWindowNostr: boolean;
}

export function isRemoteSignerReady(
  remoteSigner?: RemoteSignerManager | null
): boolean {
  return !!(
    remoteSigner?.getSession()?.userPubkey &&
    remoteSigner?.getState() === "ready"
  );
}

export function hasStoredRemoteSignerSession(): boolean {
  if (typeof window === "undefined") return false;
  return !!loadStoredRemoteSignerSession()?.userPubkey;
}

/**
 * Wait for a stored remote signer session to finish bootstrapping
 * (`window.nostr` adapter attached and ready).
 */
export async function waitForRemoteSigner(
  remoteSigner?: RemoteSignerManager | null,
  maxWaitMs = 20000
): Promise<boolean> {
  if (!remoteSigner || !hasStoredRemoteSignerSession()) {
    return false;
  }

  if (isRemoteSignerReady(remoteSigner)) {
    return true;
  }

  try {
    await Promise.race([
      remoteSigner.ensureBootstrapped(),
      new Promise<void>((resolve) => setTimeout(resolve, maxWaitMs)),
    ]);
  } catch {
    // Fall through to polling.
  }

  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    if (isRemoteSignerReady(remoteSigner)) {
      return true;
    }
    if (typeof window !== "undefined" && window.nostr) {
      try {
        await window.nostr.getPublicKey();
        return true;
      } catch {
        // Keep waiting.
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  return (
    isRemoteSignerReady(remoteSigner) ||
    (typeof window !== "undefined" && !!window.nostr)
  );
}

export interface ResolveSignerOptions {
  remoteSigner?: RemoteSignerManager | null;
  /** Wait for remote signer bootstrap when a session exists (default true) */
  waitForRemote?: boolean;
  maxWaitMs?: number;
}

/**
 * Resolve the best available signing method for the current session.
 */
export async function resolveNostrSigner(
  options: ResolveSignerOptions = {}
): Promise<ResolvedNostrSigner | null> {
  const { remoteSigner, waitForRemote = true, maxWaitMs = 8000 } = options;

  if (hasStoredRemoteSignerSession() && waitForRemote) {
    await waitForRemoteSigner(remoteSigner, maxWaitMs);
  }

  if (typeof window !== "undefined" && window.nostr) {
    const remoteReady = isRemoteSignerReady(remoteSigner);
    try {
      const getPublicKey = () => window.nostr!.getPublicKey();
      await getPublicKey();
      return {
        source: remoteReady ? "remote" : "nip07",
        getPublicKey,
        signEvent: (event) => window.nostr!.signEvent(event),
        usesWindowNostr: true,
      };
    } catch (error) {
      console.warn("[Signer] window.nostr is present but not usable:", error);
    }
  }

  if (remoteSigner && isRemoteSignerReady(remoteSigner)) {
    return {
      source: "remote",
      getPublicKey: async () => {
        const pubkey = remoteSigner.getUserPubkey();
        if (!pubkey) {
          throw new Error("Remote signer not paired");
        }
        return pubkey;
      },
      signEvent: (event) => remoteSigner.signEvent(event),
      usesWindowNostr: false,
    };
  }

  const privateKey = await getNostrPrivateKey();
  if (privateKey) {
    const {
      getEventHash,
      getPublicKey: ntoolsGetPublicKey,
      signEvent: ntoolsSignEvent,
    } = await import("nostr-tools");
    return {
      source: "nsec",
      privateKey,
      getPublicKey: async () => ntoolsGetPublicKey(privateKey),
      signEvent: async (event) => {
        const pubkey = event.pubkey || ntoolsGetPublicKey(privateKey);
        const unsigned = { ...event, pubkey } as UnsignedEvent;
        const id =
          "id" in event && typeof event.id === "string"
            ? event.id
            : getEventHash(unsigned);
        const toSign = { ...unsigned, id, sig: "" };
        return {
          ...toSign,
          sig: ntoolsSignEvent(toSign as UnsignedEvent, privateKey),
        } as NostrEvent;
      },
      usesWindowNostr: false,
    };
  }

  return null;
}

export async function requireNostrSigner(
  options: ResolveSignerOptions = {}
): Promise<ResolvedNostrSigner> {
  const signer = await resolveNostrSigner(options);
  if (!signer) {
    throw new Error(NO_SIGNING_METHOD_MESSAGE);
  }
  return signer;
}

/**
 * Back-compat helper for UI code that branches on `hasNip07` + `privateKey`.
 * Waits for remote signer bootstrap when needed.
 */
export async function resolveSigningCredentials(
  options: ResolveSignerOptions = {}
): Promise<{
  hasNip07: boolean;
  privateKey?: string;
  signer: ResolvedNostrSigner;
} | null> {
  const signer = await resolveNostrSigner(options);
  if (!signer) {
    return null;
  }
  return {
    hasNip07: signer.usesWindowNostr,
    privateKey: signer.privateKey,
    signer,
  };
}
