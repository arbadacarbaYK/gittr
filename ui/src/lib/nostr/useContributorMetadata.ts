import { useEffect, useState, useMemo, useRef } from "react";
import { useNostrContext } from "./NostrContext";
import { getAllRelays } from "./getAllRelays";

export type ClaimedIdentity = {
  platform: string; // e.g., "github", "twitter"
  identity: string; // e.g., "username"
  proof?: string; // e.g., GitHub Gist ID or proof URL
  verified?: boolean; // Whether we've verified the proof
};

export type Metadata = {
  banner?: string;
  website?: string;
  nip05?: string;
  picture?: string;
  lud16?: string;
  lnurl?: string;
  nwcRecv?: string;
  display_name?: string;
  about?: string;
  name?: string;
  created_at?: number; // Track when metadata was last updated
  identities?: ClaimedIdentity[]; // NIP-39 claimed identities from i tags
};

const METADATA_CACHE_KEY = "gittr_metadata_cache";

// Module-level cache to avoid loading from localStorage on every hook call
let moduleCache: Record<string, Metadata> | null = null;
let cacheLoadTime = 0;
const CACHE_REFRESH_INTERVAL = 5000; // Refresh cache every 5 seconds if needed

// Load metadata from localStorage cache (cached at module level)
function loadMetadataCache(): Record<string, Metadata> {
  if (typeof window === "undefined") return {};
  
  // Return cached version if it's fresh enough
  const now = Date.now();
  if (moduleCache !== null && (now - cacheLoadTime) < CACHE_REFRESH_INTERVAL) {
    return moduleCache;
  }
  
  try {
    const cached = localStorage.getItem(METADATA_CACHE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached) as Record<string, Metadata>;
      // CRITICAL: Normalize all keys to lowercase for consistent lookup
      const normalized: Record<string, Metadata> = {};
      for (const [key, value] of Object.entries(parsed)) {
        normalized[key.toLowerCase()] = value;
      }
      // Only log on first load or when cache size changes significantly
      if (moduleCache === null || Math.abs(Object.keys(normalized).length - Object.keys(moduleCache).length) > 10) {
        console.log(`📦 [useContributorMetadata] Loaded ${Object.keys(normalized).length} cached metadata entries (normalized to lowercase)`);
      }
      moduleCache = normalized;
      cacheLoadTime = now;
      return normalized;
    }
  } catch (err) {
    console.error("❌ [useContributorMetadata] Failed to load cached metadata", err);
  }
  
  moduleCache = {};
  cacheLoadTime = now;
  return {};
}

// Invalidate module cache when metadata is saved
function invalidateModuleCache() {
  moduleCache = null;
  cacheLoadTime = 0;
}

// Save metadata to localStorage cache (debounced)
// Use module-level tracking to prevent multiple instances from saving simultaneously
let saveTimeout: NodeJS.Timeout | null = null;
let pendingMetadata: Record<string, Metadata> | null = null;
let isSaving = false; // Track if we're currently saving to prevent loops

function saveMetadataCache(metadata: Record<string, Metadata>) {
  // Prevent recursive saves
  if (isSaving) {
    return;
  }
  
  // CRITICAL: Normalize all keys to lowercase before saving to prevent case-sensitivity issues
  const normalized: Record<string, Metadata> = {};
  for (const [key, value] of Object.entries(metadata)) {
    normalized[key.toLowerCase()] = value;
  }
  
  pendingMetadata = normalized;
  
  // Clear existing timeout
  if (saveTimeout) {
    clearTimeout(saveTimeout);
  }
  
  // Debounce saves to prevent excessive writes
  saveTimeout = setTimeout(() => {
    if (pendingMetadata && typeof window !== "undefined") {
      try {
        isSaving = true; // Mark as saving to prevent recursive updates
        localStorage.setItem(METADATA_CACHE_KEY, JSON.stringify(pendingMetadata));
        // Invalidate module cache so it reloads on next access
        invalidateModuleCache();
        // Reduced logging to prevent performance issues
        if (Object.keys(pendingMetadata).length > 0 && Object.keys(pendingMetadata).length % 10 === 0) {
          console.log(`💾 [useContributorMetadata] Saved ${Object.keys(pendingMetadata).length} metadata entries to cache`);
        }
        // Reset flag after a short delay to allow storage events to process
        setTimeout(() => {
          isSaving = false;
        }, 200);
      } catch (err) {
        console.error("❌ [useContributorMetadata] Failed to save metadata cache", err);
        isSaving = false;
      }
      pendingMetadata = null;
    }
  }, 1000); // 1 second debounce
}

// Hook to fetch metadata for multiple pubkeys (e.g., contributors)
// CRITICAL: This hook now uses a centralized localStorage cache that all pages share
export function useContributorMetadata(pubkeys: string[]) {
  const { subscribe, defaultRelays } = useNostrContext();
  // CRITICAL: Include user relays for metadata fetching
  const allRelays = useMemo(() => getAllRelays(defaultRelays), [defaultRelays]);
  
  // Initialize state from localStorage cache
  const [metadataMap, setMetadataMap] = useState<Record<string, Metadata>>(() => {
    return loadMetadataCache();
  });
  // Memoize pubkeysKey to prevent unnecessary re-renders - use stable string comparison
  // CRITICAL: Only recompute when actual pubkey content changes, not array reference
  const pubkeysKeyRef = useRef<string>("");
  const lastSubscriptionTimeRef = useRef<number>(0);
  const subscriptionTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pubkeysKey = useMemo(() => {
    if (pubkeys.length === 0) {
      const emptyKey = "";
      if (pubkeysKeyRef.current !== emptyKey) {
        pubkeysKeyRef.current = emptyKey;
      }
      return emptyKey;
    }
    const sorted = pubkeys.slice().sort(); // Create copy to avoid mutating original
    const newKey = sorted.join(",");
    // Only update ref if content actually changed
    if (pubkeysKeyRef.current !== newKey) {
      pubkeysKeyRef.current = newKey;
    }
    return newKey;
  }, [pubkeys.length, pubkeys.join(",")]); // Still depend on length and join for React's dependency tracking

  useEffect(() => {
    // CRITICAL: Debounce subscriptions to prevent excessive re-subscriptions
    // Only allow re-subscription if at least 2 seconds have passed since last subscription
    const now = Date.now();
    const timeSinceLastSubscription = now - lastSubscriptionTimeRef.current;
    const DEBOUNCE_MS = 2000; // 2 seconds debounce
    
    // Clear any pending subscription
    if (subscriptionTimeoutRef.current) {
      clearTimeout(subscriptionTimeoutRef.current);
      subscriptionTimeoutRef.current = null;
    }
    
    // If we just subscribed recently, debounce the new subscription
    if (timeSinceLastSubscription < DEBOUNCE_MS && lastSubscriptionTimeRef.current > 0) {
      // Skip this subscription attempt - will be handled by the timeout
      return;
    }
    
    // Update last subscription time
    lastSubscriptionTimeRef.current = now;
    // CRITICAL: Validate all pubkeys are full 64-char hex (not shortened, not npub) FIRST
    const invalidPubkeys = pubkeys.filter(p => !/^[0-9a-f]{64}$/i.test(p));
    
    // Filter out invalid pubkeys - only subscribe for valid ones
    const validPubkeys = pubkeys.filter(p => /^[0-9a-f]{64}$/i.test(p));
    
    // CRITICAL: Only re-subscribe if pubkeysKey actually changed (content changed, not just array reference)
    // BUT: Always subscribe on first render (when ref is empty) or if metadata is missing from cache
    const isFirstRender = pubkeysKeyRef.current === "";
    const keyChanged = pubkeysKeyRef.current !== pubkeysKey;
    const shouldSkip = !isFirstRender && !keyChanged && pubkeysKey !== "";
    
    // Check if any pubkeys are missing from cache
    const missingFromCache = validPubkeys.filter(p => {
      const normalized = p.toLowerCase();
      return !metadataMap[normalized];
    });
    
    // CRITICAL: Only subscribe if:
    // 1. First render, OR
    // 2. Key changed AND there are missing pubkeys, OR
    // 3. Key didn't change BUT there are new missing pubkeys (pubkeys list grew)
    // This prevents re-subscribing for ALL pubkeys when only a few new ones are added
    if (shouldSkip && missingFromCache.length === 0) {
      // Same content and all metadata is cached, skip re-subscription to prevent render loops
      return;
    }
    
    // CRITICAL: If key didn't change but we have missing pubkeys, only subscribe for the missing ones
    // This prevents re-subscribing for hundreds of pubkeys when only a few are new
    const pubkeysToSubscribe = (!keyChanged && missingFromCache.length > 0 && missingFromCache.length < validPubkeys.length / 2)
      ? missingFromCache  // Only subscribe for missing ones if they're a small subset
      : validPubkeys;     // Otherwise subscribe for all (first render or major change)
    
    console.log(`🔍 [useContributorMetadata] Hook called with ${pubkeys.length} pubkeys`, {
      hasSubscribe: !!subscribe,
      hasRelays: !!defaultRelays && defaultRelays.length > 0,
      relayCount: defaultRelays?.length || 0,
      pubkeysLength: pubkeys.length,
      pubkeysKey,
      cachedKey: pubkeysKeyRef.current,
      isFirstRender,
      shouldSkip,
      missingFromCache: missingFromCache.length,
      validPubkeys: validPubkeys.length
    });
    
    if (!subscribe || pubkeys.length === 0) {
      console.log(`⏭️ [useContributorMetadata] Skipping subscription: subscribe=${!!subscribe}, pubkeys.length=${pubkeys.length}`);
      return;
    }
    if (invalidPubkeys.length > 0) {
      console.error('❌ [useContributorMetadata] INVALID PUBKEYS DETECTED:', {
        invalidCount: invalidPubkeys.length,
        invalidPubkeys: invalidPubkeys.slice(0, 5).map(p => ({
          value: p,
          length: p.length,
          isNpub: p.startsWith('npub'),
          isShort: p.length === 8
        }))
      });
    }
    
    console.log(`📡 [useContributorMetadata] Subscribing for ${pubkeysToSubscribe.length} pubkeys (${missingFromCache.length} missing from cache, ${validPubkeys.length} total)`, {
      validPubkeys: validPubkeys.length,
      pubkeysToSubscribe: pubkeysToSubscribe.length,
      missingFromCache: missingFromCache.length,
      invalidPubkeys: invalidPubkeys.length,
      keyChanged,
      isFirstRender,
      samplePubkeys: pubkeysToSubscribe.slice(0, 3).map(p => ({
        short: p.slice(0, 8),
        length: p.length,
        isValid: /^[0-9a-f]{64}$/i.test(p)
      })),
      RELAYS_COUNT: allRelays?.length || 0,
      DEFAULT_RELAYS_COUNT: defaultRelays?.length || 0,
      USER_RELAYS_COUNT: (allRelays?.length || 0) - (defaultRelays?.length || 0)
    });

    if (pubkeysToSubscribe.length === 0) {
      console.warn('⚠️ [useContributorMetadata] No pubkeys to subscribe for!');
      return;
    }

    // Set timeout to stop waiting for relays after 15 seconds (increased for more relays)
    const timeout = setTimeout(() => {
      console.log("Metadata fetch timeout after 15s");
    }, 15000);

    let unsub: (() => void) | undefined;
    
    try {
      unsub = subscribe(
        [
          {
            kinds: [0],
            authors: pubkeysToSubscribe, // CRITICAL: Only subscribe for pubkeys that need metadata
          },
        ],
        defaultRelays,
        (event, isAfterEose, relayURL) => {
          // Process ALL metadata events (even after EOSE - some relays send delayed events)
          if (event.kind === 0) {
            const normalizedPubkey = event.pubkey.toLowerCase();
            const isTargetPubkey = pubkeysToSubscribe.some(p => p.toLowerCase() === normalizedPubkey);
            console.log(`🔵 [useContributorMetadata] Processing kind 0 event from ${relayURL} for pubkey ${normalizedPubkey.slice(0, 8)}`, {
              isTargetPubkey,
              isAfterEose,
              created_at: event.created_at,
              tagsCount: event.tags?.length || 0,
              iTags: event.tags?.filter((t: any) => Array.isArray(t) && t[0] === 'i') || []
            });
            try {
              const data = JSON.parse(event.content) as Metadata;
              
              // Debug: Log banner field if present
              if (data.banner) {
                console.log(`🖼️ [useContributorMetadata] Banner found for ${normalizedPubkey.slice(0, 8)}: ${data.banner.substring(0, 50)}...`);
              } else {
                console.log(`⚠️ [useContributorMetadata] No banner field in metadata for ${normalizedPubkey.slice(0, 8)}. Keys: ${Object.keys(data).join(', ')}`);
              }
              
              // Parse NIP-39 identity claims from i tags
              const identities: ClaimedIdentity[] = [];
              if (event.tags && Array.isArray(event.tags)) {
                for (const tag of event.tags) {
                  if (Array.isArray(tag) && tag.length >= 2 && tag[0] === "i") {
                    // NIP-39 format: ["i", "platform:identity", "proof"]
                    const identityString = tag[1];
                    const proof = tag[2] || undefined;
                    
                    if (identityString && typeof identityString === "string") {
                      const parts = identityString.split(":");
                      if (parts.length >= 2 && parts[0]) {
                        const platform = parts[0];
                        const identity = parts.slice(1).join(":"); // Handle identities with colons
                        if (platform && identity) {
                          identities.push({
                            platform,
                            identity,
                            proof,
                            verified: false, // TODO: Verify proof (fetch Gist, check content, etc.)
                          });
                        }
                      }
                    }
                  }
                }
              }
              
              // Add identities to metadata if any were found
              if (identities.length > 0) {
                data.identities = identities;
                console.log(`✅ [useContributorMetadata] Found ${identities.length} identities in event:`, identities.map(i => `${i.platform}:${i.identity}`));
              } else {
                console.log(`⚠️ [useContributorMetadata] No identities found in event tags (${event.tags?.length || 0} total tags)`);
              }
              
              // CRITICAL: Normalize pubkey to lowercase for consistent lookup (already defined above)
              setMetadataMap((prev) => {
                // Always use the latest metadata (newer created_at wins)
                const existing = prev[normalizedPubkey];
                const newTime = event.created_at;
                
                if (existing && existing.created_at) {
                  // If we have existing metadata with timestamp, compare
                  const existingTime = existing.created_at;
                  if (newTime > existingTime) {
                    // Newer metadata wins - but merge identities if new one doesn't have them
                    const mergedData = { ...data, created_at: newTime };
                    // If new event has identities, use them. Otherwise, keep existing ones if they exist
                    if (!mergedData.identities || mergedData.identities.length === 0) {
                      if (existing.identities && existing.identities.length > 0) {
                        mergedData.identities = existing.identities;
                        console.log(`🔄 [useContributorMetadata] Merged ${existing.identities.length} identities from older event (newer event has no identities)`);
                      }
                    } else {
                      // New event HAS identities - log this for debugging
                      console.log(`✅ [useContributorMetadata] Newer event has ${mergedData.identities.length} identities, using them`);
                    }
                    return {
                      ...prev,
                      [normalizedPubkey]: mergedData,
                    };
                  } else if (newTime === existingTime) {
                    // Same timestamp - merge identities from both
                    const mergedData = { ...data, created_at: newTime };
                    const existingIdentities = existing.identities || [];
                    const newIdentities = mergedData.identities || [];
                    // Combine and deduplicate identities
                    const combinedIdentities = [...existingIdentities];
                    for (const newId of newIdentities) {
                      const exists = combinedIdentities.some(
                        (e: ClaimedIdentity) => e.platform === newId.platform && e.identity === newId.identity
                      );
                      if (!exists) {
                        combinedIdentities.push(newId);
                      }
                    }
                    if (combinedIdentities.length > 0) {
                      mergedData.identities = combinedIdentities;
                      console.log(`🔄 [useContributorMetadata] Merged identities from events with same timestamp: ${combinedIdentities.length} total`);
                    }
                    return {
                      ...prev,
                      [normalizedPubkey]: mergedData,
                    };
                  }
                  // Older event - keep existing but merge identities if existing doesn't have them
                  if (!existing.identities || existing.identities.length === 0) {
                    if (data.identities && data.identities.length > 0) {
                      const updatedExisting = { ...existing, identities: data.identities };
                      console.log(`🔄 [useContributorMetadata] Merged ${data.identities.length} identities from newer event into older cached metadata`);
                      return {
                        ...prev,
                        [normalizedPubkey]: updatedExisting,
                      };
                    }
                  }
                  return prev; // Keep existing
                }
                // No existing metadata or no timestamp - use new one
                // normalizedPubkey already defined above
                return {
                  ...prev,
                  [normalizedPubkey]: { ...data, created_at: event.created_at },
                };
              });
              console.log(`✅ [useContributorMetadata] Received metadata for ${event.pubkey.toLowerCase().slice(0, 8)} (stored as lowercase)${identities.length > 0 ? ` with ${identities.length} claimed identities` : ""}`);
            } catch (e) {
              console.error("Failed to parse metadata:", e, "Content:", event.content?.slice(0, 100));
            }
          } else {
            console.log(`⚠️ [useContributorMetadata] Received non-kind-0 event: kind=${event.kind}, pubkey=${event.pubkey.slice(0, 8)}`);
          }
        },
        undefined,
        (events, relayURL) => {
          // EOSE from this relay - but don't clear timeout yet, wait for all relays
          // CRITICAL: Only log first EOSE to reduce console spam (multiple relays = multiple EOSE messages)
          // Metadata fetching is less critical than file fetching, so we can be quieter
        }
      );
    } catch (error) {
      console.error("Failed to subscribe for metadata:", error);
      clearTimeout(timeout);
    }

    return () => {
      console.log(`🔄 [useContributorMetadata] Cleaning up subscription for ${validPubkeys.length} pubkeys`);
      clearTimeout(timeout);
      if (subscriptionTimeoutRef.current) {
        clearTimeout(subscriptionTimeoutRef.current);
        subscriptionTimeoutRef.current = null;
      }
      if (unsub) {
        console.log(`🔄 [useContributorMetadata] Unsubscribing...`);
        unsub();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscribe, pubkeysKey, allRelays.join(',')]); // Use allRelays instead of defaultRelays

  // Track last saved metadata to prevent unnecessary saves
  const lastSavedMetadataRef = useRef<string>("");
  const isProcessingStorageRef = useRef<boolean>(false);
  const metadataMapRef = useRef<Record<string, Metadata>>(metadataMap);
  
  // Keep ref in sync with metadataMap
  useEffect(() => {
    metadataMapRef.current = metadataMap;
  }, [metadataMap]);
  
  // Save metadata to cache whenever it changes (debounced)
  // CRITICAL: Only save if content actually changed, not just reference
  // Use useMemo to avoid expensive JSON.stringify on every render
  const metadataMapKey = useMemo(() => {
    if (Object.keys(metadataMap).length === 0) {
      return "";
    }
    // Create a stable key from sorted pubkeys and their timestamps
    const entries = Object.entries(metadataMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([pubkey, meta]) => `${pubkey}:${meta.created_at || 0}`)
      .join("|");
    return entries;
  }, [metadataMap]);
  
  useEffect(() => {
    // Skip if we're processing a storage event (prevent loops)
    if (isProcessingStorageRef.current || isSaving) {
      return;
    }
    
    if (metadataMapKey === "" || metadataMapKey === lastSavedMetadataRef.current) {
      return;
    }
    
    // Only save if content actually changed - use ref to get latest value
    saveMetadataCache(metadataMapRef.current);
    lastSavedMetadataRef.current = metadataMapKey;
  }, [metadataMapKey]); // Only depend on metadataMapKey, not metadataMap

  // Listen to storage events to sync with cache updates from other pages (e.g., explore page)
  // CRITICAL: Only process storage events from OTHER pages, not our own saves
  // ALSO listen to custom events for same-tab updates (e.g., profile settings page)
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      // Skip if we're currently saving (prevent recursive updates)
      if (isSaving) {
        return;
      }
      
      if (e.key === METADATA_CACHE_KEY && e.newValue) {
        try {
          isProcessingStorageRef.current = true; // Mark as processing to prevent re-save
          
          const newCache = JSON.parse(e.newValue) as Record<string, Metadata>;
          
          // CRITICAL: Normalize all keys to lowercase for consistent lookup
          const normalizedCache: Record<string, Metadata> = {};
          for (const [key, value] of Object.entries(newCache)) {
            normalizedCache[key.toLowerCase()] = value;
          }
          
          // Only update if we actually get new data (prevent loops)
          setMetadataMap((prev) => {
            let updated = { ...prev };
            let hasChanges = false;
            
            for (const [pubkey, cachedMeta] of Object.entries(normalizedCache)) {
              const existing = prev[pubkey];
              const cachedTime = cachedMeta.created_at || 0;
              const existingTime = existing?.created_at || 0;
              
              // Use cached metadata if it's newer or if we don't have it
              if (!existing || cachedTime > existingTime) {
                updated[pubkey] = cachedMeta;
                hasChanges = true;
              }
            }
            
            // Only update if there are actual changes
            if (hasChanges) {
              // Update last saved ref to prevent re-saving
              const newKey = Object.entries(updated)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([pubkey, meta]) => `${pubkey}:${meta.created_at || 0}`)
                .join("|");
              lastSavedMetadataRef.current = newKey;
              return updated;
            }
            
            return prev;
          });
          
          // Reset processing flag after state update
          setTimeout(() => {
            isProcessingStorageRef.current = false;
          }, 100);
        } catch (err) {
          console.error("❌ [useContributorMetadata] Failed to parse cache update", err);
          isProcessingStorageRef.current = false;
        }
      }
    };
    
    // Handle storage events (from other tabs)
    window.addEventListener("storage", handleStorageChange);
    
    // Handle custom events (from same tab - e.g., profile settings page)
    const handleMetadataCacheUpdate = (e: CustomEvent) => {
      // Skip if we're currently saving (prevent recursive updates)
      if (isSaving) {
        return;
      }
      
      const { pubkey, metadata } = e.detail || {};
      if (!pubkey || !metadata) return;
      
      const normalizedPubkey = pubkey.toLowerCase();
      
      // CRITICAL: Reload cache from localStorage to get the latest data
      // This ensures we get the updated metadata that was just saved
      try {
        const updatedCache = loadMetadataCache();
        
        // Update state with the new cache data
        setMetadataMap(prev => {
          // Merge with existing to preserve other entries
          const merged = { ...prev, ...updatedCache };
          
          // Ensure the updated pubkey is included
          if (updatedCache[normalizedPubkey]) {
            merged[normalizedPubkey] = updatedCache[normalizedPubkey];
          }
          
          console.log(`🔄 [useContributorMetadata] Refreshed metadata cache from same-tab update for ${normalizedPubkey.slice(0, 8)}`);
          return merged;
        });
      } catch (err) {
        console.error("❌ [useContributorMetadata] Failed to refresh cache from custom event:", err);
      }
    };
    
    window.addEventListener("gittr:metadata-cache-updated", handleMetadataCacheUpdate as EventListener);
    
    return () => {
      window.removeEventListener("storage", handleStorageChange);
      window.removeEventListener("gittr:metadata-cache-updated", handleMetadataCacheUpdate as EventListener);
    };
  }, []);

  // Memoize return value to prevent unnecessary re-renders when content hasn't changed
  // Only create new object reference when metadataMap content actually changes
  const memoizedMetadata = useMemo(() => {
    return metadataMap;
  }, [metadataMapKey]); // Depend on the stable key, not the object reference
  
  return memoizedMetadata;
}

