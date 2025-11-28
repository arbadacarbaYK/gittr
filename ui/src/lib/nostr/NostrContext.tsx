import { type ReactNode, createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

import {
  type OnEose,
  type OnEvent,
  RelayPool,
  type SubscriptionOptions,
} from "nostr-relaypool";
import { type Filter, type UnsignedEvent, type Event as NostrEvent } from "nostr-tools";
import { nip19 } from "nostr-tools";

import useLocalStorage from "../hooks/useLocalStorage";

import { WEB_STORAGE_KEYS } from "./localStorage";
import {
  RemoteSignerManager,
  type RemoteSignerSession,
  type RemoteSignerState,
} from "./remoteSigner";

declare global {
  interface Window {
    nostr: {
      getPublicKey(): Promise<string>;
      signEvent(event: NostrEvent | UnsignedEvent): Promise<NostrEvent>;
      getRelays(): Promise<{ [url: string]: { read: boolean; write: boolean } }>;
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
    const parsed = envRelays.split(",")
      .map(r => {
        const trimmed = r.trim();
        // Fix common typos (wwss -> wss)
        if (trimmed.startsWith("wwss://")) {
          return trimmed.replace("wwss://", "wss://");
        }
        return trimmed;
      })
      .filter(r => r.length > 0 && r.startsWith("wss://"))
      // Remove duplicates
      .filter((r, index, self) => self.indexOf(r) === index);
    
    if (parsed.length > 0) {
      return parsed;
    }
  }
  
  // Minimal fallback - should not be used in production (configure via .env.local)
  return [
    "wss://relay.damus.io", // Minimal fallback for development only
  ];
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
  authInitialized: boolean; // Whether all auth methods have been checked
  remoteSigner?: {
    session: RemoteSignerSession | null;
    state: RemoteSignerState;
    error?: string;
    connect: (uri: string) => Promise<{ npub: string }>;
    disconnect: () => void;
  };
}>({ defaultRelays, pubkey: null, authInitialized: false });

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

  const removeRelay = useCallback(
    (url: string) => {
      relayPool.removeRelay(url)
    },
    []
  );

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

  const [pubkey, setPubKey, removePubKey] = useLocalStorage<string | null>(
    WEB_STORAGE_KEYS.NPUB,
    null
  );

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

  // Initialize authInitialized immediately if pubkey exists OR remote signer session exists
  // This prevents flickering on page navigation
  const [authInitialized, setAuthInitialized] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      // Check for stored pubkey
      const storedPubkey = localStorage.getItem(WEB_STORAGE_KEYS.NPUB);
      if (storedPubkey) return true;
      
      // Check for stored remote signer session with userPubkey
      const storedSession = localStorage.getItem(WEB_STORAGE_KEYS.REMOTE_SIGNER_SESSION);
      if (storedSession) {
        try {
          const parsed = JSON.parse(storedSession);
          if (parsed?.userPubkey) return true;
        } catch {
          // Invalid JSON, ignore
        }
      }
      
      return false;
    } catch {
      return false;
    }
  });


  const publish = useCallback(
    (event: any, relays: string[]) => {
      console.log(`📤 [NostrContext] Publishing event:`, {
        eventId: event.id,
        kind: event.kind,
        pubkey: event.pubkey ? `${event.pubkey.substring(0, 8)}...` : 'none',
        relays: relays.length,
        relayList: relays,
        tagsCount: event.tags?.length || 0,
        cloneTags: event.tags?.filter((t: any[]) => Array.isArray(t) && t[0] === "clone").map((t: any[]) => t[1]) || [],
      });
      try {
      relayPool.publish(event, relays);
        console.log(`✅ [NostrContext] Event published to relayPool (${relays.length} relays)`);
      } catch (error) {
        console.error(`❌ [NostrContext] Failed to publish event:`, error);
        throw error;
      }
    },
    []
  );

  const getRelayStatuses = useCallback(() => {
    return relayPool.getRelayStatuses();
  }, []);

  const [remoteSignerStatus, setRemoteSignerStatus] = useState<{
    session: RemoteSignerSession | null;
    state: RemoteSignerState;
    error?: string;
  }>({ session: null, state: "idle" });
  const remoteSignerRef = useRef<RemoteSignerManager | null>(null);
  const initTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const initCompleteRef = useRef(!!pubkey || authInitialized); // Start based on pubkey or authInitialized
  const initializedRef = useRef(false);

  // If pubkey exists, authInitialized should always be true (immediate)
  // This prevents flickering on page navigation
  useEffect(() => {
    if (pubkey) {
      // Pubkey exists - ensure we're initialized
      if (!authInitialized || !initCompleteRef.current) {
        initCompleteRef.current = true;
        setAuthInitialized(true);
      }
    } else if (!pubkey && authInitialized && initCompleteRef.current) {
      // Pubkey was removed and we were initialized - reset
      initCompleteRef.current = false;
      setAuthInitialized(false);
    }
  }, [pubkey]); // Only depend on pubkey

  // Initialize remote signer (only once)
  useEffect(() => {
    if (typeof window === "undefined" || initializedRef.current) return;
    initializedRef.current = true;

    // Check for stored remote signer session and set pubkey immediately if it exists
    // This prevents the need to wait for async bootstrap
    try {
      const storedSession = localStorage.getItem(WEB_STORAGE_KEYS.REMOTE_SIGNER_SESSION);
      if (storedSession) {
        const parsed = JSON.parse(storedSession);
        if (parsed?.userPubkey && !pubkey) {
          // Set pubkey immediately from stored session
          setPubKey(parsed.userPubkey);
        }
      }
    } catch (error) {
      // Ignore errors, will be handled by bootstrap
    }

    remoteSignerRef.current = new RemoteSignerManager({
      publish,
      subscribe: relayPoolSubscribe,
      addRelay,
      removeRelay,
    });
    remoteSignerRef.current.onStateChange = (state, session, error) => {
      setRemoteSignerStatus({ state, session, error });
      if (state === "ready" && session?.userPubkey) {
        setPubKey(session.userPubkey);
      }
    };
    remoteSignerRef.current.bootstrapFromStorage();

    return () => {
      remoteSignerRef.current?.disconnect();
    };
  }, [addRelay, removeRelay, publish, relayPoolSubscribe, setPubKey]);

  // Check auth initialization status (only if no pubkey exists yet)
  // This effect only runs once on mount or when remoteSignerStatus changes
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (initCompleteRef.current) return; // Already initialized, don't run again
    
    // If we already have a pubkey, we're immediately initialized (handled by sync effect above)
    if (pubkey) {
      initCompleteRef.current = true;
      setAuthInitialized(true);
      if (initTimeoutRef.current) {
        clearTimeout(initTimeoutRef.current);
        initTimeoutRef.current = null;
      }
      return;
    }
    
    const checkAuthInitialized = () => {
      if (initCompleteRef.current) return;
      
      // Check if we have pubkey from localStorage (synchronous)
      const hasLocalStoragePubkey = !!pubkey;
      
      // If we have pubkey, initialize immediately
      if (hasLocalStoragePubkey) {
        initCompleteRef.current = true;
        setAuthInitialized(true);
        if (initTimeoutRef.current) {
          clearTimeout(initTimeoutRef.current);
          initTimeoutRef.current = null;
        }
        return;
      }
      
      // Check if remote signer has finished bootstrapping
      // If state is not "idle", it means we've checked (ready, error, or connecting)
      const remoteSignerDone = remoteSignerStatus.state !== "idle";
      
      // Check if NIP-07 extension is available (give it time to inject)
      const nip07Checked = typeof window !== "undefined" && 
        (window.nostr !== undefined || Date.now() > ((window as any).__nip07CheckTime || 0));
      
      if (remoteSignerDone && nip07Checked) {
        initCompleteRef.current = true;
        setAuthInitialized(true);
        if (initTimeoutRef.current) {
          clearTimeout(initTimeoutRef.current);
          initTimeoutRef.current = null;
        }
      }
    };

    // Mark NIP-07 check time
    if (typeof window !== "undefined") {
      (window as any).__nip07CheckTime = Date.now();
    }

    // Check immediately (for localStorage pubkey)
    checkAuthInitialized();

    // Check after a short delay (for NIP-07 injection)
    const timeout1 = setTimeout(checkAuthInitialized, 100);
    const timeout2 = setTimeout(checkAuthInitialized, 500);
    const timeout3 = setTimeout(checkAuthInitialized, 1000);

    // Final timeout: if nothing happens after 2 seconds, consider it initialized
    initTimeoutRef.current = setTimeout(() => {
      if (!initCompleteRef.current) {
        initCompleteRef.current = true;
        setAuthInitialized(true);
      }
    }, 2000);

    return () => {
      clearTimeout(timeout1);
      clearTimeout(timeout2);
      clearTimeout(timeout3);
      if (initTimeoutRef.current) {
        clearTimeout(initTimeoutRef.current);
        initTimeoutRef.current = null;
      }
    };
  }, [pubkey, remoteSignerStatus.state, remoteSignerStatus.session]);

  const connectRemoteSigner = useCallback(
    async (uri: string) => {
      if (!remoteSignerRef.current) {
        throw new Error("Remote signer manager not initialized");
      }
      const result = await remoteSignerRef.current.connect(uri);
      setPubKey(result.session.userPubkey);
      return { npub: result.npub };
    },
    [setPubKey]
  );

  const disconnectRemoteSigner = useCallback(() => {
    remoteSignerRef.current?.disconnect();
  }, []);

  const signOut = useCallback(() => {
    remoteSignerRef.current?.disconnect();
    removePubKey();
  }, [removePubKey]);

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
        authInitialized,
        remoteSigner: {
          session: remoteSignerStatus.session,
          state: remoteSignerStatus.state,
          error: remoteSignerStatus.error,
          connect: connectRemoteSigner,
          disconnect: disconnectRemoteSigner,
        },
      }}
    >
      {children}
    </NostrContext.Provider>
  );
};

// Log relay info when provider mounts (browser-side)
if (typeof window !== 'undefined') {
  console.log('🔍 [NostrContext] Provider initialized with relays:', {
    count: defaultRelays.length,
    relays: defaultRelays
  });
}

export default NostrProvider;
