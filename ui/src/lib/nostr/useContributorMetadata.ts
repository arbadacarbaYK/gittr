import { useEffect, useMemo, useRef, useState } from "react";

import { useNostrContext } from "./NostrContext";
import { getAllRelays } from "./getAllRelays";
import {
  applyKind0NameFields,
  pickProfileDisplayName,
} from "./kind0-profile-fields";
import { mergeKind0OntoExisting as mergeKind0OntoExistingHelper } from "./kind0-merge";
import {
  KIND_NIP39_IDENTITIES,
  parseNip39ITags,
  preferNip39Identities,
} from "./nip39-identities";

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
const METADATA_CACHE_SAVED_AT_KEY = `${METADATA_CACHE_KEY}_saved_at`;
// localStorage cache is best-effort. We refresh periodically so replaceable
// kind-0 updates (like LUD-16 changes) don't get stuck forever.
const LOCAL_STORAGE_CACHE_MAX_AGE_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Pubkeys we already tried to fetch this page session.
 * Prevents infinite refetch for people with genuinely empty kind-0 names,
 * while still allowing a one-shot refresh when cache only has identities /
 * empty stubs (common Firefox poison after kind-10011-only events).
 */
const profileFetchAttempted = new Set<string>();

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

/** True when cache has a real display name — not just identities or empty stubs. */
function hasUsableProfileName(meta?: Metadata | null): boolean {
  return !!pickProfileDisplayName(meta);
}

/** Lightning receive fields used for zaps / invoices. */
function hasPaymentReceiveFields(meta?: Metadata | null): boolean {
  if (!meta) return false;
  return !!(meta.lud16?.trim() || meta.lnurl?.trim() || meta.nwcRecv?.trim());
}

/**
 * Merge kind-0 / HTTP profile onto an existing entry.
 * Incomplete stubs (kind 10011 identities-only) must always accept name/picture
 * even when their stamped created_at is newer than kind 0 — that was poisoning
 * Firefox so the UI kept showing the raw npub.
 */
export function mergeKind0OntoExisting(
  existing: Metadata | undefined,
  incoming: Metadata,
  incomingCreatedAt?: number
): Metadata {
  return mergeKind0OntoExistingHelper(existing, incoming, incomingCreatedAt);

  incoming = applyKind0NameFields(incoming);
  const incomingTime = incomingCreatedAt ?? incoming.created_at ?? 0;
  const existingTime = existing?.created_at ?? 0;
  const existingIncomplete = !hasUsableProfileName(existing);
  const incomingHasName = hasUsableProfileName(incoming);

  const preferIncoming =
    !existing ||
    existingIncomplete ||
    (incomingHasName && incomingTime >= existingTime) ||
    (!existingIncomplete && incomingTime > existingTime);

  const base = preferIncoming
    ? { ...existing, ...incoming }
    : { ...incoming, ...existing };

  const existingIdentities = existing?.identities;
  const identities =
    Array.isArray(existingIdentities) && existingIdentities.length > 0
      ? existingIdentities
      : Array.isArray(incoming.identities) && incoming.identities.length > 0
        ? incoming.identities
        : undefined;

  const created_at = Math.max(existingTime, incomingTime) || undefined;

  const next: Metadata = {
    ...base,
    created_at,
  };
  if (identities) next.identities = identities;
  else delete (next as { identities?: unknown }).identities;

  // If we kept an incomplete existing as "newer", still fill missing name fields.
  if (!hasUsableProfileName(next) && incomingHasName) {
    if (incoming.name) next.name = incoming.name;
    if (incoming.display_name) next.display_name = incoming.display_name;
    if (incoming.picture) next.picture = incoming.picture;
    if (incoming.banner) next.banner = incoming.banner;
    if (incoming.about) next.about = incoming.about;
    if (incoming.nip05) next.nip05 = incoming.nip05;
    if (incoming.website) next.website = incoming.website;
  }

  // Payment fields are replaceable updates (LUD-16, lnurl, NWC receive). A
  // cached old value must not permanently hide a newer kind-0 update.
  const shouldReplacePayments = incomingTime >= existingTime;

  if (typeof incoming.lud16 === "string") {
    if (shouldReplacePayments) {
      const trimmed = incoming.lud16.trim();
      if (trimmed) next.lud16 = trimmed;
      else delete next.lud16;
    } else {
      const trimmedExisting =
        typeof existing?.lud16 === "string" ? existing.lud16.trim() : "";
      if (trimmedExisting) next.lud16 = trimmedExisting;
      else delete next.lud16;
    }
  }

  if (typeof incoming.lnurl === "string") {
    if (shouldReplacePayments) {
      const trimmed = incoming.lnurl.trim();
      if (trimmed) next.lnurl = trimmed;
      else delete next.lnurl;
    } else {
      const trimmedExisting =
        typeof existing?.lnurl === "string" ? existing.lnurl.trim() : "";
      if (trimmedExisting) next.lnurl = trimmedExisting;
      else delete next.lnurl;
    }
  }

  if (typeof incoming.nwcRecv === "string") {
    if (shouldReplacePayments) {
      const trimmed = incoming.nwcRecv.trim();
      if (trimmed) next.nwcRecv = trimmed;
      else delete next.nwcRecv;
    } else {
      const trimmedExisting =
        typeof existing?.nwcRecv === "string" ? existing.nwcRecv.trim() : "";
      if (trimmedExisting) next.nwcRecv = trimmedExisting;
      else delete next.nwcRecv;
    }
  }

  return next;
}

async function fetchProfilesHttp(
  pubkeys: string[]
): Promise<Record<string, Metadata>> {
  if (pubkeys.length === 0) return {};
  const out: Record<string, Metadata> = {};
  for (let i = 0; i < pubkeys.length; i += 80) {
    const batch = pubkeys.slice(i, i + 80);
    try {
      const res = await fetch("/api/nostr/profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pubkeys: batch }),
      });
      if (!res.ok) continue;
      const data = (await res.json()) as {
        profiles?: Record<string, Metadata>;
      };
      for (const [pk, meta] of Object.entries(data.profiles || {})) {
        out[pk.toLowerCase()] = applyKind0NameFields(meta);
      }
    } catch {
      /* ignore batch errors */
    }
  }
  return out;
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
    const savedAtRaw = localStorage.getItem(METADATA_CACHE_SAVED_AT_KEY);
    const savedAt = savedAtRaw ? Number(savedAtRaw) : 0;
    if (savedAt && now - savedAt > LOCAL_STORAGE_CACHE_MAX_AGE_MS) {
      moduleCache = {};
      cacheLoadTime = now;
      return {};
    }

    const cached = localStorage.getItem(METADATA_CACHE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached) as Record<string, Metadata>;
      // CRITICAL: Normalize all keys to lowercase for consistent lookup
      const normalized: Record<string, Metadata> = {};
      for (const [key, value] of Object.entries(parsed)) {
        const entry = { ...value } as Metadata & { identities?: unknown };
        if (entry.identities != null && !Array.isArray(entry.identities)) {
          delete entry.identities;
        }
        normalized[key.toLowerCase()] = entry as Metadata;
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

/** Prefer keeping entries that have Lightning receive info when pruning for quota. */
function pruneMetadataForQuota(
  metadata: Record<string, Metadata>,
  keepFraction = 0.5
): Record<string, Metadata> {
  const entries = Object.entries(metadata);
  if (entries.length < 8) return metadata;
  entries.sort((a, b) => {
    const ap = hasPaymentReceiveFields(a[1]) ? 1 : 0;
    const bp = hasPaymentReceiveFields(b[1]) ? 1 : 0;
    if (ap !== bp) return bp - ap;
    const at = a[1]?.created_at ?? 0;
    const bt = b[1]?.created_at ?? 0;
    return bt - at;
  });
  const keep = Math.max(4, Math.floor(entries.length * keepFraction));
  return Object.fromEntries(entries.slice(0, keep));
}

function isQuotaExceeded(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: string; code?: number; message?: string };
  return (
    e.name === "QuotaExceededError" ||
    e.code === 22 ||
    /quota/i.test(String(e.message || ""))
  );
}

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
        let toSave = pendingMetadata;
        try {
          localStorage.setItem(METADATA_CACHE_KEY, JSON.stringify(toSave));
          localStorage.setItem(
            METADATA_CACHE_SAVED_AT_KEY,
            String(Date.now())
          );
        } catch (err) {
          if (!isQuotaExceeded(err)) throw err;
          // Keep zap-relevant profiles; drop the rest so future loads still work.
          toSave = pruneMetadataForQuota(toSave, 0.4);
          try {
            localStorage.setItem(METADATA_CACHE_KEY, JSON.stringify(toSave));
            localStorage.setItem(
              METADATA_CACHE_SAVED_AT_KEY,
              String(Date.now())
            );
            console.warn(
              `⚠️ [useContributorMetadata] localStorage full — pruned metadata cache to ${
                Object.keys(toSave).length
              } entries (kept Lightning profiles when possible)`
            );
          } catch (err2) {
            if (isQuotaExceeded(err2)) {
              try {
                localStorage.removeItem(METADATA_CACHE_KEY);
                localStorage.removeItem(METADATA_CACHE_SAVED_AT_KEY);
                console.warn(
                  "⚠️ [useContributorMetadata] localStorage full — cleared metadata cache so zaps can still use in-memory profiles"
                );
              } catch {
                /* ignore */
              }
            } else {
              throw err2;
            }
          }
        }
        // Keep module cache in sync with what we intended (full map in memory).
        moduleCache = pendingMetadata;
        cacheLoadTime = Date.now();
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
  /** Pubkeys that already have NIP-39 kind 10011 identities (prefer over kind-0 i tags). */
  const nip39PubkeysRef = useRef<Set<string>>(new Set());
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
      const cached = metadataMap[normalized] || currentCache[normalized];
      // Usable name alone is not enough — zaps need lud16/lnurl. Stale cache
      // used to skip refetch forever when only a display name was stored.
      const needsName = !hasUsableProfileName(cached);
      const needsPayment = !hasPaymentReceiveFields(cached);
      if (!needsName && !needsPayment) return false;
      if (profileFetchAttempted.has(normalized)) return false;
      return true;
    });

    // Warm cache: mark key handled and skip relay work (still merge cache above).
    if (missingFromCache.length === 0) {
      pubkeysKeyRef.current = pubkeysKey;
      hasFetchedOnMountRef.current = true;
      return;
    }

    // Only fetch missing / incomplete pubkeys — never thrash usable ones.
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
      // Do NOT mark profileFetchAttempted here — that raced debounce and
      // permanently skipped HTTP/kind-0 for this pubkey (Firefox npub bug).
      subscriptionTimeoutRef.current = setTimeout(() => {
        setSubscribeTick((t) => t + 1);
      }, wait);
      return;
    }

    lastSubscriptionTimeRef.current = now;
    for (const p of pubkeysToSubscribe) {
      profileFetchAttempted.add(p.toLowerCase());
    }
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
        const profiles = await fetchProfilesHttp(pubkeysToSubscribe);
        if (httpAbort.cancelled) return;
        if (Object.keys(profiles).length === 0) {
          // Network miss — allow another try later (don't poison the session).
          for (const p of pubkeysToSubscribe) {
            profileFetchAttempted.delete(p.toLowerCase());
          }
          return;
        }
        setMetadataMap((prev) => {
          const next = { ...prev };
          for (const [pk, meta] of Object.entries(profiles)) {
            const key = pk.toLowerCase();
            next[key] = mergeKind0OntoExisting(
              next[key],
              meta,
              meta.created_at
            );
          }
          saveMetadataCache(next);
          return next;
        });
        // Allow a later retry only for pubkeys this batch completely missed.
        for (const p of pubkeysToSubscribe) {
          const key = p.toLowerCase();
          if (!profiles[key]) profileFetchAttempted.delete(key);
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
                kinds: [0, KIND_NIP39_IDENTITIES],
                authors: batch, // Subscribe to this batch of pubkeys
              },
            ],
            allRelays.length > 0 ? allRelays : defaultRelays,
            (event, isAfterEose, relayURL) => {
              const normalizedPubkey = event.pubkey.toLowerCase();
              const isTargetPubkey = batch.some(
                (p) => p.toLowerCase() === normalizedPubkey
              );

              // NIP-39 kind 10011 — preferred source for i-tags
              if (event.kind === KIND_NIP39_IDENTITIES) {
                const identities = parseNip39ITags(event.tags);
                if (identities.length === 0) return;
                nip39PubkeysRef.current.add(normalizedPubkey);
                setMetadataMap((prev) => {
                  const existing = prev[normalizedPubkey] || {};
                  const next = {
                    ...prev,
                    [normalizedPubkey]: {
                      ...existing,
                      identities,
                      // Never stamp created_at from 10011 — a newer identities
                      // event was poisoning merges and blocking older kind-0 names.
                      created_at: existing.created_at,
                    },
                  };
                  // Identities-only stub: force HTTP kind-0 fill (Firefox often
                  // never gets kind 0 over WS when damus/etc. fail).
                  if (!hasUsableProfileName(existing)) {
                    void fetchProfilesHttp([normalizedPubkey]).then(
                      (profiles) => {
                        const meta = profiles[normalizedPubkey];
                        if (!meta) return;
                        setMetadataMap((cur) => {
                          const merged = {
                            ...cur,
                            [normalizedPubkey]: mergeKind0OntoExisting(
                              cur[normalizedPubkey],
                              meta,
                              meta.created_at
                            ),
                          };
                          saveMetadataCache(merged);
                          return merged;
                        });
                      }
                    );
                  }
                  return next;
                });
                if (contributorMetaVerbose() && isTargetPubkey) {
                  console.log(
                    `✅ [useContributorMetadata] kind 10011 identities for ${normalizedPubkey.slice(
                      0,
                      8
                    )}:`,
                    identities.map((i) => `${i.platform}:${i.identity}`)
                  );
                }
                return;
              }

              // Process ALL metadata events (even after EOSE - some relays send delayed events)
              if (event.kind === 0) {
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
                  const data = applyKind0NameFields(
                    JSON.parse(event.content) as Metadata
                  );

                  // kind 0 content sometimes includes a non-array `identities` field —
                  // that must not reach UI helpers that call .find on it.
                  if (
                    data.identities != null &&
                    !Array.isArray(data.identities)
                  ) {
                    delete (data as { identities?: unknown }).identities;
                  }

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

                  // Identities: union kind 10011 + legacy kind-0 `i` tags (never drop either layer).
                  // Kind 0 still always supplies name/picture/about via mergeKind0OntoExisting.
                  const legacyIdentities = parseNip39ITags(event.tags);
                  if (
                    data.identities != null &&
                    !Array.isArray(data.identities)
                  ) {
                    delete (data as { identities?: unknown }).identities;
                  }
                  // Don't let content-JSON identities fight tag-based claims here
                  delete (data as { identities?: unknown }).identities;

                  if (
                    contributorMetaVerbose() &&
                    batchIndex === 0 &&
                    legacyIdentities.length > 0
                  ) {
                    console.log(
                      `✅ [useContributorMetadata] Found ${legacyIdentities.length} legacy kind-0 identities:`,
                      legacyIdentities.map((i) => `${i.platform}:${i.identity}`)
                    );
                  }

                  // CRITICAL: Normalize pubkey to lowercase for consistent lookup (already defined above)
                  setMetadataMap((prev) => {
                    const existing = prev[normalizedPubkey];
                    const merged = mergeKind0OntoExisting(
                      existing,
                      data,
                      event.created_at
                    );
                    const saw10011 =
                      nip39PubkeysRef.current.has(normalizedPubkey);
                    const from10011 = saw10011
                      ? existing?.identities
                      : undefined;
                    const fromKind0 = [
                      ...(!saw10011 && Array.isArray(existing?.identities)
                        ? existing.identities
                        : []),
                      ...legacyIdentities,
                    ];
                    const unioned = preferNip39Identities(from10011, fromKind0);
                    if (unioned.length > 0) merged.identities = unioned;
                    else delete (merged as { identities?: unknown }).identities;

                    const next = {
                      ...prev,
                      [normalizedPubkey]: merged,
                    };
                    saveMetadataCache(next);
                    return next;
                  });
                  if (
                    contributorMetaVerbose() &&
                    (batchIndex === 0 || isTargetPubkey)
                  ) {
                    console.log(
                      `✅ [useContributorMetadata] Received metadata for ${event.pubkey.slice(
                        0,
                        8
                      )}`,
                      {
                        name: data.name,
                        display_name: data.display_name,
                        hasPicture: !!data.picture,
                      }
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
