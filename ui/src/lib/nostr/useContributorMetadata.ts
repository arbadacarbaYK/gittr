import { useEffect, useMemo, useRef, useState } from "react";

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

/** Set `localStorage.gittr_verbose_contributor_meta = "1"` for noisy subscription / kind-0 logs. */
function contributorMetaVerbose(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return (
      window.localStorage.getItem("gittr_verbose_contributor_meta") === "1"
    );
  } catch {
    return false;
  }
}

// Module-level cache to avoid loading from localStorage on every hook call
let moduleCache: Record<string, Metadata> | null = null;
let cacheLoadTime = 0;
const CACHE_REFRESH_INTERVAL = 5000; // Refresh cache every 5 seconds if needed

// Load metadata from localStorage cache (cached at module level)
function loadMetadataCache(): Record<string, Metadata> {
  if (typeof window === "undefined") return {};

  // Return cached version if it's fresh enough
  const now = Date.now();
  if (moduleCache !== null && now - cacheLoadTime < CACHE_REFRESH_INTERVAL) {
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
      if (
        contributorMetaVerbose() &&
        (moduleCache === null ||
          Math.abs(
            Object.keys(normalized).length - Object.keys(moduleCache).length
          ) > 10)
      ) {
        console.log(
          `📦 [useContributorMetadata] Loaded ${
            Object.keys(normalized).length
          } cached metadata entries (normalized to lowercase)`
        );
      }
      moduleCache = normalized;
      cacheLoadTime = now;
      return normalized;
    }
  } catch (err) {
    console.error(
      "❌ [useContributorMetadata] Failed to load cached metadata",
      err
    );
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
        localStorage.setItem(
          METADATA_CACHE_KEY,
          JSON.stringify(pendingMetadata)
        );
        // Invalidate module cache so it reloads on next access
        invalidateModuleCache();
        if (
          contributorMetaVerbose() &&
          Object.keys(pendingMetadata).length > 0 &&
          Object.keys(pendingMetadata).length % 10 === 0
        ) {
          console.log(
            `💾 [useContributorMetadata] Saved ${
              Object.keys(pendingMetadata).length
            } metadata entries to cache`
          );
        }
        // Reset flag after a short delay to allow storage events to process
        setTimeout(() => {
          isSaving = false;
        }, 200);
      } catch (err) {
        console.error(
          "❌ [useContributorMetadata] Failed to save metadata cache",
          err
        );
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
  // CRITICAL: On server and initial client render, return empty object to prevent hydration mismatches
  // Only load from localStorage after mount (client-side only)
  const [metadataMap, setMetadataMap] = useState<Record<string, Metadata>>(
    () => {
      // On server, always return empty object
      if (typeof window === "undefined") return {};
      // On client, return empty object initially, will load after mount
      return {};
    }
  );

  // Load from localStorage after mount to prevent hydration mismatches
  // CRITICAL: Invalidate module cache on mount to force fresh check from localStorage
  // This ensures we get the latest cache data, not stale module-level cache
  useEffect(() => {
    // Invalidate module cache to force fresh load from localStorage
    invalidateModuleCache();
    const cached = loadMetadataCache();
    if (Object.keys(cached).length > 0) {
      setMetadataMap(cached);
      if (contributorMetaVerbose()) {
        console.log(
          `📦 [useContributorMetadata] Loaded ${
            Object.keys(cached).length
          } metadata entries from cache on mount`
        );
      }
    }
  }, []);
  // Memoize pubkeysKey to prevent unnecessary re-renders - use stable string comparison
  // CRITICAL: Only recompute when actual pubkey content changes, not array reference
  const pubkeysKeyRef = useRef<string>("");
  const lastSubscriptionTimeRef = useRef<number>(0);
  const subscriptionTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const hasFetchedOnMountRef = useRef<boolean>(false);
  /** Bumped by debounce timer so a deferred subscribe actually runs. */
  const [subscribeTick, setSubscribeTick] = useState(0);
  const pubkeysKey = useMemo(() => {
    if (pubkeys.length === 0) return "";
    return pubkeys.slice().sort().join(",");
  }, [pubkeys.length, pubkeys.join(",")]);

  useEffect(() => {
    const previousKey = pubkeysKeyRef.current;
    const keyChanged = previousKey !== pubkeysKey;
    const wasEmpty = previousKey === "";
    const isNowNonEmpty = pubkeysKey !== "" && keyChanged;

    if (contributorMetaVerbose()) {
      console.log(`🔄 [useContributorMetadata] useEffect triggered:`, {
        pubkeysLength: pubkeys.length,
        keyChanged,
        wasEmpty,
        isNowNonEmpty,
        subscribeTick,
      });
    }

    if (subscriptionTimeoutRef.current) {
      clearTimeout(subscriptionTimeoutRef.current);
      subscriptionTimeoutRef.current = null;
    }

    if (!subscribe) {
      return;
    }

    const validPubkeys = pubkeys.filter((p) => /^[0-9a-f]{64}$/i.test(p));
    if (validPubkeys.length === 0) {
      pubkeysKeyRef.current = pubkeysKey;
      return;
    }

    // Paint from cache immediately — do NOT invalidate module cache every run
    // (that forced constant “cache miss” refetches and cancelled in-flight batches).
    const currentCache = loadMetadataCache();
    if (Object.keys(currentCache).length > 0) {
      setMetadataMap((prev) => {
        const merged = { ...prev, ...currentCache };
        return Object.keys(merged).length > Object.keys(prev).length
          ? merged
          : prev;
      });
    }

    const missingFromCache = validPubkeys.filter((p) => {
      const normalized = p.toLowerCase();
      return !metadataMap[normalized] && !currentCache[normalized];
    });

    // Warm cache: mark key handled and skip relay work (still merge cache above).
    if (missingFromCache.length === 0) {
      pubkeysKeyRef.current = pubkeysKey;
      hasFetchedOnMountRef.current = true;
      return;
    }

    // Only fetch missing pubkeys when the list grows — never re-fetch everyone.
    const pubkeysToSubscribe = missingFromCache;

    const now = Date.now();
    const timeSinceLastSubscription = now - lastSubscriptionTimeRef.current;
    const DEBOUNCE_MS = 800;
    if (
      timeSinceLastSubscription < DEBOUNCE_MS &&
      lastSubscriptionTimeRef.current > 0 &&
      !(wasEmpty && isNowNonEmpty)
    ) {
      const wait = DEBOUNCE_MS - timeSinceLastSubscription;
      if (contributorMetaVerbose()) {
        console.log(
          `⏭️ [useContributorMetadata] Debouncing ${wait}ms then retry`
        );
      }
      subscriptionTimeoutRef.current = setTimeout(() => {
        setSubscribeTick((t) => t + 1);
      }, wait);
      return;
    }

    lastSubscriptionTimeRef.current = now;
    // CRITICAL: remember this key so growth only fetches *new* missing pubkeys
    // and does not thrash (cancel) in-flight batches forever.
    pubkeysKeyRef.current = pubkeysKey;
    hasFetchedOnMountRef.current = true;

    if (contributorMetaVerbose()) {
      console.log(
        `🔍 [useContributorMetadata] Fetching ${pubkeysToSubscribe.length}/${validPubkeys.length} missing profiles`,
        { keyChanged, cached: Object.keys(currentCache).length }
      );
    }

    // Fast path: server-side batch (browser WS to many relays often fills ~0 profiles).
    const httpAbort = { cancelled: false };
    void (async () => {
      try {
        const httpBatches: string[][] = [];
        for (let i = 0; i < pubkeysToSubscribe.length; i += 80) {
          httpBatches.push(pubkeysToSubscribe.slice(i, i + 80));
        }
        for (const batch of httpBatches) {
          if (httpAbort.cancelled) return;
          const res = await fetch("/api/nostr/profiles", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pubkeys: batch }),
          });
          if (!res.ok) continue;
          const data = (await res.json()) as {
            profiles?: Record<string, Metadata>;
          };
          const profiles = data.profiles || {};
          if (Object.keys(profiles).length === 0) continue;
          setMetadataMap((prev) => {
            const next = { ...prev };
            for (const [pk, meta] of Object.entries(profiles)) {
              const key = pk.toLowerCase();
              const existing = next[key];
              if (
                !existing ||
                (meta.created_at || 0) >= (existing.created_at || 0)
              ) {
                next[key] = { ...meta, created_at: meta.created_at };
              }
            }
            saveMetadataCache(next);
            return next;
          });
        }
      } catch (e) {
        if (contributorMetaVerbose()) {
          console.warn("[useContributorMetadata] HTTP profiles failed:", e);
        }
      }
    })();

    // Batch subscriptions — snappier than 25@500ms once thrash is fixed
    const BATCH_SIZE = 40;
    const BATCH_DELAY_MS = 200;

    // Split pubkeys into batches (WS supplement while HTTP runs in parallel)
    const batches: string[][] = [];
    for (let i = 0; i < pubkeysToSubscribe.length; i += BATCH_SIZE) {
      batches.push(pubkeysToSubscribe.slice(i, i + BATCH_SIZE));
    }

    if (contributorMetaVerbose()) {
      console.log(
        `📦 [useContributorMetadata] Batching ${pubkeysToSubscribe.length} pubkeys into ${batches.length} batches of ${BATCH_SIZE}`
      );
    }

    const unsubs: (() => void)[] = [];
    const timeouts: NodeJS.Timeout[] = [];

    // Subscribe to each batch with progressive delays
    batches.forEach((batch, batchIndex) => {
      const batchTimeout = setTimeout(() => {
        try {
          const batchUnsub = subscribe(
            [
              {
                kinds: [0],
                authors: batch, // Subscribe to this batch of pubkeys
              },
            ],
            allRelays.length > 0 ? allRelays : defaultRelays,
            (event, isAfterEose, relayURL) => {
              // Process ALL metadata events (even after EOSE - some relays send delayed events)
              if (event.kind === 0) {
                const normalizedPubkey = event.pubkey.toLowerCase();
                const isTargetPubkey = batch.some(
                  (p) => p.toLowerCase() === normalizedPubkey
                );
                // Reduced logging to prevent console spam when processing many events
                if (
                  contributorMetaVerbose() &&
                  (batchIndex === 0 || isTargetPubkey)
                ) {
                  console.log(
                    `🔵 [useContributorMetadata] Processing kind 0 event from ${relayURL} for pubkey ${normalizedPubkey.slice(
                      0,
                      8
                    )} (batch ${batchIndex + 1}/${batches.length})`,
                    {
                      isTargetPubkey,
                      isAfterEose,
                      created_at: event.created_at,
                      tagsCount: event.tags?.length || 0,
                      iTags:
                        event.tags?.filter(
                          (t: any) => Array.isArray(t) && t[0] === "i"
                        ) || [],
                    }
                  );
                }
                try {
                  const data = JSON.parse(event.content) as Metadata;

                  // Debug: Log banner field if present (only for first batch to reduce spam)
                  if (
                    contributorMetaVerbose() &&
                    batchIndex === 0 &&
                    data.banner
                  ) {
                    console.log(
                      `🖼️ [useContributorMetadata] Banner found for ${normalizedPubkey.slice(
                        0,
                        8
                      )}: ${data.banner.substring(0, 50)}...`
                    );
                  }

                  // Parse NIP-39 identity claims from i tags
                  const identities: ClaimedIdentity[] = [];
                  if (event.tags && Array.isArray(event.tags)) {
                    for (const tag of event.tags) {
                      if (
                        Array.isArray(tag) &&
                        tag.length >= 2 &&
                        tag[0] === "i"
                      ) {
                        // NIP-39 format: ["i", "platform:identity", "proof"]
                        const identityString = tag[1];
                        const proof = tag[2] || undefined;

                        if (
                          identityString &&
                          typeof identityString === "string"
                        ) {
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
                    // Only log identities for first batch to reduce console spam
                    if (contributorMetaVerbose() && batchIndex === 0) {
                      console.log(
                        `✅ [useContributorMetadata] Found ${identities.length} identities in event:`,
                        identities.map((i) => `${i.platform}:${i.identity}`)
                      );
                    }
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
                        if (
                          !mergedData.identities ||
                          mergedData.identities.length === 0
                        ) {
                          if (
                            existing.identities &&
                            existing.identities.length > 0
                          ) {
                            mergedData.identities = existing.identities;
                            console.log(
                              `🔄 [useContributorMetadata] Merged ${existing.identities.length} identities from older event (newer event has no identities)`
                            );
                          }
                        } else {
                          // New event HAS identities - log this for debugging
                          if (contributorMetaVerbose()) {
                            console.log(
                              `✅ [useContributorMetadata] Newer event has ${mergedData.identities.length} identities, using them`
                            );
                          }
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
                            (e: ClaimedIdentity) =>
                              e.platform === newId.platform &&
                              e.identity === newId.identity
                          );
                          if (!exists) {
                            combinedIdentities.push(newId);
                          }
                        }
                        if (combinedIdentities.length > 0) {
                          mergedData.identities = combinedIdentities;
                          if (contributorMetaVerbose()) {
                            console.log(
                              `🔄 [useContributorMetadata] Merged identities from events with same timestamp: ${combinedIdentities.length} total`
                            );
                          }
                        }
                        return {
                          ...prev,
                          [normalizedPubkey]: mergedData,
                        };
                      }
                      // Older event - keep existing but merge identities if existing doesn't have them
                      if (
                        !existing.identities ||
                        existing.identities.length === 0
                      ) {
                        if (data.identities && data.identities.length > 0) {
                          const updatedExisting = {
                            ...existing,
                            identities: data.identities,
                          };
                          console.log(
                            `🔄 [useContributorMetadata] Merged ${data.identities.length} identities from newer event into older cached metadata`
                          );
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
                      [normalizedPubkey]: {
                        ...data,
                        created_at: event.created_at,
                      },
                    };
                  });
                  // Only log for first batch to reduce console spam
                  if (contributorMetaVerbose() && batchIndex === 0) {
                    console.log(
                      `✅ [useContributorMetadata] Received metadata for ${event.pubkey
                        .toLowerCase()
                        .slice(0, 8)} (stored as lowercase)${
                        identities.length > 0
                          ? ` with ${identities.length} claimed identities`
                          : ""
                      }`
                    );
                  }
                } catch (e) {
                  console.error(
                    "Failed to parse metadata:",
                    e,
                    "Content:",
                    event.content?.slice(0, 100)
                  );
                }
              } else {
                // Only log non-kind-0 events for first batch
                if (contributorMetaVerbose() && batchIndex === 0) {
                  console.log(
                    `⚠️ [useContributorMetadata] Received non-kind-0 event: kind=${
                      event.kind
                    }, pubkey=${event.pubkey.slice(0, 8)}`
                  );
                }
              }
            },
            undefined,
            (events, relayURL) => {
              // EOSE from this relay - but don't clear timeout yet, wait for all relays
              // CRITICAL: Only log first EOSE to reduce console spam (multiple relays = multiple EOSE messages)
              // Metadata fetching is less critical than file fetching, so we can be quieter
            }
          );
          unsubs.push(batchUnsub);
          // Log batch subscription progress
          if (
            contributorMetaVerbose() &&
            (batchIndex === 0 ||
              (batchIndex + 1) % 2 === 0 ||
              batchIndex === batches.length - 1)
          ) {
            console.log(
              `✅ [useContributorMetadata] Subscribed to batch ${
                batchIndex + 1
              }/${batches.length} (${batch.length} pubkeys)`
            );
          }
        } catch (error) {
          console.error(
            `❌ [useContributorMetadata] Failed to subscribe for batch ${
              batchIndex + 1
            }:`,
            error
          );
        }
      }, batchIndex * BATCH_DELAY_MS); // Progressive delay: 0ms, 500ms, 1000ms, etc.

      timeouts.push(batchTimeout);
    });

    // Set overall timeout to stop waiting after 30 seconds (increased for batched subscriptions)
    const overallTimeout = setTimeout(() => {
      if (contributorMetaVerbose()) {
        console.log(
          `⏱️ [useContributorMetadata] Overall metadata fetch timeout after 30s (${batches.length} batches)`
        );
      }
    }, 30000);
    timeouts.push(overallTimeout);

    return () => {
      httpAbort.cancelled = true;
      // Clean up all batch subscriptions and timeouts
      if (contributorMetaVerbose()) {
        console.log(
          `🔄 [useContributorMetadata] Cleaning up ${unsubs.length} batch subscriptions`
        );
      }
      timeouts.forEach((timeout) => clearTimeout(timeout));
      if (subscriptionTimeoutRef.current) {
        clearTimeout(subscriptionTimeoutRef.current);
        subscriptionTimeoutRef.current = null;
      }
      unsubs.forEach((unsub) => {
        try {
          unsub();
        } catch (error) {
          console.error("Error unsubscribing batch:", error);
        }
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscribe, pubkeysKey, allRelays.join(","), subscribeTick]);

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

    if (
      metadataMapKey === "" ||
      metadataMapKey === lastSavedMetadataRef.current
    ) {
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
            const updated = { ...prev };
            let hasChanges = false;

            for (const [pubkey, cachedMeta] of Object.entries(
              normalizedCache
            )) {
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
          console.error(
            "❌ [useContributorMetadata] Failed to parse cache update",
            err
          );
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
        setMetadataMap((prev) => {
          // Merge with existing to preserve other entries
          const merged = { ...prev, ...updatedCache };

          // Ensure the updated pubkey is included
          if (updatedCache[normalizedPubkey]) {
            merged[normalizedPubkey] = updatedCache[normalizedPubkey];
          }

          if (contributorMetaVerbose()) {
            console.log(
              `🔄 [useContributorMetadata] Refreshed metadata cache from same-tab update for ${normalizedPubkey.slice(
                0,
                8
              )}`
            );
          }
          return merged;
        });
      } catch (err) {
        console.error(
          "❌ [useContributorMetadata] Failed to refresh cache from custom event:",
          err
        );
      }
    };

    window.addEventListener(
      "gittr:metadata-cache-updated",
      handleMetadataCacheUpdate as EventListener
    );

    return () => {
      window.removeEventListener("storage", handleStorageChange);
      window.removeEventListener(
        "gittr:metadata-cache-updated",
        handleMetadataCacheUpdate as EventListener
      );
    };
  }, []);

  // Memoize return value to prevent unnecessary re-renders when content hasn't changed
  // Only create new object reference when metadataMap content actually changes
  const memoizedMetadata = useMemo(() => {
    return metadataMap;
  }, [metadataMapKey]); // Depend on the stable key, not the object reference

  return memoizedMetadata;
}
