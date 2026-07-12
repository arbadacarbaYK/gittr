import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  type OnEose,
  type OnEvent,
  RelayPool,
  type SubscriptionOptions,
} from "nostr-relaypool";
import {
  type Filter,
  type Event as NostrEvent,
  type UnsignedEvent,
} from "nostr-tools";
import { nip19 } from "nostr-tools";

import useLocalStorage from "../hooks/useLocalStorage";

import { WEB_STORAGE_KEYS } from "./localStorage";
import { getDefaultRelayUrls } from "./relay-env";
import {
  RemoteSignerManager,
  loadStoredRemoteSignerSession,
} from "./remoteSigner";
import {
  type ResolvedNostrSigner,
  hasStoredRemoteSignerSession,
  resolveNostrSigner,
} from "./signer";

declare global {
  interface Window {
    nostr: {
      getPublicKey(): Promise<string>;
      signEvent(event: NostrEvent | UnsignedEvent): Promise<NostrEvent>;
      getRelays(): Promise<{
        [url: string]: { read: boolean; write: boolean };
      }>;
      nip04: {
        encrypt(pubkey: string, plaintext: string): Promise<string>;
        decrypt(pubkey: string, ciphertext: string): Promise<string>;
      };
      nip44?: {
        encrypt(pubkey: string, plaintext: string): Promise<string>;
        decrypt(pubkey: string, ciphertext: string): Promise<string>;
      };
    };
  }
}

// NEXT_PUBLIC_NOSTR_RELAYS — see getDefaultRelayUrls() in relay-env.ts
const defaultRelays = getDefaultRelayUrls();
const relayPool = new RelayPool(defaultRelays);

const NostrContext = createContext<{
  subscribe?: typeof relayPool.subscribe;
  publish?: typeof relayPool.publish;
  addRelay?: (url: string) => void;
  removeRelay?: (url: string) => void;
  defaultRelays: string[];
  setAuthor?: (author: string) => void;
  pubkey: string | null;
  signOut?: () => void;
  getRelayStatuses?: () => [url: string, status: number][];
  remoteSigner?: RemoteSignerManager;
  /** True when a signing backend is ready (NIP-07, remote signer, or nsec) */
  signerReady?: boolean;
  resolveSigner?: () => Promise<ResolvedNostrSigner | null>;
}>({ defaultRelays, pubkey: null });

export const useNostrContext = () => {
  const context = useContext(NostrContext);
  if (context === null) {
    throw new Error("useNostrContext must be used within NostrProvider");
  }
  return context;
};

const NostrProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const addRelay = useCallback((url: string) => {
    try {
      const relay: any = relayPool.addOrGetRelay(url);
      // Only dial when the socket is fully CLOSED (status 3). nostr-relaypool's
      // connect() replaces the WebSocket whenever readyState !== OPEN, so calling
      // it while a socket is still CONNECTING kills the in-flight connection.
      // Repeated addRelay calls (one per NIP-46 request) then thrash the socket
      // forever and the relay never reaches OPEN — requests silently vanish.
      try {
        if (typeof relay?.status !== "number" || relay.status === 3) {
          relay?.connect?.();
          console.log(`[NostrContext] Connecting relay: ${url}`);
        }
      } catch (connectError) {
        console.warn(
          `[NostrContext] Relay connect() failed for ${url}:`,
          connectError
        );
      }
      return relay;
    } catch (error) {
      console.error(`[NostrContext] Failed to add relay ${url}:`, error);
      return null;
    }
  }, []);

  const removeRelay = useCallback((url: string) => {
    relayPool.removeRelay(url);
  }, []);

  const relayPoolSubscribe = useCallback(
    (
      filters: (Filter & { relay?: string; noCache?: boolean })[],
      relays: string[],
      onEvent: OnEvent,
      maxDelayms?: number,
      onEose?: OnEose,
      options: SubscriptionOptions = {}
    ) => {
      // nostr-relaypool disallows using maxDelayMs and onEose together.
      const safeMaxDelayMs = onEose ? undefined : maxDelayms;
      const unsub = relayPool.subscribe(
        filters,
        relays,
        onEvent,
        safeMaxDelayMs,
        onEose,
        options
      );
      return unsub;
    },
    []
  );

  // Initialize pubkey - check both regular storage and remote signer session
  // First try regular localStorage, then check remote signer session
  const getInitialPubkey = (): string | null => {
    if (typeof window === "undefined") return null;
    try {
      // First check regular pubkey storage
      const storedPubkey = window.localStorage.getItem(WEB_STORAGE_KEYS.NPUB);
      if (storedPubkey) {
        try {
          return JSON.parse(storedPubkey) as string;
        } catch {
          // Invalid JSON, continue to check remote signer
        }
      }
      // If no regular pubkey, check remote signer session
      const storedSession = loadStoredRemoteSignerSession();
      if (storedSession?.userPubkey) {
        return storedSession.userPubkey;
      }
    } catch (error) {
      // Ignore errors during initialization
    }
    return null;
  };

  const [pubkey, setPubKey, removePubKey] = useLocalStorage<string | null>(
    WEB_STORAGE_KEYS.NPUB,
    getInitialPubkey()
  );

  // Initialize remote signer manager
  const remoteSignerRef = useRef<RemoteSignerManager | null>(null);
  const [remoteSigner, setRemoteSigner] = useState<RemoteSignerManager | null>(
    null
  );
  const [remoteSignerInitialized, setRemoteSignerInitialized] = useState(false);
  const [signerReady, setSignerReady] = useState(() => {
    if (typeof window === "undefined") return false;
    return !!window.nostr || hasStoredRemoteSignerSession();
  });

  // Initialize remote signer manager with dependencies
  useEffect(() => {
    if (remoteSignerRef.current) return; // Already initialized

    const publishFn = (event: any, relays: string[]) => {
      relayPool.publish(event, relays);
    };

    const subscribeFn = (
      filters: any[],
      relays: string[],
      onEvent: (event: any, isAfterEose: boolean, relayURL?: string) => void,
      maxDelayms?: number,
      onEose?: (relayUrl: string, minCreatedAt: number) => void,
      options?: any
    ) => {
      // Keep behavior aligned with main subscribe wrapper.
      const safeMaxDelayMs = onEose ? undefined : maxDelayms;
      return relayPool.subscribe(
        filters,
        relays,
        onEvent,
        safeMaxDelayMs,
        onEose,
        options
      );
    };

    remoteSignerRef.current = new RemoteSignerManager({
      publish: publishFn,
      subscribe: subscribeFn,
      addRelay,
      removeRelay,
      getRelayStatuses: () => relayPool.getRelayStatuses(),
    });
    setRemoteSigner(remoteSignerRef.current);

    setRemoteSignerInitialized(true);
  }, [addRelay, removeRelay]);

  // Bootstrap remote signer from storage and restore pubkey if session exists
  useEffect(() => {
    if (!remoteSignerInitialized || !remoteSignerRef.current) return;

    // Check for stored remote signer session and set pubkey immediately (synchronous)
    if (typeof window !== "undefined") {
      try {
        const storedSession = loadStoredRemoteSignerSession();
        if (storedSession?.userPubkey && !pubkey) {
          // Set pubkey immediately from stored session (before async bootstrap)
          const npub = nip19.npubEncode(storedSession.userPubkey);
          setPubKey(storedSession.userPubkey);
          console.log(
            "[NostrContext] Restored pubkey from remote signer session"
          );
        }
      } catch (error) {
        console.warn(
          "[NostrContext] Failed to restore pubkey from remote signer session:",
          error
        );
      }
    }

    // Bootstrap async connection (restores window.nostr adapter)
    remoteSignerRef.current
      .ensureBootstrapped()
      .then(() => {
        setSignerReady(
          !!window.nostr ||
            remoteSignerRef.current?.getState() === "ready" ||
            hasStoredRemoteSignerSession()
        );
      })
      .catch((error) => {
        console.error("[NostrContext] Failed to bootstrap remote signer:", error);
      });
  }, [remoteSignerInitialized, pubkey, setPubKey]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.nostr) {
      setSignerReady(true);
      return;
    }
    void resolveNostrSigner({
      remoteSigner: remoteSignerRef.current,
      waitForRemote: false,
    }).then((signer) => {
      setSignerReady(!!signer);
    });
  }, [pubkey, remoteSignerInitialized]);

  const setAuthor = useCallback(
    (author: string) => {
      const trimmed = (author || "").trim();
      if (!trimmed) {
        throw new Error("Missing npub — sign in did not return a public key.");
      }
      let decoded: { type: string; data: string };
      try {
        decoded = (
          nip19 as unknown as {
            decode: (author: string) => { type: string; data: string };
          }
        ).decode(trimmed);
      } catch (error) {
        const msg =
          error instanceof Error ? error.message : "Invalid npub encoding";
        throw new Error(`Could not read npub: ${msg}`);
      }
      if (decoded.type !== "npub") {
        throw new Error("Please use npub");
      }
      setPubKey(decoded.data);
    },
    [setPubKey]
  );

  const signOut = useCallback(() => {
    // Disconnect remote signer if connected
    if (remoteSignerRef.current) {
      remoteSignerRef.current.disconnect();
    }
    removePubKey();
  }, [removePubKey]);

  const publish = useCallback((event: any, relays: string[]) => {
    console.log(`📤 [NostrContext] Publishing event:`, {
      eventId: event.id,
      kind: event.kind,
      pubkey: event.pubkey ? `${event.pubkey.substring(0, 8)}...` : "none",
      relays: relays.length,
      relayList: relays,
      tagsCount: event.tags?.length || 0,
      cloneTags:
        event.tags
          ?.filter((t: any[]) => Array.isArray(t) && t[0] === "clone")
          .map((t: any[]) => t[1]) || [],
    });
    try {
      relayPool.publish(event, relays);
      console.log(
        `✅ [NostrContext] Event published to relayPool (${relays.length} relays)`
      );
    } catch (error) {
      console.error(`❌ [NostrContext] Failed to publish event:`, error);
      throw error;
    }
  }, []);

  const getRelayStatuses = useCallback(() => {
    return relayPool.getRelayStatuses();
  }, []);

  const resolveSigner = useCallback(async () => {
    return resolveNostrSigner({
      remoteSigner: remoteSignerRef.current,
    });
  }, []);

  return (
    <NostrContext.Provider
      value={{
        subscribe: relayPoolSubscribe,
        publish,
        addRelay,
        removeRelay,
        defaultRelays: defaultRelays,
        setAuthor,
        pubkey,
        signOut,
        getRelayStatuses,
        remoteSigner: remoteSigner ?? undefined,
        signerReady,
        resolveSigner,
      }}
    >
      {children}
    </NostrContext.Provider>
  );
};

// Log relay info when provider mounts (browser-side)
if (typeof window !== "undefined") {
  console.log("🔍 [NostrContext] Provider initialized with relays:", {
    count: defaultRelays.length,
    relays: defaultRelays,
  });
}

export default NostrProvider;
