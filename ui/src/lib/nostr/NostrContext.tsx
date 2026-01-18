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
import {
  RemoteSignerManager,
  loadStoredRemoteSignerSession,
} from "./remoteSigner";

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

// Get relays from environment variable (NEXT_PUBLIC_NOSTR_RELAYS)
// NEXT_PUBLIC_NOSTR_RELAYS should be a comma-separated list: "wss://relay1.com,wss://relay2.com"
// In Next.js, NEXT_PUBLIC_* vars are replaced at build time, so we can access them directly
// If not set, falls back to minimal defaults (should be configured via .env.local)
const getRelays = (): string[] => {
  const envRelays = process.env.NEXT_PUBLIC_NOSTR_RELAYS;

  // NOTE: console.log here runs at BUILD TIME (server-side), not in browser
  // Browser-side logging happens in the Provider component below

  if (envRelays && envRelays.trim().length > 0) {
    const parsed = envRelays
      .split(",")
      .map((r) => {
        const trimmed = r.trim();
        // Fix common typos (wwss -> wss)
        if (trimmed.startsWith("wwss://")) {
          return trimmed.replace("wwss://", "wss://");
        }
        return trimmed;
      })
      .filter((r) => r.length > 0 && r.startsWith("wss://"))
      // Remove duplicates
      .filter((r, index, self) => self.indexOf(r) === index);

    if (parsed.length > 0) {
      return parsed;
    }
  }

  // In dev, avoid default relays unless explicitly configured to reduce noise/lag
  if (process.env.NODE_ENV === "development") {
    return [];
  }

  // Minimal fallback - should not be used in production (configure via .env.local)
  return ["wss://relay.damus.io"];
};

const defaultRelays = getRelays();
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
      const relay = relayPool.addOrGetRelay(url);
      // Note: Relays auto-connect when added, but we need to ensure they're tracked
      // The status will be updated by the relay pool internally (0=closed, 1=connecting, 2=open)
      console.log(`[NostrContext] Added relay to pool: ${url}`);
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
      const unsub = relayPool.subscribe(
        filters,
        relays,
        onEvent,
        maxDelayms,
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
  const [remoteSignerInitialized, setRemoteSignerInitialized] = useState(false);

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
      return relayPool.subscribe(
        filters,
        relays,
        onEvent,
        maxDelayms,
        onEose,
        options
      );
    };

    remoteSignerRef.current = new RemoteSignerManager({
      publish: publishFn,
      subscribe: subscribeFn,
      addRelay,
      removeRelay,
    });

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
    remoteSignerRef.current.bootstrapFromStorage().catch((error) => {
      console.error("[NostrContext] Failed to bootstrap remote signer:", error);
    });
  }, [remoteSignerInitialized, pubkey, setPubKey]);

  const setAuthor = useCallback(
    (author: string) => {
      const { type, data } = (
        nip19 as unknown as {
          decode: (author: string) => { type: string; data: string };
        }
      ).decode(author);
      if (type !== "npub") {
        throw new Error("Please use npub");
      }
      setPubKey(data);
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
        remoteSigner: remoteSignerRef.current || undefined,
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
