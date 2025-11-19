import { type ReactNode, createContext, useCallback, useContext } from "react";

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


  const signOut = useCallback(() => {
    removePubKey();
  }, [removePubKey]);

  const publish = useCallback(
    (event: any, relays: string[]) => {
      relayPool.publish(event, relays);
    },
    []
  );

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
