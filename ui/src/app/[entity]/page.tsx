"use client";

import { use, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import {
  type NostrActivityCounts,
  backfillActivities,
  countActivitiesFromNostr,
  getContributionGraph,
  getUserActivities,
  getUserActivityCounts,
  syncIssuesAndPRsFromNostr,
  syncUserCommitsFromBridge,
} from "@/lib/activity-tracking";
import { useNostrContext } from "@/lib/nostr/NostrContext";
import {
  KIND_ISSUE,
  KIND_PULL_REQUEST,
  KIND_REPOSITORY,
  KIND_REPOSITORY_NIP34,
  KIND_STATUS_APPLIED,
  KIND_STATUS_CLOSED,
} from "@/lib/nostr/events";
import {
  ClaimedIdentity,
  useContributorMetadata,
} from "@/lib/nostr/useContributorMetadata";
import useSession from "@/lib/nostr/useSession";
import { getNostrPrivateKey } from "@/lib/security/encryptedStorage";
import { UserStats } from "@/lib/stats";
import {
  getEntityDisplayName,
  getEntityPicture,
  getRepoOwnerPubkey,
  getUserMetadata,
  resolveEntityToPubkey,
} from "@/lib/utils/entity-resolver";
import { getGraspServers } from "@/lib/utils/grasp-servers";
import { isRepoCorrupted } from "@/lib/utils/repo-corruption-check";
import { getRepoStatus, getStatusBadgeStyle } from "@/lib/utils/repo-status";

import {
  CheckCircle2,
  ExternalLink,
  Globe,
  HelpCircle,
  UserCheck,
  UserPlus,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getEventHash, nip19, signEvent } from "nostr-tools";

// Force dynamic rendering - metadata.ts needs to run on each request
export const dynamic = "force-dynamic";

// Check if string is a valid Nostr pubkey (npub or hex)
function isValidPubkey(str: string): boolean {
  if (str.startsWith("npub")) return str.length > 50;
  // Hex pubkey is 64 chars
  return /^[0-9a-f]{64}$/i.test(str);
}

// Parse NIP-34 repository announcement format (minimal fields needed for lists)
function parseNIP34Repository(event: any): any {
  const repoData: any = {
    repositoryName: "",
    name: "",
    description: "",
    clone: [],
    relays: [],
    topics: [],
  };

  if (!event.tags || !Array.isArray(event.tags)) {
    return repoData;
  }

  for (const tag of event.tags) {
    if (!Array.isArray(tag) || tag.length < 2) continue;

    const tagName = tag[0];
    const tagValue = tag[1];

    switch (tagName) {
      case "d":
        repoData.repositoryName = tagValue;
        break;
      case "name":
        repoData.name = tagValue;
        break;
      case "description":
        repoData.description = tagValue;
        break;
      case "clone":
        if (tagValue) repoData.clone.push(tagValue);
        break;
      case "relays":
        if (tagValue) repoData.relays.push(tagValue);
        break;
      case "t":
        if (tagValue) repoData.topics.push(tagValue);
        break;
      default:
        break;
    }
  }

  if (!repoData.repositoryName && repoData.name) {
    repoData.repositoryName = repoData.name;
  }

  return repoData;
}

export default function EntityPage({
  params,
}: {
  params: Promise<{ entity: string }>;
}) {
  const resolvedParams = use(params);
  // CRITICAL: All hooks must be called at the top level, before any conditional returns
  const router = useRouter();
  const redirectedRef = useRef(false);
  const anonRepoSyncRef = useRef(false);
  const [isPubkey, setIsPubkey] = useState(false);
  const [userRepos, setUserRepos] = useState<any[]>([]);
  const [userStats, setUserStats] = useState<UserStats | null>(null);
  const [contributionGraph, setContributionGraph] = useState<
    Array<{ date: string; count: number }>
  >([]);
  const [activityCounts, setActivityCounts] = useState<Record<string, number>>(
    {}
  );
  const [nostrActivityCounts, setNostrActivityCounts] =
    useState<NostrActivityCounts | null>(null);
  const [loadingNostrCounts, setLoadingNostrCounts] = useState(false);

  // Get current user's pubkey for follow functionality - MUST be called before any early returns
  const {
    pubkey: currentUserPubkey,
    publish,
    defaultRelays,
    subscribe,
    remoteSigner,
  } = useNostrContext();
  const { isLoggedIn } = useSession();

  const isLowMemoryDevice = useMemo(() => {
    if (typeof navigator === "undefined") return false;
    const memory = (navigator as any).deviceMemory as number | undefined;
    const cores = navigator.hardwareConcurrency ?? 0;
    const ua = navigator.userAgent || "";
    const isMobile = /Android|iPhone|iPad|iPod/i.test(ua);
    return (
      isMobile ||
      (typeof memory === "number" && memory > 0 && memory <= 4) ||
      (cores > 0 && cores <= 4)
    );
  }, []);
  const shouldLogProfileDebug =
    process.env.NODE_ENV !== "production" && !isLowMemoryDevice;

  // For metadata lookup, use full pubkey if we resolved one, otherwise use entity
  // CRITICAL: Handle npub format entities by decoding them first
  // Don't access localStorage in useState initializer to prevent hydration errors
  const [fullPubkeyForMeta, setFullPubkeyForMeta] = useState<string>(() => {
    // If entity is npub, decode it immediately (no localStorage needed)
    if (resolvedParams.entity.startsWith("npub")) {
      try {
        const decoded = nip19.decode(resolvedParams.entity);
        if (decoded.type === "npub") {
          const pubkey = decoded.data as string;
          if (/^[0-9a-f]{64}$/i.test(pubkey)) {
            console.log(
              `✅ [Profile] Decoded npub to pubkey: ${pubkey.slice(0, 8)}`
            );
            return pubkey;
          }
        }
      } catch (e) {
        console.error("Failed to decode npub:", e);
      }
    }
    // If entity is already a full 64-char pubkey, use it
    if (
      resolvedParams.entity.length === 64 &&
      /^[0-9a-f]{64}$/i.test(resolvedParams.entity)
    ) {
      console.log(
        `✅ [Profile] Entity is full pubkey: ${resolvedParams.entity.slice(
          0,
          8
        )}`
      );
      return resolvedParams.entity;
    }
    // CRITICAL: Don't return 8-char prefix as fullPubkeyForMeta - return empty string
    // This prevents getUserMetadata from being called with invalid shortened pubkeys
    // The useEffect will resolve the full pubkey from localStorage
    return "";
  });

  // Check if current user is following this profile
  const [isFollowing, setIsFollowing] = useState(false);
  const [followingLoading, setFollowingLoading] = useState(false);
  const [contactList, setContactList] = useState<string[]>([]);

  // CRITICAL: Only fetch metadata if we have a valid 64-char pubkey
  // Don't wait for isPubkey - if we have a full pubkey, fetch metadata immediately
  // CRITICAL: When viewing own profile, also include currentUserPubkey to ensure metadata is loaded
  // NOTE: fullPubkeyForMeta is now initialized to empty string (not 8-char prefix) if not a full pubkey, so validation checks work correctly
  const pubkeysForMetadata = useMemo(() => {
    const pubkeys = new Set<string>();

    // Priority 1: If entity is npub, decode it immediately
    if (resolvedParams.entity.startsWith("npub")) {
      try {
        const decoded = nip19.decode(resolvedParams.entity);
        const fullPubkey = decoded.data as string;
        if (decoded.type === "npub" && /^[0-9a-f]{64}$/i.test(fullPubkey)) {
          const normalized = fullPubkey.toLowerCase();
          console.log(
            `📡 [Profile] Fetching metadata for npub (decoded): ${normalized.slice(
              0,
              8
            )}... (full length: ${normalized.length}, normalized to lowercase)`
          );
          console.log(`📡 [Profile] Full decoded pubkey: ${normalized}`);
          pubkeys.add(normalized);
        } else {
          console.error(`❌ [Profile] Decoded npub is not valid 64-char hex:`, {
            type: decoded.type,
            dataLength: fullPubkey.length,
            isValid: /^[0-9a-f]{64}$/i.test(fullPubkey),
            first8: fullPubkey.slice(0, 8),
          });
        }
      } catch (e) {
        console.error(`❌ [Profile] Failed to decode npub:`, e);
      }
    }

    // Priority 2: Use fullPubkeyForMeta if it's a full 64-char pubkey (now initialized to empty string if not valid)
    if (fullPubkeyForMeta && /^[0-9a-f]{64}$/i.test(fullPubkeyForMeta)) {
      const normalized = fullPubkeyForMeta.toLowerCase();
      console.log(
        `📡 [Profile] Fetching metadata for fullPubkeyForMeta: ${normalized.slice(
          0,
          8
        )}... (full length: ${normalized.length}, normalized to lowercase)`
      );
      pubkeys.add(normalized);
    }

    // Priority 3: If entity is already a full pubkey, use it
    if (
      resolvedParams.entity &&
      /^[0-9a-f]{64}$/i.test(resolvedParams.entity)
    ) {
      const normalized = resolvedParams.entity.toLowerCase();
      console.log(
        `📡 [Profile] Fetching metadata for entity (full pubkey): ${normalized.slice(
          0,
          8
        )}... (full length: ${normalized.length}, normalized to lowercase)`
      );
      pubkeys.add(normalized);
    }

    // CRITICAL: When viewing own profile, ensure currentUserPubkey is included for metadata fetch
    // This ensures banner and other metadata are loaded even if URL format differs
    if (currentUserPubkey && /^[0-9a-f]{64}$/i.test(currentUserPubkey)) {
      const normalizedCurrentPubkey = currentUserPubkey.toLowerCase();

      // Strategy 1: Check if we're viewing own profile by comparing pubkeys
      const resolvedPubkey =
        Array.from(pubkeys)[0] ||
        (fullPubkeyForMeta && /^[0-9a-f]{64}$/i.test(fullPubkeyForMeta)
          ? fullPubkeyForMeta
          : null);
      if (resolvedPubkey && /^[0-9a-f]{64}$/i.test(resolvedPubkey)) {
        const isOwnProfile =
          normalizedCurrentPubkey === resolvedPubkey.toLowerCase();
        if (isOwnProfile) {
          console.log(
            `📡 [Profile] Viewing own profile - adding currentUserPubkey to metadata fetch: ${currentUserPubkey.slice(
              0,
              8
            )}`
          );
          pubkeys.add(normalizedCurrentPubkey);
        }
      } else {
        // Strategy 2: If we don't have a resolved pubkey yet, check if entity matches currentUserPubkey
        // This handles cases where the URL format doesn't match but it's still our profile
        if (resolvedParams.entity.startsWith("npub")) {
          try {
            const decoded = nip19.decode(resolvedParams.entity);
            if (decoded.type === "npub") {
              const decodedPubkey = (decoded.data as string).toLowerCase();
              if (decodedPubkey === normalizedCurrentPubkey) {
                console.log(
                  `📡 [Profile] Entity npub matches currentUserPubkey - adding to metadata fetch: ${currentUserPubkey.slice(
                    0,
                    8
                  )}`
                );
                pubkeys.add(normalizedCurrentPubkey);
              }
            }
          } catch {}
        } else if (
          resolvedParams.entity &&
          /^[0-9a-f]{64}$/i.test(resolvedParams.entity) &&
          resolvedParams.entity.toLowerCase() === normalizedCurrentPubkey
        ) {
          console.log(
            `📡 [Profile] Entity pubkey matches currentUserPubkey - adding to metadata fetch: ${currentUserPubkey.slice(
              0,
              8
            )}`
          );
          pubkeys.add(normalizedCurrentPubkey);
        }
      }
    }

    const pubkeysArray = Array.from(pubkeys);
    if (pubkeysArray.length === 0) {
      console.log(
        `⏭️ [Profile] Skipping metadata fetch - no valid pubkey. Entity: ${
          resolvedParams.entity
        } (${resolvedParams.entity.length} chars), fullPubkeyForMeta: ${
          fullPubkeyForMeta
            ? fullPubkeyForMeta.length === 64
              ? fullPubkeyForMeta.slice(0, 8) + "..."
              : fullPubkeyForMeta
            : "empty"
        }`
      );
    }
    return pubkeysArray;
  }, [fullPubkeyForMeta, resolvedParams.entity, currentUserPubkey]);

  // CRITICAL: This hook returns the FULL metadataMap from cache, not just the pubkeys passed to it
  // The hook loads all cached metadata on initialization, so we should have access to all 15+ entries
  if (shouldLogProfileDebug) {
    console.log(`🔍 [Profile] Calling useContributorMetadata with pubkeys:`, {
      pubkeysForMetadata,
      pubkeysLength: pubkeysForMetadata.length,
      pubkeysFirst8: pubkeysForMetadata.map((p) => p.slice(0, 8)),
    });
  }
  const metadataMap = useContributorMetadata(pubkeysForMetadata);

  // CRITICAL: Use the same pattern as settings/profile page - determine pubkey first, then call getUserMetadata directly
  // Determine which pubkey to use (same priority as settings/profile)
  const pubkeyForMetadata = useMemo(() => {
    // Priority 1: Use fullPubkeyForMeta if available (most reliable)
    if (fullPubkeyForMeta && /^[0-9a-f]{64}$/i.test(fullPubkeyForMeta)) {
      return fullPubkeyForMeta;
    }
    // Priority 2: Try resolvedParams.entity if it's a full pubkey
    if (
      resolvedParams.entity &&
      /^[0-9a-f]{64}$/i.test(resolvedParams.entity)
    ) {
      return resolvedParams.entity;
    }
    // Priority 3: Try decoding npub
    if (resolvedParams.entity && resolvedParams.entity.startsWith("npub")) {
      try {
        const decoded = nip19.decode(resolvedParams.entity);
        if (decoded.type === "npub") {
          const pubkey = decoded.data as string;
          if (/^[0-9a-f]{64}$/i.test(pubkey)) {
            return pubkey;
          }
        }
      } catch (e) {
        // Invalid npub format
      }
    }
    return null;
  }, [fullPubkeyForMeta, resolvedParams.entity]);

  // CRITICAL: Use centralized metadata lookup function for consistent behavior across all pages
  // This ensures the profile page uses the same lookup logic as settings/profile page
  // Use the same pattern as settings/profile: call getUserMetadata directly with the pubkey
  // CRITICAL: For own profile, also try currentUserPubkey as fallback if pubkeyForMetadata lookup fails
  // CRITICAL: Memoize userMeta so it updates when metadataMap changes (e.g., after cache update)
  const userMeta = useMemo(() => {
    if (pubkeyForMetadata) {
      const meta = getUserMetadata(pubkeyForMetadata, metadataMap);
      // If we found metadata, return it
      if (meta && Object.keys(meta).length > 0) {
        return meta;
      }
    }

    // Fallback: If viewing own profile and metadata not found, try currentUserPubkey
    if (currentUserPubkey && /^[0-9a-f]{64}$/i.test(currentUserPubkey)) {
      const resolvedPubkey = pubkeyForMetadata || fullPubkeyForMeta;
      if (resolvedPubkey && /^[0-9a-f]{64}$/i.test(resolvedPubkey)) {
        const isOwnProfile =
          currentUserPubkey.toLowerCase() === resolvedPubkey.toLowerCase();
        if (isOwnProfile) {
          const ownMeta = getUserMetadata(
            currentUserPubkey.toLowerCase(),
            metadataMap
          );
          if (ownMeta && Object.keys(ownMeta).length > 0) {
            console.log(
              `✅ [Profile] Found own metadata via currentUserPubkey fallback`
            );
            return ownMeta;
          }
        }
      }
    }

    return {};
  }, [pubkeyForMetadata, currentUserPubkey, fullPubkeyForMeta, metadataMap]);

  // Ensure public profiles can load repos even when anonymous storage was cleaned
  useEffect(() => {
    if (isLoggedIn) return;
    if (userRepos.length > 0) return;
    if (!subscribe || !defaultRelays || defaultRelays.length === 0) return;

    const targetPubkey =
      (pubkeyForMetadata && /^[0-9a-f]{64}$/i.test(pubkeyForMetadata)
        ? pubkeyForMetadata
        : null) ||
      (fullPubkeyForMeta && /^[0-9a-f]{64}$/i.test(fullPubkeyForMeta)
        ? fullPubkeyForMeta
        : null);

    if (!targetPubkey) return;
    if (anonRepoSyncRef.current) return;

    if (typeof window !== "undefined") {
      const cacheKey = `gittr_profile_repo_sync_${targetPubkey}`;
      const lastSync = sessionStorage.getItem(cacheKey);
      if (lastSync && Date.now() - Number(lastSync) < 2 * 60 * 1000) {
        return;
      }
      sessionStorage.setItem(cacheKey, Date.now().toString());
    }

    anonRepoSyncRef.current = true;
    const graspRelays = getGraspServers(defaultRelays);
    const activeRelays = graspRelays.length > 0 ? graspRelays : defaultRelays;

    const upsertRepo = (event: any, repoData: any) => {
      const existingRepos = JSON.parse(
        localStorage.getItem("gittr_repos") || "[]"
      ) as any[];
      const repoName = repoData.repositoryName || repoData.name || "";
      const ownerPubkey = event.pubkey;

      if (!repoName || !ownerPubkey) return;

      const existingIndex = existingRepos.findIndex((r: any) => {
        const rOwner =
          r.ownerPubkey ||
          (r.entity
            ? (() => {
                try {
                  const decoded = nip19.decode(r.entity);
                  return decoded.type === "npub" ? decoded.data : null;
                } catch {
                  return null;
                }
              })()
            : null);
        return (
          rOwner &&
          rOwner.toLowerCase() === ownerPubkey.toLowerCase() &&
          (r.repo === repoName ||
            r.slug === repoName ||
            r.slug === `${r.entity}/${repoName}`)
        );
      });

      const repoEntry: any = {
        slug: repoName,
        entity: ownerPubkey
          ? (() => {
              try {
                return nip19.npubEncode(ownerPubkey);
              } catch {
                return ownerPubkey.slice(0, 8);
              }
            })()
          : undefined,
        repo: repoName,
        name: repoData.name || repoName,
        description: repoData.description || "",
        createdAt: event.created_at * 1000,
        updatedAt: Date.now(),
        ownerPubkey: ownerPubkey,
        lastNostrEventId: event.id,
        lastNostrEventCreatedAt: event.created_at,
        syncedFromNostr: true,
        clone: repoData.clone || [],
        relays: repoData.relays || [],
        topics: repoData.topics || [],
      };

      if (existingIndex >= 0) {
        const existing = existingRepos[existingIndex];
        const existingLatest = (existing as any).lastNostrEventCreatedAt || 0;
        if (event.created_at > existingLatest) {
          existingRepos[existingIndex] = {
            ...existing,
            ...repoEntry,
          };
          localStorage.setItem("gittr_repos", JSON.stringify(existingRepos));
          window.dispatchEvent(new CustomEvent("storage"));
        }
      } else {
        existingRepos.push(repoEntry);
        localStorage.setItem("gittr_repos", JSON.stringify(existingRepos));
        window.dispatchEvent(new CustomEvent("storage"));
      }
    };

    const unsub = subscribe(
      [
        {
          kinds: [KIND_REPOSITORY, KIND_REPOSITORY_NIP34],
          authors: [targetPubkey],
          limit: 5000,
        },
      ],
      activeRelays,
      (event: any) => {
        try {
          let repoData: any;
          if (event.kind === KIND_REPOSITORY_NIP34) {
            repoData = parseNIP34Repository(event);
          } else {
            try {
              repoData = JSON.parse(event.content);
            } catch (parseError) {
              console.warn(
                `[Profile] Failed to parse repo event content as JSON:`,
                parseError
              );
              return;
            }
          }

          if (!repoData) return;
          upsertRepo(event, repoData);
        } catch (err) {
          console.error("❌ [Profile] Failed to sync repos from Nostr:", err);
        }
      }
    );

    const resetTimer = setTimeout(() => {
      anonRepoSyncRef.current = false;
    }, 8000);

    return () => {
      anonRepoSyncRef.current = false;
      clearTimeout(resetTimer);
      if (unsub) unsub();
    };
  }, [
    isLoggedIn,
    userRepos.length,
    subscribe,
    defaultRelays,
    pubkeyForMetadata,
    fullPubkeyForMeta,
  ]);

  // Debug: Log metadata state and check for identities
  useEffect(() => {
    if (!shouldLogProfileDebug) return;
    if (pubkeyForMetadata) {
      const normalized = pubkeyForMetadata.toLowerCase();
      const meta = metadataMap[normalized];
      console.log(
        `🔍 [Profile] Metadata lookup for ${normalized.slice(0, 8)}:`,
        {
          hasMetadata: !!meta,
          hasIdentities: !!meta?.identities,
          identitiesCount: meta?.identities?.length || 0,
          identities: meta?.identities,
          allMetadataKeys: Object.keys(metadataMap).slice(0, 10),
          metadataMapSize: Object.keys(metadataMap).length,
        }
      );
      const cacheKeys = Object.keys(metadataMap);
      const directMatch = metadataMap[normalized];
      const caseInsensitiveMatch = cacheKeys.find(
        (k) => k.toLowerCase() === normalized
      );
      const caseInsensitiveData = caseInsensitiveMatch
        ? metadataMap[caseInsensitiveMatch]
        : null;

      console.log(
        `📊 [Profile] Metadata lookup for ${normalized.slice(0, 8)}:`,
        {
          pubkeyLength: normalized.length,
          fullPubkey: normalized,
          isFullPubkey: /^[0-9a-f]{64}$/i.test(normalized),
          hasUserMeta: !!userMeta && Object.keys(userMeta).length > 0,
          userMetaKeys: userMeta ? Object.keys(userMeta) : [],
          userMetaContent: userMeta,
          hasPicture: !!userMeta?.picture,
          hasName: !!userMeta?.name,
          hasDisplayName: !!userMeta?.display_name,
          hasNip05: !!userMeta?.nip05,
          hasAbout: !!userMeta?.about,
          metadataCacheSize: cacheKeys.length,
          foundInCache: cacheKeys.includes(normalized),
          directMatch: directMatch,
          caseInsensitiveMatch: caseInsensitiveMatch,
          caseInsensitiveData: caseInsensitiveData,
          allCacheKeys: cacheKeys,
          cacheKeysFirst8: cacheKeys.map((k) => k.slice(0, 8)),
        }
      );

      // CRITICAL: Also log as string to see actual values
      console.log(
        `🔍 [Profile] Metadata details:`,
        `name="${userMeta?.name || "MISSING"}"`,
        `display_name="${userMeta?.display_name || "MISSING"}"`,
        `picture="${userMeta?.picture ? "EXISTS" : "MISSING"}"`,
        `banner="${
          userMeta?.banner
            ? "EXISTS: " + userMeta.banner.substring(0, 50) + "..."
            : "MISSING"
        }"`,
        `nip05="${userMeta?.nip05 || "MISSING"}"`,
        `about="${userMeta?.about ? "EXISTS" : "MISSING"}"`,
        `cacheHasKey=${cacheKeys.includes(normalized)}`,
        `cacheKeysCount=${cacheKeys.length}`,
        `lookingFor="${normalized.slice(0, 16)}..."`
      );

      // Debug: Check raw metadata from cache
      const rawMeta = metadataMap[normalized];
      if (rawMeta) {
        console.log(`🔍 [Profile] Raw metadata from cache:`, {
          hasBanner: !!rawMeta.banner,
          bannerValue: rawMeta.banner
            ? rawMeta.banner.substring(0, 50) + "..."
            : "none",
          allKeys: Object.keys(rawMeta),
        });
      }
    } else {
      console.log(
        `⚠️ [Profile] No pubkey for metadata! Entity: ${resolvedParams.entity}, fullPubkeyForMeta: ${fullPubkeyForMeta}`
      );
    }
  }, [
    userMeta,
    pubkeyForMetadata,
    metadataMap,
    resolvedParams.entity,
    fullPubkeyForMeta,
    shouldLogProfileDebug,
  ]);

  // Check if entity is a pubkey (user profile) or repo slug
  useEffect(() => {
    if (redirectedRef.current) return; // Prevent multiple redirects

    const entityParam = resolvedParams.entity;

    // Reserved routes that should not be treated as entity/repo
    const reservedRoutes = [
      "stars",
      "zaps",
      "explore",
      "pulls",
      "issues",
      "repositories",
      "settings",
      "profile",
      "projects",
      "organizations",
      "sponsors",
      "upgrade",
      "help",
      "new",
      "login",
      "signup",
      "bounty-hunt",
    ];
    if (reservedRoutes.includes(entityParam)) {
      // This is a reserved route, don't handle it here
      return;
    }

    // Check if it's a full pubkey or 8-char prefix (entity)
    const isFullPubkey = isValidPubkey(entityParam);
    const isEntityPrefix =
      entityParam.length === 8 && /^[0-9a-f]{8}$/i.test(entityParam);

    // Try to find repos with this entity first (for 8-char prefixes)
    try {
      const repos = JSON.parse(
        localStorage.getItem("gittr_repos") || "[]"
      ) as any[];

      if (isFullPubkey || isEntityPrefix) {
        // It's a user profile (full pubkey or 8-char prefix)
        setIsPubkey(true);

        // Find ALL repos where user is involved: owner, contributor, can merge, or forked
        // CRITICAL: Must find ALL repos where this user has any role, not just owner
        const userReposList = repos
          .filter((r: any) => {
            // CRITICAL: Filter out corrupted repos FIRST (before any other checks)
            // For "tides" repos, also verify they belong to this entity
            if (isRepoCorrupted(r, r.nostrEventId || r.lastNostrEventId)) {
              return false; // Never show corrupted repos
            }

            // CRITICAL: Additional check for "tides" repos - verify they belong to this entity
            const repoName = (
              r.repositoryName ||
              r.repo ||
              r.slug ||
              r.name ||
              ""
            ).toLowerCase();
            if (repoName === "tides" && r.ownerPubkey && fullPubkeyForMeta) {
              const ownerPubkey = r.ownerPubkey.toLowerCase();
              const entityPubkey = fullPubkeyForMeta.toLowerCase();
              if (ownerPubkey !== entityPubkey) {
                // This tides repo doesn't belong to this entity - it's corrupted
                return false;
              }
            }

            if (!r.entity || r.entity === "user") return false;

            // Helper to check if pubkey matches entityParam
            const pubkeyMatches = (pubkey: string | undefined) => {
              if (!pubkey || !/^[0-9a-f]{64}$/i.test(pubkey)) return false;
              if (
                isFullPubkey &&
                pubkey.toLowerCase() === entityParam.toLowerCase()
              )
                return true;
              if (
                isEntityPrefix &&
                pubkey.toLowerCase().startsWith(entityParam.toLowerCase())
              )
                return true;
              return false;
            };

            // Priority 1: Match by ownerPubkey (owner)
            if (r.ownerPubkey && pubkeyMatches(r.ownerPubkey)) return true;

            // Priority 2: Match by owner contributor (weight 100 = owner)
            if (r.contributors && Array.isArray(r.contributors)) {
              const ownerContributor = r.contributors.find(
                (c: any) => c.weight === 100 && pubkeyMatches(c.pubkey)
              );
              if (ownerContributor) return true;

              // Also check for any contributor (maintainer, contributor, or forker)
              const userContributor = r.contributors.find(
                (c: any) => pubkeyMatches(c.pubkey) && (c.weight > 0 || c.role)
              );
              if (userContributor) return true;
            }

            // Priority 3: Match by forkedFrom (if user forked this repo)
            if (r.forkedFrom) {
              // Check if the original repo's owner matches
              const originalRepo = repos.find(
                (orig: any) =>
                  orig.slug === r.forkedFrom ||
                  (orig.entity &&
                    orig.repo &&
                    `${orig.entity}/${orig.repo}` === r.forkedFrom)
              );
              if (originalRepo) {
                const originalOwner =
                  originalRepo.ownerPubkey ||
                  originalRepo.contributors?.find((c: any) => c.weight === 100)
                    ?.pubkey;
                if (originalOwner && pubkeyMatches(originalOwner)) return true;
              }
            }

            // Priority 4: Match exact entity (8-char prefix)
            if (r.entity === entityParam) return true;

            // Priority 5: If entityParam is 8-char prefix, match entities starting with it
            if (
              isEntityPrefix &&
              r.entity.toLowerCase().startsWith(entityParam.toLowerCase())
            )
              return true;

            // Priority 6: If entityParam is full pubkey, match entities that are its prefix
            if (
              isFullPubkey &&
              r.entity.toLowerCase() === entityParam.slice(0, 8).toLowerCase()
            )
              return true;

            // Priority 7: If entityParam is npub, decode and match by pubkey
            if (entityParam.startsWith("npub")) {
              try {
                const decoded = nip19.decode(entityParam);
                if (decoded.type === "npub") {
                  const decodedPubkey = (decoded.data as string).toLowerCase();
                  // Match by ownerPubkey
                  if (
                    r.ownerPubkey &&
                    r.ownerPubkey.toLowerCase() === decodedPubkey
                  )
                    return true;
                  // Match by contributors
                  if (r.contributors && Array.isArray(r.contributors)) {
                    const matchingContributor = r.contributors.find(
                      (c: any) =>
                        c.pubkey && c.pubkey.toLowerCase() === decodedPubkey
                    );
                    if (matchingContributor) return true;
                  }
                  // Match by entity if it's the 8-char prefix of decoded pubkey
                  if (
                    r.entity &&
                    r.entity.toLowerCase() === decodedPubkey.slice(0, 8)
                  )
                    return true;
                }
              } catch {}
            }

            return false;
          })
          .map((r: any) => {
            // Add role information to each repo
            let role: "owner" | "maintainer" | "contributor" | "forked" =
              "contributor";

            // Resolve target pubkey for comparison - use fullPubkeyForMeta if available, otherwise resolve from entityParam
            let targetPubkey: string | null = null;
            if (isFullPubkey) {
              // If entityParam is npub, we need to decode it or use fullPubkeyForMeta
              if (entityParam.startsWith("npub")) {
                try {
                  const decoded = nip19.decode(entityParam);
                  if (decoded.type === "npub") {
                    const pubkey = decoded.data as string;
                    if (/^[0-9a-f]{64}$/i.test(pubkey)) {
                      targetPubkey = pubkey.toLowerCase();
                    }
                  }
                } catch {}
              } else if (/^[0-9a-f]{64}$/i.test(entityParam)) {
                targetPubkey = entityParam.toLowerCase();
              }
            } else {
              // For 8-char prefix, try to resolve from repo's ownerPubkey or use fullPubkeyForMeta
              if (
                r.ownerPubkey &&
                /^[0-9a-f]{64}$/i.test(r.ownerPubkey) &&
                r.ownerPubkey
                  .toLowerCase()
                  .startsWith(entityParam.toLowerCase())
              ) {
                targetPubkey = r.ownerPubkey.toLowerCase();
              } else if (
                fullPubkeyForMeta &&
                /^[0-9a-f]{64}$/i.test(fullPubkeyForMeta) &&
                fullPubkeyForMeta
                  .toLowerCase()
                  .startsWith(entityParam.toLowerCase())
              ) {
                targetPubkey = fullPubkeyForMeta.toLowerCase();
              }
            }

            if (targetPubkey) {
              // Check if owner
              if (
                r.ownerPubkey &&
                r.ownerPubkey.toLowerCase() === targetPubkey
              ) {
                role = "owner";
                // If it's a fork (has forkedFrom) and user owns it, mark as forked
                if (r.forkedFrom) {
                  role = "forked";
                }
              } else if (r.contributors && Array.isArray(r.contributors)) {
                const contributor = r.contributors.find(
                  (c: any) =>
                    c.pubkey && c.pubkey.toLowerCase() === targetPubkey
                );
                if (contributor) {
                  if (
                    contributor.weight === 100 ||
                    contributor.role === "owner"
                  ) {
                    role = "owner";
                    // If it's a fork and user owns it, mark as forked
                    if (r.forkedFrom) {
                      role = "forked";
                    }
                  } else if (
                    contributor.weight >= 50 ||
                    contributor.role === "maintainer"
                  ) {
                    role = "maintainer";
                  } else {
                    role = "contributor";
                  }
                }
              }
            }

            return { ...r, userRole: role };
          });
        // CRITICAL: Sync repos from activities if they're missing from localStorage
        // This handles the case where repos were created locally but not synced to localStorage
        // Resolve full pubkey for activities lookup (same logic as below)
        let pubkeyForActivities = entityParam;
        if (isFullPubkey) {
          pubkeyForActivities = entityParam;
        } else if (
          fullPubkeyForMeta &&
          /^[0-9a-f]{64}$/i.test(fullPubkeyForMeta)
        ) {
          pubkeyForActivities = fullPubkeyForMeta;
        } else if (isEntityPrefix && userReposList.length > 0) {
          const repoWithOwnerPubkey = userReposList.find(
            (r: any) => r.ownerPubkey && r.ownerPubkey.length === 64
          );
          if (repoWithOwnerPubkey?.ownerPubkey) {
            pubkeyForActivities = repoWithOwnerPubkey.ownerPubkey;
          }
        }
        const repoActivitiesForSync = getUserActivities(
          pubkeyForActivities
        ).filter(
          (a) => a.type === "repo_created" || a.type === "repo_imported"
        );

        // Check if any activities don't have corresponding repos in userReposList
        const missingRepos = repoActivitiesForSync.filter((activity) => {
          if (!activity.repo) return false;
          const [activityEntity, activityRepo] = activity.repo.split("/");
          return !userReposList.some((r: any) => {
            const rEntity = r.entity || "";
            const rRepo = r.repo || r.slug || "";
            return rEntity === activityEntity && rRepo === activityRepo;
          });
        });

        if (missingRepos.length > 0) {
          console.log(
            `⚠️ [Profile] Found ${missingRepos.length} repo activities without matching repos in localStorage (${userReposList.length} already found). Syncing missing ones...`
          );

          // Create minimal repo entries from activities
          const syncedRepos: any[] = [];
          missingRepos.forEach((activity) => {
            if (!activity.repo || !activity.entity) return;

            // Parse entity/repo from activity.repo
            const [activityEntity, activityRepo] = activity.repo.split("/");
            if (!activityEntity || !activityRepo) return;

            // Check if repo already exists
            const exists = repos.some((r: any) => {
              const rEntity = r.entity || "";
              const rRepo = r.repo || r.slug || "";
              return rEntity === activityEntity && rRepo === activityRepo;
            });

            if (!exists) {
              // Resolve full pubkey for ownerPubkey
              let ownerPubkey = activity.user;
              if (
                activityEntity.length === 8 &&
                fullPubkeyForMeta &&
                /^[0-9a-f]{64}$/i.test(fullPubkeyForMeta)
              ) {
                // If activity.entity is 8-char prefix and matches fullPubkeyForMeta, use fullPubkeyForMeta
                if (
                  fullPubkeyForMeta
                    .toLowerCase()
                    .startsWith(activityEntity.toLowerCase())
                ) {
                  ownerPubkey = fullPubkeyForMeta;
                }
              } else if (/^[0-9a-f]{64}$/i.test(activityEntity)) {
                ownerPubkey = activityEntity;
              }

              const syncedRepo: any = {
                slug: activityRepo,
                entity: activityEntity,
                repo: activityRepo,
                name: activity.repoName || activityRepo,
                ownerPubkey: /^[0-9a-f]{64}$/i.test(ownerPubkey)
                  ? ownerPubkey
                  : undefined,
                contributors: /^[0-9a-f]{64}$/i.test(ownerPubkey)
                  ? [{ pubkey: ownerPubkey, weight: 100 }]
                  : [],
                createdAt: activity.timestamp,
                description: activity.metadata?.description,
              };

              syncedRepos.push(syncedRepo);
              repos.push(syncedRepo);
            }
          });

          if (syncedRepos.length > 0) {
            console.log(
              `✅ [Profile] Synced ${syncedRepos.length} repos from activities to localStorage`
            );
            localStorage.setItem("gittr_repos", JSON.stringify(repos));

            // Re-run the entire filtering logic now that we've synced
            // Reload repos from localStorage to get the updated list
            const updatedRepos = JSON.parse(
              localStorage.getItem("gittr_repos") || "[]"
            ) as any[];
            const updatedUserReposList = updatedRepos
              .filter((r: any) => {
                if (!r.entity || r.entity === "user") return false;

                const pubkeyMatches = (pubkey: string | undefined) => {
                  if (!pubkey || !/^[0-9a-f]{64}$/i.test(pubkey)) return false;
                  if (
                    isFullPubkey &&
                    pubkey.toLowerCase() === entityParam.toLowerCase()
                  )
                    return true;
                  if (
                    isEntityPrefix &&
                    pubkey.toLowerCase().startsWith(entityParam.toLowerCase())
                  )
                    return true;
                  return false;
                };

                if (r.ownerPubkey && pubkeyMatches(r.ownerPubkey)) return true;
                if (r.contributors && Array.isArray(r.contributors)) {
                  const ownerContributor = r.contributors.find(
                    (c: any) => c.weight === 100 && pubkeyMatches(c.pubkey)
                  );
                  if (ownerContributor) return true;
                }
                if (r.entity === entityParam) return true;
                if (
                  isEntityPrefix &&
                  r.entity.toLowerCase().startsWith(entityParam.toLowerCase())
                )
                  return true;
                if (
                  isFullPubkey &&
                  r.entity.toLowerCase() ===
                    entityParam.slice(0, 8).toLowerCase()
                )
                  return true;

                // Priority 7: If entityParam is npub, decode and match by pubkey
                if (entityParam.startsWith("npub")) {
                  try {
                    const decoded = nip19.decode(entityParam);
                    if (decoded.type === "npub") {
                      const decodedPubkey = (
                        decoded.data as string
                      ).toLowerCase();
                      // Match by ownerPubkey
                      if (
                        r.ownerPubkey &&
                        r.ownerPubkey.toLowerCase() === decodedPubkey
                      )
                        return true;
                      // Match by contributors
                      if (r.contributors && Array.isArray(r.contributors)) {
                        const matchingContributor = r.contributors.find(
                          (c: any) =>
                            c.pubkey && c.pubkey.toLowerCase() === decodedPubkey
                        );
                        if (matchingContributor) return true;
                      }
                      // Match by entity if it's the 8-char prefix of decoded pubkey
                      if (
                        r.entity &&
                        r.entity.toLowerCase() === decodedPubkey.slice(0, 8)
                      )
                        return true;
                    }
                  } catch {}
                }

                return false;
              })
              .map((r: any) => {
                let role: "owner" | "maintainer" | "contributor" | "forked" =
                  "contributor";
                let targetPubkey: string | null = null;

                if (isFullPubkey) {
                  if (entityParam.startsWith("npub")) {
                    try {
                      const decoded = nip19.decode(entityParam);
                      if (decoded.type === "npub") {
                        const pubkey = decoded.data as string;
                        if (/^[0-9a-f]{64}$/i.test(pubkey)) {
                          targetPubkey = pubkey.toLowerCase();
                        }
                      }
                    } catch {}
                  } else if (/^[0-9a-f]{64}$/i.test(entityParam)) {
                    targetPubkey = entityParam.toLowerCase();
                  }
                } else {
                  if (
                    r.ownerPubkey &&
                    /^[0-9a-f]{64}$/i.test(r.ownerPubkey) &&
                    r.ownerPubkey
                      .toLowerCase()
                      .startsWith(entityParam.toLowerCase())
                  ) {
                    targetPubkey = r.ownerPubkey.toLowerCase();
                  } else if (
                    fullPubkeyForMeta &&
                    /^[0-9a-f]{64}$/i.test(fullPubkeyForMeta) &&
                    fullPubkeyForMeta
                      .toLowerCase()
                      .startsWith(entityParam.toLowerCase())
                  ) {
                    targetPubkey = fullPubkeyForMeta.toLowerCase();
                  }
                }

                if (targetPubkey) {
                  if (
                    r.ownerPubkey &&
                    r.ownerPubkey.toLowerCase() === targetPubkey
                  ) {
                    role = "owner";
                    if (r.forkedFrom) role = "forked";
                  } else if (r.contributors && Array.isArray(r.contributors)) {
                    const contributor = r.contributors.find(
                      (c: any) =>
                        c.pubkey && c.pubkey.toLowerCase() === targetPubkey
                    );
                    if (contributor) {
                      if (
                        contributor.weight === 100 ||
                        contributor.role === "owner"
                      ) {
                        role = "owner";
                        if (r.forkedFrom) role = "forked";
                      } else if (
                        contributor.weight >= 50 ||
                        contributor.role === "maintainer"
                      ) {
                        role = "maintainer";
                      } else {
                        role = "contributor";
                      }
                    }
                  }
                }

                return { ...r, userRole: role };
              });

            // CRITICAL: Filter out deleted repos and deduplicate
            const deletedRepos = JSON.parse(
              localStorage.getItem("gittr_deleted_repos") || "[]"
            ) as Array<{ entity: string; repo: string; deletedAt: number }>;

            // Helper function to check if a repo is deleted (ONLY uses npub and ownerPubkey - NO 8-char prefixes)
            const isRepoDeleted = (r: any): boolean => {
              const repo = r.repo || r.slug || "";
              const entity = r.entity || "";

              // Check direct match by entity (npub format)
              const repoKey = `${entity}/${repo}`.toLowerCase();
              if (
                deletedRepos.some(
                  (d) => `${d.entity}/${d.repo}`.toLowerCase() === repoKey
                )
              )
                return true;

              // Check by ownerPubkey (most reliable - handles npub entity mismatches)
              if (r.ownerPubkey && /^[0-9a-f]{64}$/i.test(r.ownerPubkey)) {
                const ownerPubkey = r.ownerPubkey.toLowerCase();
                // Check if deleted entity is npub for same pubkey
                if (
                  deletedRepos.some((d) => {
                    if (d.entity.startsWith("npub")) {
                      try {
                        const dDecoded = nip19.decode(d.entity);
                        if (
                          dDecoded.type === "npub" &&
                          (dDecoded.data as string).toLowerCase() ===
                            ownerPubkey
                        ) {
                          return d.repo.toLowerCase() === repo.toLowerCase();
                        }
                      } catch {}
                    }
                    return false;
                  })
                )
                  return true;
              }

              return false;
            };

            // Check if viewing own profile
            const viewingOwnProfile =
              currentUserPubkey &&
              fullPubkeyForMeta &&
              /^[0-9a-f]{64}$/i.test(fullPubkeyForMeta) &&
              currentUserPubkey.toLowerCase() ===
                fullPubkeyForMeta.toLowerCase();

            // CRITICAL: Filter out corrupted repos with entity="gittr.space" or invalid entity format
            const validRepos = updatedUserReposList.filter((r: any) => {
              // Exclude repos with "gittr.space" entity (corrupted)
              if (r.entity === "gittr.space") {
                console.log(
                  "❌ [EntityPage] Filtering out corrupted repo with entity 'gittr.space':",
                  {
                    repo: r.slug || r.repo,
                    ownerPubkey: r.ownerPubkey?.slice(0, 16),
                  }
                );
                return false;
              }
              // Entity must be npub format (starts with "npub")
              if (r.entity && !r.entity.startsWith("npub")) {
                console.log(
                  "❌ [EntityPage] Filtering out repo with invalid entity format:",
                  {
                    repo: r.slug || r.repo,
                    entity: r.entity,
                  }
                );
                return false;
              }
              return true;
            });

            // Filter out deleted repos and local repos (if viewing someone else's profile)
            const filteredUpdatedRepos = validRepos.filter((r: any) => {
              // Skip if locally deleted (using robust check)
              if (isRepoDeleted(r)) return false;

              // Skip if marked as deleted/archived on Nostr
              if (r.deleted === true || r.archived === true) return false;

              // CRITICAL: On public profile (not own), only show repos that are "live" on Nostr
              // Local repos and push_failed repos should be private and not visible to others
              if (!viewingOwnProfile) {
                const status = getRepoStatus(r);
                // Only show "live" or "live_with_edits" repos on public profiles
                // "local", "pushing", and "push_failed" repos are private and should not be visible
                if (
                  status === "local" ||
                  status === "pushing" ||
                  status === "push_failed"
                )
                  return false;
              }

              return true;
            });

            // Deduplicate repos by entity/repo combination (keep the most recent one)
            const dedupeMap = new Map<string, any>();
            filteredUpdatedRepos.forEach((r: any) => {
              const entity = (r.entity || "").trim();
              const repo = (r.repo || r.slug || "").trim();
              const key = `${entity}/${repo}`.toLowerCase(); // Case-insensitive comparison
              const existing = dedupeMap.get(key);
              if (!existing) {
                dedupeMap.set(key, r);
              } else {
                // Keep the one with the most recent event date
                const rLatest = (r as any).lastNostrEventCreatedAt
                  ? (r as any).lastNostrEventCreatedAt * 1000
                  : (r as any).updatedAt || r.createdAt || 0;
                const existingLatest = (existing as any).lastNostrEventCreatedAt
                  ? (existing as any).lastNostrEventCreatedAt * 1000
                  : (existing as any).updatedAt || existing.createdAt || 0;
                if (rLatest > existingLatest) {
                  dedupeMap.set(key, r);
                }
              }
            });

            const deduplicatedUpdatedRepos = Array.from(dedupeMap.values());

            setUserRepos(deduplicatedUpdatedRepos);
            console.log(
              `✅ [Profile] After sync: ${
                deduplicatedUpdatedRepos.length
              } repos found (${
                updatedUserReposList.length - deduplicatedUpdatedRepos.length
              } duplicates/deleted removed)`
            );
            return; // Exit early since we've updated userRepos
          }
        }

        // Debug: Log what we found - also check ALL repos to see why some aren't matching
        const allReposDebug = repos.slice(0, 10).map((r: any) => ({
          slug: r.slug || r.repo,
          entity: r.entity,
          ownerPubkey: r.ownerPubkey?.slice(0, 8),
          hasContributors: !!r.contributors,
          contributorsCount: r.contributors?.length || 0,
          firstContributorPubkey: r.contributors?.[0]?.pubkey?.slice(0, 8),
        }));

        // CRITICAL: Filter out deleted repos and deduplicate
        const deletedRepos = JSON.parse(
          localStorage.getItem("gittr_deleted_repos") || "[]"
        ) as Array<{ entity: string; repo: string; deletedAt: number }>;

        // Helper function to check if a repo is deleted (ONLY uses npub and ownerPubkey - NO 8-char prefixes)
        const isRepoDeleted = (r: any): boolean => {
          const repo = r.repo || r.slug || "";
          const entity = r.entity || "";

          // Check direct match by entity (npub format)
          const repoKey = `${entity}/${repo}`.toLowerCase();
          if (
            deletedRepos.some(
              (d) => `${d.entity}/${d.repo}`.toLowerCase() === repoKey
            )
          )
            return true;

          // Check by ownerPubkey (most reliable - handles npub entity mismatches)
          if (r.ownerPubkey && /^[0-9a-f]{64}$/i.test(r.ownerPubkey)) {
            const ownerPubkey = r.ownerPubkey.toLowerCase();
            // Check if deleted entity is npub for same pubkey
            if (
              deletedRepos.some((d) => {
                if (d.entity.startsWith("npub")) {
                  try {
                    const dDecoded = nip19.decode(d.entity);
                    if (
                      dDecoded.type === "npub" &&
                      (dDecoded.data as string).toLowerCase() === ownerPubkey
                    ) {
                      return d.repo.toLowerCase() === repo.toLowerCase();
                    }
                  } catch {}
                }
                return false;
              })
            )
              return true;
          }

          return false;
        };

        // Check if viewing own profile (will be set later, but we need it here)
        const viewingOwnProfile =
          currentUserPubkey &&
          fullPubkeyForMeta &&
          /^[0-9a-f]{64}$/i.test(fullPubkeyForMeta) &&
          currentUserPubkey.toLowerCase() === fullPubkeyForMeta.toLowerCase();

        // Filter out deleted repos and local repos (if viewing someone else's profile)
        const filteredRepos = userReposList.filter((r: any) => {
          // CRITICAL: Filter out corrupted repos FIRST (before any other checks)
          if (isRepoCorrupted(r, r.nostrEventId || r.lastNostrEventId)) {
            return false; // Never show corrupted repos
          }

          // Skip if locally deleted (using robust check)
          if (isRepoDeleted(r)) return false;

          // Skip if marked as deleted/archived on Nostr
          if (r.deleted === true || r.archived === true) return false;

          // CRITICAL: On public profile (not own), only show repos that are published to Nostr
          // Local repos should be private and not visible to others
          // Check if repo has ANY Nostr event ID - if it does, it's on Nostr and should be shown
          if (!viewingOwnProfile) {
            // Check if repo has any Nostr event ID (announcement, state, or synced from Nostr)
            const hasNostrEventId = !!(
              r.nostrEventId ||
              r.lastNostrEventId ||
              r.stateEventId ||
              r.lastStateEventId ||
              r.syncedFromNostr ||
              r.fromNostr
            );

            // If repo has NO Nostr event IDs at all, it's truly local and should be hidden
            if (!hasNostrEventId) {
              // Double-check: maybe it exists in the main repos list from Nostr (synced but missing event ID)
              const existsInNostr = repos.some((nr: any) => {
                const nrEntity = nr.entity || "";
                const nrRepo = nr.repo || nr.slug || "";
                const rEntity = r.entity || "";
                const rRepo = r.repo || r.slug || "";
                return (
                  nrEntity.toLowerCase() === rEntity.toLowerCase() &&
                  nrRepo.toLowerCase() === rRepo.toLowerCase() &&
                  nr.ownerPubkey?.toLowerCase() ===
                    fullPubkeyForMeta?.toLowerCase()
                );
              });

              // If it doesn't exist in Nostr repos list either, it's truly local - hide it
              if (!existsInNostr) return false;
            }

            // Don't show repos that are currently pushing
            if (r.status === "pushing") return false;

            // Filter out private repos (unless user is the owner)
            // NOTE: Repos without publicRead field (undefined) are treated as public (default)
            if (r.publicRead === false) {
              // Check if current user is the owner
              const repoOwnerPubkey =
                r.ownerPubkey ||
                (r.entity && r.entity.startsWith("npub")
                  ? (() => {
                      try {
                        const decoded = nip19.decode(r.entity);
                        return decoded.type === "npub"
                          ? (decoded.data as string)
                          : null;
                      } catch {
                        return null;
                      }
                    })()
                  : null);
              const isOwner =
                currentUserPubkey &&
                repoOwnerPubkey &&
                currentUserPubkey.toLowerCase() ===
                  repoOwnerPubkey.toLowerCase();
              if (!isOwner) {
                return false; // Hide private repos from non-owners
              }
            }
          }

          return true;
        });

        // CRITICAL: Sort by latest event date (lastNostrEventCreatedAt) if available, otherwise by createdAt
        // This ensures repos with recent updates appear first
        // Note: lastNostrEventCreatedAt is in SECONDS (NIP-34 format), createdAt/updatedAt are in MILLISECONDS
        const sortedRepos = filteredRepos.slice().sort((a: any, b: any) => {
          const aLatest = a.lastNostrEventCreatedAt
            ? a.lastNostrEventCreatedAt * 1000 // Convert seconds to milliseconds
            : a.updatedAt || a.createdAt || 0;
          const bLatest = b.lastNostrEventCreatedAt
            ? b.lastNostrEventCreatedAt * 1000 // Convert seconds to milliseconds
            : b.updatedAt || b.createdAt || 0;
          return bLatest - aLatest; // Newest first
        });

        // Deduplicate repos by entity/repo combination (keep the most recent one)
        const dedupeMap = new Map<string, any>();
        sortedRepos.forEach((r: any) => {
          const entity = (r.entity || "").trim();
          const repo = (r.repo || r.slug || "").trim();
          const key = `${entity}/${repo}`.toLowerCase(); // Case-insensitive comparison
          const existing = dedupeMap.get(key);
          if (!existing) {
            dedupeMap.set(key, r);
          } else {
            // Keep the one with the most recent event date
            const rLatest = r.lastNostrEventCreatedAt
              ? r.lastNostrEventCreatedAt * 1000
              : r.updatedAt || r.createdAt || 0;
            const existingLatest = existing.lastNostrEventCreatedAt
              ? existing.lastNostrEventCreatedAt * 1000
              : existing.updatedAt || existing.createdAt || 0;
            if (rLatest > existingLatest) {
              dedupeMap.set(key, r);
            }
          }
        });

        const deduplicatedRepos = Array.from(dedupeMap.values());

        console.log(`🔍 [Profile] Repository filtering results:`, {
          totalReposInStorage: repos.length,
          userReposFound: userReposList.length,
          afterDeletedFilter: filteredRepos.length,
          afterDeduplication: deduplicatedRepos.length,
          duplicatesRemoved: filteredRepos.length - deduplicatedRepos.length,
          deletedReposFiltered: userReposList.length - filteredRepos.length,
          repoActivitiesCount: repoActivitiesForSync.length,
          entityParam,
          isFullPubkey,
          isEntityPrefix,
          fullPubkeyForMeta: fullPubkeyForMeta?.slice(0, 8),
          sampleUserRepos: deduplicatedRepos.slice(0, 3).map((r: any) => ({
            slug: r.slug || r.repo,
            entity: r.entity,
            ownerPubkey: r.ownerPubkey?.slice(0, 8),
            hasContributors: !!r.contributors,
          })),
          allReposSample: allReposDebug,
        });

        setUserRepos(deduplicatedRepos);

        // For activities, we need the full pubkey. If we only have prefix, find it from repos
        let fullPubkey = entityParam;

        // If entityParam is already a full pubkey, use it
        if (isFullPubkey) {
          fullPubkey = entityParam;
        } else if (isEntityPrefix && userReposList.length > 0) {
          // Try to find full pubkey from repo ownerPubkeys first (most reliable)
          const repoWithOwnerPubkey = userReposList.find(
            (r: any) => r.ownerPubkey && r.ownerPubkey.length === 64
          );
          if (repoWithOwnerPubkey?.ownerPubkey) {
            fullPubkey = repoWithOwnerPubkey.ownerPubkey;
          } else {
            // Try from repo entities
            const repoWithFullEntity = userReposList.find(
              (r: any) => r.entity && r.entity.length === 64
            );
            if (repoWithFullEntity?.entity) {
              fullPubkey = repoWithFullEntity.entity;
            } else {
              // Try from activities
              const activities = JSON.parse(
                localStorage.getItem("gittr_activities") || "[]"
              );
              const matchingPubkeys = new Set<string>();
              activities.forEach((a: any) => {
                if (
                  a.user &&
                  a.user.toLowerCase().startsWith(entityParam.toLowerCase())
                ) {
                  matchingPubkeys.add(a.user);
                }
              });
              // Use first matching pubkey, or keep entityParam if none found
              if (matchingPubkeys.size > 0) {
                fullPubkey = Array.from(matchingPubkeys)[0] as string;
              }
            }
          }
        }

        // Get user stats using full pubkey (defer statistics loading to after page renders)
        // CRITICAL: getUserActivities now filters out activities from deleted repos
        // Defer statistics loading to improve initial page load performance
        setTimeout(() => {
          let activities = getUserActivities(fullPubkey);
          let counts = getUserActivityCounts(fullPubkey);
          let graph = getContributionGraph(fullPubkey);

          // Set localStorage counts after page has rendered
          setActivityCounts(counts);
          setContributionGraph(graph);

          // CRITICAL: Use localStorage counts as base (includes bridge commits + synced PRs/issues)
          // Then add Nostr PRs/issues per repo in background
          // localStorage is already showing correct counts from bridge + synced data
          // We just add any additional PRs/issues from Nostr that might not be in localStorage yet
          // CRITICAL: subscribe and defaultRelays should always be available from NostrContext
          // Even when not logged in, we can still query Nostr (read-only)
          if (isLowMemoryDevice) {
            setLoadingNostrCounts(false);
            return;
          }
          if (subscribe && defaultRelays && defaultRelays.length > 0) {
            setLoadingNostrCounts(true);

            // Use countActivitiesFromNostr to get accurate counts from the network
            const graspRelays = getGraspServers(defaultRelays);
            const activeRelays =
              graspRelays.length > 0 ? graspRelays : defaultRelays;

            // Skip if no relays available
            if (activeRelays.length === 0) {
              console.warn(
                "⚠️ [Profile] No GRASP/git relays available for activity counting"
              );
              setLoadingNostrCounts(false);
              return;
            }

            // Use the proper function to count activities from Nostr
            // CRITICAL: Normalize pubkey to lowercase for consistent querying
            const normalizedFullPubkey = fullPubkey.toLowerCase();
            console.log(
              `🔍 [Profile] Starting Nostr activity count query for ${normalizedFullPubkey.slice(
                0,
                8
              )}... (logged in: ${isLoggedIn})`
            );
            countActivitiesFromNostr(
              subscribe,
              activeRelays,
              normalizedFullPubkey
            )
              .then((nostrCounts) => {
                console.log(
                  `✅ [Profile] Got Nostr activity counts:`,
                  nostrCounts
                );

                // CRITICAL: Also query for PRs/issues created by OTHER users for this user's repos
                // PRs/issues can be created by anyone, not just the repo owner
                // Query by #a tag (repo identifier: "30617:<owner-pubkey>:<repo-name>")
                const repoIdentifiers = deduplicatedRepos
                  .filter((r: any) => {
                    const ownerPubkey = r.ownerPubkey || fullPubkey;
                    const repoName = r.repo || r.slug;
                    return (
                      ownerPubkey &&
                      repoName &&
                      /^[0-9a-f]{64}$/i.test(ownerPubkey)
                    );
                  })
                  .map((r: any) => {
                    const ownerPubkey = r.ownerPubkey || fullPubkey;
                    const repoName = r.repo || r.slug;
                    return `30617:${ownerPubkey}:${repoName}`;
                  });

                if (repoIdentifiers.length > 0) {
                  console.log(
                    `🔍 [Profile] Querying PRs/issues for ${repoIdentifiers.length} repos by #a tag...`
                  );

                  // Query for PRs/issues that reference this user's repos
                  const seenPRs = new Set<string>();
                  const seenIssues = new Set<string>();
                  let prsIssuesEoseCount = 0;
                  const expectedPrsIssuesEose = activeRelays.length;
                  let prsIssuesResolved = false;

                  const prsIssuesFilters = [
                    // PR events (kind 1618) for this user's repos
                    {
                      kinds: [KIND_PULL_REQUEST],
                      "#a": repoIdentifiers,
                      limit: 1000,
                    },
                    // PR merged status (kind 1631) for this user's repos
                    {
                      kinds: [KIND_STATUS_APPLIED],
                      "#a": repoIdentifiers,
                      "#k": ["1618"], // Only PR status events
                      limit: 1000,
                    },
                    // Issue events (kind 1621) for this user's repos
                    {
                      kinds: [KIND_ISSUE],
                      "#a": repoIdentifiers,
                      limit: 1000,
                    },
                    // Issue closed status (kind 1632) for this user's repos
                    {
                      kinds: [KIND_STATUS_CLOSED],
                      "#a": repoIdentifiers,
                      "#k": ["1621"], // Only issue status events
                      limit: 1000,
                    },
                  ];

                  const prsIssuesUnsub = subscribe(
                    prsIssuesFilters,
                    activeRelays,
                    (event, _isAfterEose, _relayURL) => {
                      // Count PR events (kind 1618) - but only if not already counted by author
                      if (event.kind === KIND_PULL_REQUEST) {
                        if (!seenPRs.has(event.id)) {
                          seenPRs.add(event.id);
                          // Only count if NOT created by the user (already counted in nostrCounts)
                          if (
                            event.pubkey.toLowerCase() !==
                            fullPubkey.toLowerCase()
                          ) {
                            nostrCounts.prsCreated++;
                            nostrCounts.total++;
                          }
                        }
                      }
                      // Count PR merged status (kind 1631)
                      else if (event.kind === KIND_STATUS_APPLIED) {
                        const kTag = event.tags?.find(
                          (t: any) => Array.isArray(t) && t[0] === "k"
                        );
                        if (kTag && kTag[1] === "1618") {
                          // Only count if NOT by the user (already counted in nostrCounts)
                          if (
                            event.pubkey.toLowerCase() !==
                            fullPubkey.toLowerCase()
                          ) {
                            nostrCounts.prsMerged++;
                            nostrCounts.total++;
                          }
                        }
                      }
                      // Count issue events (kind 1621) - but only if not already counted by author
                      else if (event.kind === KIND_ISSUE) {
                        if (!seenIssues.has(event.id)) {
                          seenIssues.add(event.id);
                          // Only count if NOT created by the user (already counted in nostrCounts)
                          if (
                            event.pubkey.toLowerCase() !==
                            fullPubkey.toLowerCase()
                          ) {
                            nostrCounts.issuesCreated++;
                            nostrCounts.total++;
                          }
                        }
                      }
                      // Count issue closed status (kind 1632)
                      else if (event.kind === KIND_STATUS_CLOSED) {
                        const kTag = event.tags?.find(
                          (t: any) => Array.isArray(t) && t[0] === "k"
                        );
                        if (kTag && kTag[1] === "1621") {
                          // Only count if NOT by the user (already counted in nostrCounts)
                          if (
                            event.pubkey.toLowerCase() !==
                            fullPubkey.toLowerCase()
                          ) {
                            nostrCounts.issuesClosed++;
                            nostrCounts.total++;
                          }
                        }
                      }
                    },
                    undefined,
                    (relayUrl: string, minCreatedAt: number) => {
                      prsIssuesEoseCount++;
                      if (
                        prsIssuesEoseCount >= expectedPrsIssuesEose &&
                        !prsIssuesResolved
                      ) {
                        prsIssuesResolved = true;
                        setTimeout(() => {
                          prsIssuesUnsub();
                          console.log(
                            `✅ [Profile] Final Nostr activity counts (including PRs/issues by others):`,
                            nostrCounts
                          );
                          // CRITICAL: Only set nostrActivityCounts if counts are meaningful (non-zero)
                          // If all counts are 0, don't override localStorage counts
                          if (nostrCounts.total > 0 || nostrCounts.repos > 0) {
                            setNostrActivityCounts(nostrCounts);
                          } else {
                            console.log(
                              `⚠️ [Profile] Nostr query returned all zeros, keeping localStorage counts`
                            );
                          }
                          setLoadingNostrCounts(false);
                        }, 1000);
                      }
                    },
                    {} // options parameter
                  );

                  // Timeout after 15 seconds
                  setTimeout(() => {
                    if (!prsIssuesResolved) {
                      prsIssuesResolved = true;
                      prsIssuesUnsub();
                      console.log(
                        `⏱️ [Profile] PRs/issues query timeout after 15s (EOSE: ${prsIssuesEoseCount}/${expectedPrsIssuesEose}), final counts:`,
                        nostrCounts
                      );
                      // CRITICAL: Only set nostrActivityCounts if counts are meaningful (non-zero)
                      if (nostrCounts.total > 0 || nostrCounts.repos > 0) {
                        setNostrActivityCounts(nostrCounts);
                      } else {
                        console.log(
                          `⚠️ [Profile] Nostr query timeout returned all zeros, keeping localStorage counts`
                        );
                      }
                      setLoadingNostrCounts(false);
                    }
                  }, 15000);
                } else {
                  // No repos to query, just use the counts from countActivitiesFromNostr
                  // CRITICAL: Only set nostrActivityCounts if counts are meaningful (non-zero)
                  // If all counts are 0, don't override localStorage counts
                  if (nostrCounts.total > 0 || nostrCounts.repos > 0) {
                    setNostrActivityCounts(nostrCounts);
                  } else {
                    console.log(
                      `⚠️ [Profile] Nostr query returned all zeros, keeping localStorage counts`
                    );
                  }
                  setLoadingNostrCounts(false);
                }
              })
              .catch((error) => {
                console.error(
                  "❌ [Profile] Error counting activities from Nostr:",
                  error
                );
                setLoadingNostrCounts(false);
                // Keep localStorage counts on error
              });
          }

          // CRITICAL: Sync activities from multiple sources to get complete picture (for timeline graph)
          // 1. Run backfill if not done (ensures all repos have creation activities)
          // 2. Sync commits from bridge (real git commits)
          // 3. Sync issues/PRs from Nostr (kind 1621/1618 events)
          const backfillKey = "gittr_activities_backfilled";
          const backfillLastRun = localStorage.getItem(backfillKey);
          const now = Date.now();
          const BACKFILL_INTERVAL = 24 * 60 * 60 * 1000; // Run backfill once per day

          // Run backfill if not done or if it's been more than 24 hours
          if (
            !backfillLastRun ||
            now - parseInt(backfillLastRun, 10) > BACKFILL_INTERVAL
          ) {
            console.log(
              "🔄 [Profile] Running backfill to ensure all repos have activities..."
            );
            if (!isLowMemoryDevice) {
              backfillActivities();
            }
          }

          // Sync commits from bridge (every 5 minutes)
          const syncKey = `gittr_commits_synced_${fullPubkey}`;
          const lastSync = localStorage.getItem(syncKey);
          const SYNC_INTERVAL = 5 * 60 * 1000; // Sync every 5 minutes

          if (!lastSync || now - parseInt(lastSync, 10) > SYNC_INTERVAL) {
            // Sync commits from bridge in background (don't block UI)
            if (isLowMemoryDevice) {
              return;
            }
            syncUserCommitsFromBridge(fullPubkey)
              .then((syncedCount) => {
                // Also sync issues/PRs from Nostr
                const issuesPRsSynced = syncIssuesAndPRsFromNostr(fullPubkey);

                if (syncedCount > 0 || issuesPRsSynced > 0) {
                  // Update activities after sync
                  const updatedActivities = getUserActivities(fullPubkey);
                  const updatedCounts = getUserActivityCounts(fullPubkey);
                  const updatedGraph = getContributionGraph(fullPubkey);

                  setActivityCounts(updatedCounts);
                  setContributionGraph(updatedGraph);

                  // Update user stats with new activity count
                  setUserStats((prev) =>
                    prev
                      ? {
                          ...prev,
                          activityCount: updatedActivities.length,
                          commitCount: updatedActivities.filter(
                            (a: any) => a.type === "commit_created"
                          ).length,
                          lastActivity:
                            updatedActivities.length > 0
                              ? Math.max(
                                  ...updatedActivities.map(
                                    (a: any) => a.timestamp
                                  )
                                )
                              : prev.lastActivity || 0,
                        }
                      : null
                  );
                }

                // Mark as synced
                localStorage.setItem(syncKey, now.toString());
              })
              .catch((error) => {
                console.error("Failed to sync activities:", error);
              });
          } else {
            // Even if commits are synced, check for new issues/PRs (they update more frequently)
            if (isLowMemoryDevice) {
              return;
            }
            const issuesPRsSynced = syncIssuesAndPRsFromNostr(fullPubkey);
            if (issuesPRsSynced > 0) {
              const updatedActivities = getUserActivities(fullPubkey);
              const updatedCounts = getUserActivityCounts(fullPubkey);
              const updatedGraph = getContributionGraph(fullPubkey);

              setActivityCounts(updatedCounts);
              setContributionGraph(updatedGraph);

              setUserStats((prev) =>
                prev
                  ? {
                      ...prev,
                      activityCount: updatedActivities.length,
                      lastActivity:
                        updatedActivities.length > 0
                          ? Math.max(
                              ...updatedActivities.map((a: any) => a.timestamp)
                            )
                          : prev.lastActivity || 0,
                    }
                  : null
              );
            }
          }

          // Debug: log what we found
          console.log("Profile stats for", fullPubkey, {
            totalActivities: activities.length,
            commits: activities.filter((a) => a.type === "commit_created")
              .length,
            prsMerged: activities.filter((a) => a.type === "pr_merged").length,
            bountiesClaimed: activities.filter(
              (a) => a.type === "bounty_claimed"
            ).length,
            counts: counts,
            allActivityTypes: activities.map((a) => a.type),
            filteredReposCount: deduplicatedRepos.length, // Use actual filtered repo count
          });

          // If no activities found, try triggering backfill
          if (activities.length === 0) {
            console.warn(
              "No activities found - you may need to run backfillActivities()"
            );
            console.log(
              "To backfill, run in console: localStorage.removeItem('gittr_activities_backfilled'); location.reload();"
            );
          }

          // CRITICAL: Use actual filtered repo count instead of counting from activities
          // This ensures deleted repos are excluded
          setUserStats({
            pubkey: fullPubkey,
            activityCount: activities.length,
            prMergedCount: activities.filter((a: any) => a.type === "pr_merged")
              .length,
            commitCount: activities.filter(
              (a: any) => a.type === "commit_created"
            ).length,
            bountyClaimedCount: activities.filter(
              (a: any) => a.type === "bounty_claimed"
            ).length,
            reposCreatedCount: deduplicatedRepos.length, // Use actual filtered repo count, not activities
            lastActivity:
              activities.length > 0
                ? Math.max(...activities.map((a: any) => a.timestamp))
                : 0,
          });
        }, 100); // Defer statistics loading by 100ms to allow page to render first

        // Update metadata lookup to use full pubkey
        if (fullPubkey !== entityParam) {
          // We'll need to handle this in metadata lookup
        }
      } else {
        // Try to find repo with this slug
        redirectedRef.current = true;
        const repo = repos.find((r: any) => {
          if (!r.entity || r.entity === "user") return false;
          const entity = r.entity;
          const repoSlug = r.repo || r.slug || "";
          return entity === entityParam || r.slug === entityParam;
        });

        if (repo && repo.entity && repo.entity !== "user") {
          const entity = repo.entity;
          const repoName =
            repo.repo ||
            (repo.slug?.includes("/")
              ? repo.slug.split("/")[1]
              : repo.slug || entityParam);
          router.replace(`/${entity}/${repoName}`);
        } else {
          router.replace("/explore");
        }
      }
    } catch (error) {
      console.error("Failed to load profile:", error);
      if (!isFullPubkey && !isEntityPrefix) {
        redirectedRef.current = true;
        router.replace("/explore");
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedParams.entity]);

  // Resolve pubkey from localStorage after mount to prevent hydration errors
  // Use ref to track last processed entity to prevent re-processing
  const lastProcessedEntityRef = useRef<string>("");
  useEffect(() => {
    // Skip if we already processed this entity
    if (lastProcessedEntityRef.current === resolvedParams.entity) {
      return;
    }

    // Only resolve if isPubkey is true (user profile, not repo)
    if (!isPubkey) {
      lastProcessedEntityRef.current = resolvedParams.entity;
      return;
    }

    // Check if we already have the correct pubkey
    if (fullPubkeyForMeta && /^[0-9a-f]{64}$/i.test(fullPubkeyForMeta)) {
      // If entity is npub, check if decoded matches
      if (resolvedParams.entity.startsWith("npub")) {
        try {
          const decoded = nip19.decode(resolvedParams.entity);
          if (decoded.type === "npub" && decoded.data === fullPubkeyForMeta) {
            lastProcessedEntityRef.current = resolvedParams.entity;
            return; // Already correct
          }
        } catch {}
      } else if (
        resolvedParams.entity === fullPubkeyForMeta ||
        (resolvedParams.entity.length === 64 &&
          resolvedParams.entity.toLowerCase() ===
            fullPubkeyForMeta.toLowerCase())
      ) {
        lastProcessedEntityRef.current = resolvedParams.entity;
        return; // Already correct
      } else if (
        resolvedParams.entity.length === 8 &&
        fullPubkeyForMeta
          .toLowerCase()
          .startsWith(resolvedParams.entity.toLowerCase())
      ) {
        lastProcessedEntityRef.current = resolvedParams.entity;
        return; // Already correct (8-char prefix matches)
      }
    }

    // If entityParam is npub, decode it (no localStorage needed)
    if (resolvedParams.entity.startsWith("npub")) {
      try {
        const decoded = nip19.decode(resolvedParams.entity);
        if (
          decoded.type === "npub" &&
          /^[0-9a-f]{64}$/i.test(decoded.data as string)
        ) {
          const fullPubkey = decoded.data as string;
          console.log(
            `✅ [Profile] useEffect: Setting fullPubkeyForMeta from npub: ${fullPubkey.slice(
              0,
              8
            )}`
          );
          setFullPubkeyForMeta(fullPubkey);
          return;
        }
      } catch (e) {
        console.error(`❌ [Profile] useEffect: Failed to decode npub:`, e);
      }
    }

    // If entityParam is already a full pubkey, use it directly
    if (
      isValidPubkey(resolvedParams.entity) &&
      resolvedParams.entity.length === 64
    ) {
      console.log(
        `✅ [Profile] useEffect: Setting fullPubkeyForMeta from entity (full): ${resolvedParams.entity.slice(
          0,
          8
        )}`
      );
      setFullPubkeyForMeta(resolvedParams.entity);
      return;
    }

    // Try to resolve full pubkey from localStorage (only for 8-char prefixes)
    if (resolvedParams.entity && /^[0-9a-f]{8}$/i.test(resolvedParams.entity)) {
      try {
        const repos = JSON.parse(
          localStorage.getItem("gittr_repos") || "[]"
        ) as any[];

        // First try to find by ownerPubkey (most reliable for imported repos)
        const matchingRepoByOwner = repos.find(
          (r: any) =>
            r.ownerPubkey &&
            /^[0-9a-f]{64}$/i.test(r.ownerPubkey) &&
            r.ownerPubkey
              .toLowerCase()
              .startsWith(resolvedParams.entity.toLowerCase())
        );

        if (matchingRepoByOwner?.ownerPubkey) {
          console.log(
            `✅ [Profile] useEffect: Setting fullPubkeyForMeta from repo ownerPubkey: ${matchingRepoByOwner.ownerPubkey.slice(
              0,
              8
            )}`
          );
          setFullPubkeyForMeta(matchingRepoByOwner.ownerPubkey);
          return;
        }

        // Then try by entity
        const matchingRepo = repos.find(
          (r: any) =>
            r.entity &&
            /^[0-9a-f]{64}$/i.test(r.entity) &&
            r.entity
              .toLowerCase()
              .startsWith(resolvedParams.entity.toLowerCase())
        );

        if (matchingRepo?.entity) {
          console.log(
            `✅ [Profile] useEffect: Setting fullPubkeyForMeta from repo entity: ${matchingRepo.entity.slice(
              0,
              8
            )}`
          );
          setFullPubkeyForMeta(matchingRepo.entity);
          return;
        }

        // Try from activities
        const activities = JSON.parse(
          localStorage.getItem("gittr_activities") || "[]"
        );
        const matchingActivity = activities.find(
          (a: any) =>
            a.user &&
            /^[0-9a-f]{64}$/i.test(a.user) &&
            a.user.toLowerCase().startsWith(resolvedParams.entity.toLowerCase())
        );
        if (matchingActivity?.user) {
          console.log(
            `✅ [Profile] useEffect: Setting fullPubkeyForMeta from activity: ${matchingActivity.user.slice(
              0,
              8
            )}`
          );
          setFullPubkeyForMeta(matchingActivity.user);
          lastProcessedEntityRef.current = resolvedParams.entity;
          return;
        }
      } catch (e) {
        console.error(
          `❌ [Profile] useEffect: Failed to resolve from localStorage:`,
          e
        );
      }
    }

    // Mark as processed even if we didn't find a match
    lastProcessedEntityRef.current = resolvedParams.entity;
  }, [resolvedParams.entity, isPubkey]); // Removed fullPubkeyForMeta from deps - use ref to prevent loops

  // Use getEntityDisplayName for consistent display name resolution
  // CRITICAL: Never show full npub string or shortened pubkey - always prefer username or show npub
  const displayName = useMemo(() => {
    // Priority 1: Use metadata from userMeta (already normalized via getUserMetadata)
    if (
      userMeta?.name &&
      userMeta.name.trim().length > 0 &&
      userMeta.name !== "Anonymous Nostrich" &&
      !userMeta.name.startsWith("npub") &&
      !/^[0-9a-f]{8,64}$/i.test(userMeta.name)
    ) {
      return userMeta.name;
    }
    if (
      userMeta?.display_name &&
      userMeta.display_name.trim().length > 0 &&
      !userMeta.display_name.startsWith("npub") &&
      !/^[0-9a-f]{8,64}$/i.test(userMeta.display_name)
    ) {
      return userMeta.display_name;
    }

    // Priority 2: Try direct lookup using getUserMetadata (same as settings/profile page)
    if (pubkeyForMetadata) {
      const fallbackMeta = getUserMetadata(
        pubkeyForMetadata.toLowerCase(),
        metadataMap
      );
      if (
        fallbackMeta?.name &&
        fallbackMeta.name.trim().length > 0 &&
        fallbackMeta.name !== "Anonymous Nostrich" &&
        !fallbackMeta.name.startsWith("npub") &&
        !/^[0-9a-f]{8,64}$/i.test(fallbackMeta.name)
      ) {
        return fallbackMeta.name;
      }
      if (
        fallbackMeta?.display_name &&
        fallbackMeta.display_name.trim().length > 0 &&
        !fallbackMeta.display_name.startsWith("npub") &&
        !/^[0-9a-f]{8,64}$/i.test(fallbackMeta.display_name)
      ) {
        return fallbackMeta.display_name;
      }
    }

    // Priority 3: If we have npub, show shortened npub (not pubkey prefix)
    if (resolvedParams.entity.startsWith("npub")) {
      // Show first 16 chars of npub: "npub1n2ph08n4pqz..."
      return resolvedParams.entity.substring(0, 16) + "...";
    }

    // Fallback: show 8-char prefix only if entity is exactly 8 chars
    return resolvedParams.entity.length === 8
      ? resolvedParams.entity
      : resolvedParams.entity.slice(0, 8);
  }, [userMeta, fullPubkeyForMeta, metadataMap, resolvedParams.entity]);

  // CRITICAL: Get all metadata fields from userMeta (which uses centralized getUserMetadata function)
  // If userMeta is empty, try direct lookup as fallback (same logic as settings/profile page)
  // CRITICAL: When viewing own profile, also try currentUserPubkey as fallback to ensure metadata is found
  const isOwnProfileCheck =
    currentUserPubkey &&
    pubkeyForMetadata &&
    /^[0-9a-f]{64}$/i.test(pubkeyForMetadata) &&
    currentUserPubkey.toLowerCase() === pubkeyForMetadata.toLowerCase();

  const picture =
    userMeta?.picture ||
    (pubkeyForMetadata
      ? getUserMetadata(pubkeyForMetadata.toLowerCase(), metadataMap)?.picture
      : null) ||
    (isOwnProfileCheck && currentUserPubkey
      ? getUserMetadata(currentUserPubkey.toLowerCase(), metadataMap)?.picture
      : null) ||
    null;

  // CRITICAL: Banner lookup - unified for own and foreign profiles
  // userMeta already uses getUserMetadata which handles all lookup strategies
  // So we just need to check userMeta first, then try direct lookup as fallback
  const banner =
    userMeta?.banner ||
    (() => {
      // Fallback: Try direct lookup from metadataMap using pubkeyForMetadata (validated 64-char pubkey)
      if (pubkeyForMetadata) {
        const meta = getUserMetadata(
          pubkeyForMetadata.toLowerCase(),
          metadataMap
        );
        if (meta?.banner) {
          console.log(
            `✅ [Banner] Found via direct lookup: ${meta.banner.substring(
              0,
              50
            )}...`
          );
          return meta.banner;
        }
      }

      // Additional fallback: Try currentUserPubkey if viewing own profile
      if (
        isOwnProfileCheck &&
        currentUserPubkey &&
        /^[0-9a-f]{64}$/i.test(currentUserPubkey)
      ) {
        const meta = getUserMetadata(
          currentUserPubkey.toLowerCase(),
          metadataMap
        );
        if (meta?.banner) {
          console.log(
            `✅ [Banner] Found via currentUserPubkey: ${meta.banner.substring(
              0,
              50
            )}...`
          );
          return meta.banner;
        }
      }

      console.log(
        `⚠️ [Banner] NOT FOUND - userMeta.banner: ${
          userMeta?.banner || "undefined"
        }, pubkeyForMetadata: ${
          pubkeyForMetadata ? pubkeyForMetadata.slice(0, 8) + "..." : "null"
        }`
      );
      return undefined;
    })();
  // CRITICAL: Get all metadata fields with unified fallback for own and foreign profiles
  // Use userMeta first (which already has fallback logic), then try direct lookup as additional fallback
  // CRITICAL: Memoize getMetaField so it updates when userMeta or metadataMap changes
  const getMetaField = useMemo(() => {
    return (field: string) => {
      // Try userMeta first (now reactive to metadataMap changes)
      if (userMeta && userMeta[field]) {
        return userMeta[field];
      }

      // Fallback 1: Try pubkeyForMetadata lookup (validated 64-char pubkey)
      if (pubkeyForMetadata) {
        const meta = getUserMetadata(
          pubkeyForMetadata.toLowerCase(),
          metadataMap
        );
        if (meta && meta[field]) {
          return meta[field];
        }
      }

      // Fallback 2: If viewing own profile, try currentUserPubkey lookup
      if (
        isOwnProfileCheck &&
        currentUserPubkey &&
        /^[0-9a-f]{64}$/i.test(currentUserPubkey)
      ) {
        const meta = getUserMetadata(
          currentUserPubkey.toLowerCase(),
          metadataMap
        );
        if (meta && meta[field]) {
          return meta[field];
        }
      }

      return undefined;
    };
  }, [
    userMeta,
    pubkeyForMetadata,
    metadataMap,
    isOwnProfileCheck,
    currentUserPubkey,
  ]);

  const about = getMetaField("about");
  const nip05 = getMetaField("nip05");
  const website = getMetaField("website");
  const lud16 = getMetaField("lud16");
  const lnurl = getMetaField("lnurl");

  // Get full pubkey for display (always show npub format, never shortened pubkey)
  const displayPubkey =
    fullPubkeyForMeta && /^[0-9a-f]{64}$/i.test(fullPubkeyForMeta)
      ? nip19.npubEncode(fullPubkeyForMeta)
      : resolvedParams.entity.startsWith("npub")
      ? resolvedParams.entity
      : null;

  // Load current user's contact list (kind 3) to check if following
  useEffect(() => {
    if (
      !isLoggedIn ||
      !currentUserPubkey ||
      !subscribe ||
      !fullPubkeyForMeta ||
      !/^[0-9a-f]{64}$/i.test(fullPubkeyForMeta)
    )
      return;

    const unsub = subscribe(
      [
        {
          kinds: [3], // Contact list
          authors: [currentUserPubkey],
          limit: 1,
        },
      ],
      defaultRelays,
      (event) => {
        if (event.kind === 3) {
          try {
            const contacts = JSON.parse(event.content);
            if (
              contacts &&
              typeof contacts === "object" &&
              contacts.p &&
              Array.isArray(contacts.p)
            ) {
              const pubkeys = contacts.p
                .map((p: any) =>
                  typeof p === "string" ? p : p[0] || p.pubkey || ""
                )
                .filter(
                  (p: string) => p && typeof p === "string" && p.length > 0
                )
                .map((p: string) => p.toLowerCase());
              setContactList(pubkeys);
              setIsFollowing(pubkeys.includes(fullPubkeyForMeta.toLowerCase()));
            } else {
              // Also check tags as fallback (some clients use tags instead of content)
              const pTags = event.tags
                .filter((tag) => tag[0] === "p" && tag[1])
                .map((tag) => tag[1] as string)
                .filter((p: string) => p && p.length > 0)
                .map((p: string) => p.toLowerCase());
              if (pTags.length > 0) {
                setContactList(pTags);
                setIsFollowing(pTags.includes(fullPubkeyForMeta.toLowerCase()));
              } else {
                setContactList([]);
                setIsFollowing(false);
              }
            }
          } catch (e) {
            console.error(
              "Failed to parse contact list:",
              e,
              "Content:",
              event.content?.slice(0, 100)
            );
            // Fallback: extract from tags
            try {
              const pTags = event.tags
                .filter((tag) => tag[0] === "p" && tag[1])
                .map((tag) => tag[1] as string)
                .filter((p: string) => p && p.length > 0)
                .map((p: string) => p.toLowerCase());
              if (pTags.length > 0) {
                setContactList(pTags);
                setIsFollowing(pTags.includes(fullPubkeyForMeta.toLowerCase()));
              } else {
                setContactList([]);
                setIsFollowing(false);
              }
            } catch (tagError) {
              console.error(
                "Failed to parse contact list from tags:",
                tagError
              );
              setContactList([]);
              setIsFollowing(false);
            }
          }
        }
      },
      undefined,
      () => {
        if (unsub) unsub();
      }
    );

    return () => {
      if (unsub) unsub();
    };
  }, [
    isLoggedIn,
    currentUserPubkey,
    subscribe,
    defaultRelays,
    fullPubkeyForMeta,
  ]);

  // Handle follow/unfollow
  const handleFollow = async () => {
    if (
      !isLoggedIn ||
      !currentUserPubkey ||
      !publish ||
      !subscribe ||
      !fullPubkeyForMeta ||
      !/^[0-9a-f]{64}$/i.test(fullPubkeyForMeta)
    ) {
      alert("Please log in to follow users");
      return;
    }

    setFollowingLoading(true);
    try {
      // Check for NIP-07 first (preferred method - will open signing modal)
      const hasNip07 = typeof window !== "undefined" && window.nostr;
      let privateKey: string | undefined;
      let signerPubkey: string = currentUserPubkey;

      // Check if remote signer is ready (for nowser/bunker)
      const isRemoteSignerReady =
        remoteSigner?.getSession()?.userPubkey &&
        remoteSigner?.getState() === "ready";

      if (hasNip07 && window.nostr) {
        // Use NIP-07 extension or remote signer adapter - this will trigger a popup for the user to sign
        try {
          // For remote signer (nowser), check if it's ready before calling
          if (isRemoteSignerReady || !remoteSigner) {
            // Either remote signer is ready, or it's a regular NIP-07 extension
            signerPubkey = await window.nostr.getPublicKey();
          } else {
            // Remote signer exists but not ready - fall through to private key
            console.warn(
              "⚠️ [Follow] Remote signer not ready, falling back to private key"
            );
            throw new Error("Remote signer not ready");
          }
        } catch (error: any) {
          const errorMsg = error?.message || String(error);
          // If it's a "not paired" error from remote signer, fall back gracefully
          if (
            errorMsg.includes("not paired") ||
            errorMsg.includes("not ready")
          ) {
            console.warn(
              "⚠️ [Follow] Remote signer not paired/ready, falling back to private key:",
              errorMsg
            );
            // Fall through to private key
          } else {
            console.warn(
              "⚠️ [Follow] Failed to get pubkey from NIP-07, using current user pubkey:",
              error
            );
            // For other errors, just use current user pubkey and continue
          }
        }
      }

      // If we didn't get a signer pubkey from NIP-07/remote signer, try private key
      if (!signerPubkey || signerPubkey === currentUserPubkey) {
        privateKey = (await getNostrPrivateKey()) || undefined;
        if (!privateKey) {
          alert(
            "No signing method available.\n\nPlease use a NIP-07 extension (like Alby or nos2x), pair with a remote signer (nowser/bunker), or configure a private key in Settings."
          );
          setFollowingLoading(false);
          return;
        }
      }

      // CRITICAL: Fetch current contact list from Nostr BEFORE modifying it
      // Don't rely on state which might be empty if subscription hasn't completed yet
      // This prevents erasing all existing follows when clicking Follow
      let currentContacts: string[] = [];
      try {
        const contactListPromise = new Promise<string[]>((resolve) => {
          let resolved = false;
          const timeout = setTimeout(() => {
            if (!resolved) {
              resolved = true;
              console.warn(
                "⚠️ [Follow] Timeout fetching contact list, using state as fallback"
              );
              resolve(
                contactList.length > 0
                  ? contactList.map((p) => p.toLowerCase())
                  : []
              );
            }
          }, 3000); // 3 second timeout

          const unsub = subscribe(
            [
              {
                kinds: [3], // Contact list
                authors: [signerPubkey],
                limit: 1,
              },
            ],
            defaultRelays,
            (event) => {
              if (event.kind === 3 && !resolved) {
                resolved = true;
                clearTimeout(timeout);
                try {
                  const contacts = JSON.parse(event.content);
                  if (
                    contacts &&
                    typeof contacts === "object" &&
                    contacts.p &&
                    Array.isArray(contacts.p)
                  ) {
                    const pubkeys = contacts.p
                      .map((p: any) =>
                        typeof p === "string" ? p : p[0] || p.pubkey || ""
                      )
                      .filter(
                        (p: string) =>
                          p && typeof p === "string" && p.length > 0
                      )
                      .map((p: string) => p.toLowerCase());
                    console.log(
                      `✅ [Follow] Fetched ${pubkeys.length} contacts from Nostr`
                    );
                    resolve(pubkeys);
                  } else {
                    // Also check tags as fallback (some clients use tags instead of content)
                    const pTags = event.tags
                      .filter((tag) => tag[0] === "p" && tag[1])
                      .map((tag) => tag[1] as string)
                      .filter((p: string) => p && p.length > 0)
                      .map((p: string) => p.toLowerCase());
                    if (pTags.length > 0) {
                      console.log(
                        `✅ [Follow] Fetched ${pTags.length} contacts from tags`
                      );
                      resolve(pTags);
                    } else {
                      console.warn(
                        "⚠️ [Follow] Contact list event has no contacts"
                      );
                      resolve([]);
                    }
                  }
                } catch (e) {
                  console.error("❌ [Follow] Failed to parse contact list:", e);
                  // Fallback: extract from tags
                  const pTags = event.tags
                    .filter((tag) => tag[0] === "p" && tag[1])
                    .map((tag) => tag[1] as string)
                    .filter((p: string) => p && p.length > 0)
                    .map((p: string) => p.toLowerCase());
                  resolve(
                    pTags.length > 0
                      ? pTags
                      : contactList.length > 0
                      ? contactList.map((p) => p.toLowerCase())
                      : []
                  );
                }
                if (unsub) unsub();
              }
            },
            undefined,
            () => {
              if (!resolved) {
                resolved = true;
                clearTimeout(timeout);
                console.warn(
                  "⚠️ [Follow] Subscription ended without event, using state as fallback"
                );
                resolve(
                  contactList.length > 0
                    ? contactList.map((p) => p.toLowerCase())
                    : []
                );
              }
              if (unsub) unsub();
            }
          );
        });

        currentContacts = await contactListPromise;
        console.log(
          `✅ [Follow] Using ${currentContacts.length} contacts from Nostr (state had ${contactList.length})`
        );
      } catch (error) {
        console.error("❌ [Follow] Error fetching contact list:", error);
        // Fallback to state if fetch fails
        currentContacts =
          contactList.length > 0 ? contactList.map((p) => p.toLowerCase()) : [];
        console.warn(
          `⚠️ [Follow] Falling back to state: ${currentContacts.length} contacts`
        );
      }

      // Start with the fetched contact list (or state as fallback)
      // Normalize all existing contacts to lowercase for consistent comparison
      let newContacts = currentContacts.map((p) => p.toLowerCase());
      const targetPubkey = fullPubkeyForMeta.toLowerCase();

      if (isFollowing) {
        // Unfollow: remove from list
        newContacts = newContacts.filter((p) => p !== targetPubkey);
      } else {
        // Follow: add to list
        if (!newContacts.includes(targetPubkey)) {
          newContacts.push(targetPubkey);
        }
      }

      // Create kind 3 contact list event
      const contactListContent = {
        p: newContacts.map((pubkey) => [pubkey, "", "wss://relay.damus.io"]), // Format: [pubkey, relay, petname]
      };

      const event = {
        kind: 3,
        created_at: Math.floor(Date.now() / 1000),
        tags: newContacts.map((pubkey) => ["p", pubkey]),
        content: JSON.stringify(contactListContent),
        pubkey: signerPubkey,
        id: "",
        sig: "",
      };

      event.id = getEventHash(event);

      // Sign with NIP-07/remote signer or private key
      if (hasNip07 && window.nostr) {
        // Use NIP-07 extension or remote signer adapter - this will open the signing modal
        try {
          // For remote signer (nowser), check if it's ready before calling
          if (isRemoteSignerReady || !remoteSigner) {
            // Either remote signer is ready, or it's a regular NIP-07 extension
            const signedEvent = await window.nostr.signEvent(event);
            event.sig = signedEvent.sig;
          } else {
            // Remote signer exists but not ready - fall back to private key
            if (privateKey) {
              event.sig = signEvent(event, privateKey);
            } else {
              throw new Error(
                "Remote signer not ready and no private key available"
              );
            }
          }
        } catch (error: any) {
          const errorMsg = error?.message || String(error);
          // If it's a "not paired" error from remote signer, fall back to private key
          if (
            errorMsg.includes("not paired") ||
            errorMsg.includes("not ready")
          ) {
            console.warn(
              "⚠️ [Follow] Remote signer not paired/ready, falling back to private key for signing"
            );
            if (privateKey) {
              event.sig = signEvent(event, privateKey);
            } else {
              throw new Error(
                "Remote signer not ready and no private key available"
              );
            }
          } else {
            // Re-throw other errors (user cancellation, etc.)
            throw error;
          }
        }
      } else if (privateKey) {
        // Use private key (fallback)
        event.sig = signEvent(event, privateKey);
      } else {
        throw new Error("No signing method available");
      }

      // Publish to relays
      publish(event, defaultRelays);

      // Update local state
      setIsFollowing(!isFollowing);
      setContactList(newContacts);

      console.log(
        `✅ ${
          isFollowing ? "Unfollowed" : "Followed"
        } user ${fullPubkeyForMeta.slice(0, 8)}`
      );
    } catch (error: any) {
      console.error("Failed to follow/unfollow:", error);
      const errorMessage =
        error?.message || error?.toString() || "Unknown error";
      if (
        errorMessage.includes("cancel") ||
        errorMessage.includes("reject") ||
        errorMessage.includes("User rejected")
      ) {
        // User canceled signing - don't show error, just stop loading
        console.log("Follow/unfollow canceled by user");
      } else {
        alert(
          `Failed to ${isFollowing ? "unfollow" : "follow"}: ${errorMessage}`
        );
      }
    } finally {
      setFollowingLoading(false);
    }
  };

  // Check if viewing own profile
  const isOwnProfile =
    currentUserPubkey &&
    fullPubkeyForMeta &&
    /^[0-9a-f]{64}$/i.test(fullPubkeyForMeta) &&
    currentUserPubkey.toLowerCase() === fullPubkeyForMeta.toLowerCase();

  // Early return check - MUST be after all hooks
  if (!isPubkey) {
    return null; // Redirecting
  }

  // Calculate contribution graph for display (last 52 weeks)
  const weeks = contributionGraph.slice(-52);
  const maxCount = Math.max(...weeks.map((w) => w.count), 1);

  // CRITICAL: Use more granular intensity levels to create visually distinct legend dots
  // Always use at least 6 distinct levels (excluding 0) for better visual differentiation
  // For low maxCounts: use evenly spaced linear levels
  // For high maxCounts: use logarithmic-like scaling
  let intensityLevels: number[];
  if (maxCount < 10) {
    // For very low counts, use evenly spaced levels
    // Example: maxCount=5 -> [0, 1, 2, 3, 4, 5]
    intensityLevels = [
      0,
      Math.max(1, Math.ceil(maxCount * 0.2)), // 20%
      Math.max(2, Math.ceil(maxCount * 0.4)), // 40%
      Math.max(3, Math.ceil(maxCount * 0.6)), // 60%
      Math.max(4, Math.ceil(maxCount * 0.8)), // 80%
      maxCount, // 100%
    ];
  } else if (maxCount < 30) {
    // For low counts, use more granular levels
    // Example: maxCount=14 -> [0, 2, 5, 8, 11, 14]
    intensityLevels = [
      0,
      Math.max(1, Math.ceil(maxCount * 0.15)), // ~15%
      Math.max(2, Math.ceil(maxCount * 0.35)), // ~35%
      Math.max(3, Math.ceil(maxCount * 0.55)), // ~55%
      Math.max(5, Math.ceil(maxCount * 0.75)), // ~75%
      maxCount, // 100%
    ];
  } else {
    // For high counts, use logarithmic-like scaling
    // Example: maxCount=245 -> [0, 5, 20, 60, 150, 245]
    intensityLevels = [
      0,
      Math.max(1, Math.round(maxCount * 0.02)), // ~2% (very light)
      Math.max(2, Math.round(maxCount * 0.08)), // ~8% (light)
      Math.max(3, Math.round(maxCount * 0.25)), // ~25% (medium)
      Math.max(5, Math.round(maxCount * 0.6)), // ~60% (high)
      maxCount, // 100% (maximum)
    ];
  }

  const getIntensity = (count: number) => {
    if (count === 0) return "bg-gray-800 border border-gray-700";
    const level1 = intensityLevels[1] ?? 1;
    const level2 = intensityLevels[2] ?? 3;
    const level3 = intensityLevels[3] ?? 10;
    const level4 = intensityLevels[4] ?? 30;
    const level5 = intensityLevels[5] ?? 100;
    // Use more distinct color differences - from very dark to very bright
    if (count <= level1) return "bg-green-950 border border-green-900"; // Darkest
    if (count <= level2) return "bg-green-900 border border-green-800";
    if (count <= level3) return "bg-green-700 border border-green-600";
    if (count <= level4) return "bg-green-500 border border-green-400";
    if (count <= level5) return "bg-green-400 border border-green-300";
    return "bg-green-300 border border-green-200"; // Brightest
  };

  return (
    <div className="container mx-auto max-w-6xl p-3 sm:p-4 md:p-6">
      {/* Banner */}
      {banner && (
        <div className="mb-4 sm:mb-6 rounded-lg overflow-hidden h-32 sm:h-40 md:h-48 bg-gradient-to-r from-purple-600 to-blue-600">
          <img
            src={banner}
            alt={`${displayName} banner`}
            className="w-full h-full object-cover"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        </div>
      )}

      {/* User Profile Header */}
      <div className="mb-4 sm:mb-6 border border-[#383B42] rounded-lg p-3 sm:p-4 md:p-6 bg-[#171B21]">
        <div className="flex flex-col md:flex-row items-start gap-4 sm:gap-6">
          {/* Avatar */}
          <div className="relative">
            {picture && picture.startsWith("http") ? (
              <img
                src={picture}
                alt={displayName}
                className="w-24 h-24 sm:w-28 sm:h-28 md:w-32 md:h-32 rounded-full border-4 border-[#171B21] shrink-0 object-cover"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                  const fallback = (e.target as HTMLElement)
                    .nextElementSibling as HTMLElement;
                  if (fallback) fallback.style.display = "flex";
                }}
              />
            ) : null}
            <div
              className={`w-24 h-24 sm:w-28 sm:h-28 md:w-32 md:h-32 rounded-full border-4 border-[#171B21] bg-purple-600 flex items-center justify-center text-2xl sm:text-3xl md:text-4xl font-bold text-white shrink-0 ${
                picture && picture.startsWith("http") ? "hidden" : ""
              }`}
            >
              {/* Use first 2 chars of displayName, but ensure it's not from npub or pubkey */}
              {(() => {
                if (
                  displayName &&
                  displayName.length > 0 &&
                  !displayName.startsWith("npub") &&
                  !/^[0-9a-f]{8,64}$/i.test(displayName) &&
                  displayName.length <= 20
                ) {
                  return displayName.substring(0, 2).toUpperCase();
                }
                // Try to get initials from userMeta
                if (
                  userMeta?.name &&
                  !userMeta.name.startsWith("npub") &&
                  !/^[0-9a-f]{8,64}$/i.test(userMeta.name)
                ) {
                  return userMeta.name.substring(0, 2).toUpperCase();
                }
                if (
                  userMeta?.display_name &&
                  !userMeta.display_name.startsWith("npub") &&
                  !/^[0-9a-f]{8,64}$/i.test(userMeta.display_name)
                ) {
                  return userMeta.display_name.substring(0, 2).toUpperCase();
                }
                // Last resort: use pubkey prefix
                return fullPubkeyForMeta
                  ? fullPubkeyForMeta.slice(0, 2).toUpperCase()
                  : "??";
              })()}
            </div>
            {nip05 && (
              <div className="absolute -bottom-2 left-1/2 transform -translate-x-1/2 bg-green-500 rounded-full p-1">
                <CheckCircle2 className="w-4 h-4 text-white" />
              </div>
            )}
          </div>

          {/* Profile Info */}
          <div className="flex-1 w-full min-w-0">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-0 mb-3 sm:mb-4">
              <div className="flex-1 min-w-0">
                <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold mb-2 break-words">
                  {displayName}
                </h1>
                {nip05 && (
                  <div className="flex items-center gap-2 text-gray-400 mb-2">
                    <CheckCircle2 className="w-4 h-4 text-green-500" />
                    <span>{nip05}</span>
                  </div>
                )}
                {about && (
                  <p className="text-gray-300 mb-3 sm:mb-4 max-w-2xl break-words text-sm sm:text-base">
                    {about}
                  </p>
                )}
              </div>

              {/* Follow Button */}
              <div className="flex-shrink-0">
                {isLoggedIn && !isOwnProfile && (
                  <Button
                    onClick={handleFollow}
                    disabled={followingLoading || isFollowing}
                    variant={isFollowing ? "outline" : "default"}
                    className={
                      isFollowing
                        ? "border-purple-500 text-purple-400 cursor-default"
                        : "bg-purple-600 hover:bg-purple-700"
                    }
                  >
                    {followingLoading ? (
                      "Loading..."
                    ) : isFollowing ? (
                      <>
                        <UserCheck className="w-4 h-4 mr-2" />
                        Following
                      </>
                    ) : (
                      <>
                        <UserPlus className="w-4 h-4 mr-2" />
                        Follow
                      </>
                    )}
                  </Button>
                )}
                {isOwnProfile && (
                  <Button
                    onClick={() => router.push("/settings/profile")}
                    variant="outline"
                    className="border-purple-500 text-purple-400"
                  >
                    Edit Profile
                  </Button>
                )}
              </div>
            </div>

            {/* Stats Row - Shows data from Nostr (repos) and local activities (commits, PRs, bounties) */}
            <div className="flex flex-wrap gap-3 sm:gap-4 md:gap-6 text-xs sm:text-sm mb-3 sm:mb-4">
              <div className="flex items-center gap-2">
                <span className="text-gray-400">Repositories</span>
                <span className="text-purple-400 font-semibold">
                  {userRepos.length}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-gray-400">Pushes</span>
                <span className="text-green-400 font-semibold">
                  {/* Show localStorage immediately, update if Nostr has higher value */}
                  {nostrActivityCounts &&
                  nostrActivityCounts.pushes >
                    (activityCounts.commit_created || 0)
                    ? nostrActivityCounts.pushes
                    : activityCounts.commit_created || 0}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-gray-400">PRs Merged</span>
                <span className="text-cyan-400 font-semibold">
                  {/* Show localStorage immediately, update if Nostr has higher value */}
                  {nostrActivityCounts &&
                  nostrActivityCounts.prsMerged >
                    (activityCounts.pr_merged || 0)
                    ? nostrActivityCounts.prsMerged
                    : activityCounts.pr_merged || 0}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-gray-400">Bounties</span>
                <span className="text-yellow-400 font-semibold">
                  {activityCounts.bounty_claimed || 0}
                </span>
              </div>
            </div>

            {/* Links */}
            <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2 sm:gap-3 md:gap-4">
              {website && (
                <a
                  href={
                    website.startsWith("http") ? website : `https://${website}`
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-purple-400 hover:text-purple-300 text-xs sm:text-sm min-w-0"
                >
                  <Globe className="w-3 h-3 sm:w-4 sm:h-4 shrink-0" />
                  <span className="truncate break-all">
                    {website.replace(/^https?:\/\//, "")}
                  </span>
                  <ExternalLink className="w-3 h-3 shrink-0" />
                </a>
              )}
              {(lud16 || lnurl) && (
                <div className="flex items-center gap-2 text-yellow-400 text-xs sm:text-sm min-w-0">
                  <Zap className="w-3 h-3 sm:w-4 sm:h-4 shrink-0" />
                  <span className="truncate break-all">
                    Lightning: {lud16 || lnurl}
                  </span>
                </div>
              )}
              {displayPubkey && (
                <div className="flex items-center gap-2 text-gray-400 text-xs font-mono min-w-0 max-w-full">
                  <span className="truncate break-all">
                    npub: {displayPubkey}
                  </span>
                  <a
                    href={`https://nostr.com/${displayPubkey}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-purple-400 hover:text-purple-300 shrink-0"
                  >
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              )}
              {fullPubkeyForMeta &&
                /^[0-9a-f]{64}$/i.test(fullPubkeyForMeta) && (
                  <div className="flex items-center gap-2 text-gray-400 text-xs font-mono min-w-0 max-w-full">
                    <span className="truncate break-all">
                      pubkey: {fullPubkeyForMeta}
                    </span>
                  </div>
                )}
            </div>

            {/* Claimed Identities (NIP-39) */}
            {(() => {
              // Debug: Log what we have
              if (userMeta) {
                console.log(
                  `🔍 [Profile] userMeta for ${fullPubkeyForMeta?.slice(
                    0,
                    8
                  )}:`,
                  {
                    hasIdentities: !!userMeta.identities,
                    identitiesCount: userMeta.identities?.length || 0,
                    identities: userMeta.identities,
                    allKeys: Object.keys(userMeta),
                    metadataMapSize: Object.keys(metadataMap).length,
                    metadataMapHasPubkey: !!(
                      pubkeyForMetadata &&
                      metadataMap[pubkeyForMetadata.toLowerCase()]
                    ),
                    metadataMapIdentities: pubkeyForMetadata
                      ? metadataMap[pubkeyForMetadata.toLowerCase()]
                          ?.identities || []
                      : [],
                  }
                );
              }
              return null;
            })()}
            {userMeta?.identities &&
              Array.isArray(userMeta.identities) &&
              userMeta.identities.length > 0 && (
                <div className="mt-3 sm:mt-4 pt-3 sm:pt-4 border-t border-[#383B42]">
                  <h3 className="text-xs sm:text-sm font-semibold text-gray-400 mb-2">
                    Verified Identities
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {userMeta.identities.map(
                      (identity: ClaimedIdentity, idx: number) => {
                        const platformIcon =
                          identity.platform === "github"
                            ? "🐙"
                            : identity.platform === "twitter"
                            ? "🐦"
                            : identity.platform === "telegram"
                            ? "✈️"
                            : identity.platform === "mastodon"
                            ? "🐘"
                            : "🔗";
                        const platformUrl =
                          identity.platform === "github"
                            ? `https://github.com/${identity.identity}`
                            : identity.platform === "twitter"
                            ? `https://x.com/${identity.identity}`
                            : identity.platform === "telegram"
                            ? identity.proof
                              ? `https://t.me/${identity.proof}`
                              : null
                            : identity.platform === "mastodon"
                            ? identity.identity.includes("@")
                              ? `https://${identity.identity.split("@")[1]}/@${
                                  identity.identity.split("@")[0]
                                }`
                              : null
                            : null;
                        const platformName =
                          identity.platform === "twitter"
                            ? "X"
                            : identity.platform === "telegram"
                            ? "Telegram"
                            : identity.platform === "mastodon"
                            ? "Mastodon"
                            : identity.platform.charAt(0).toUpperCase() +
                              identity.platform.slice(1);
                        const identityDisplay =
                          identity.platform === "telegram"
                            ? `User ID: ${identity.identity}`
                            : identity.platform === "mastodon"
                            ? identity.identity
                            : `@${identity.identity}`;

                        return (
                          <a
                            key={idx}
                            href={platformUrl || "#"}
                            target={platformUrl ? "_blank" : undefined}
                            rel={
                              platformUrl ? "noopener noreferrer" : undefined
                            }
                            className="flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-1 sm:py-1.5 bg-[#22262C] border border-[#383B42] rounded-md text-xs sm:text-sm hover:bg-[#2a2e34] hover:border-purple-500/50 transition-colors"
                            title={
                              identity.proof
                                ? `Proof: ${identity.proof}`
                                : "No proof available"
                            }
                          >
                            <span>{platformIcon}</span>
                            <span className="text-gray-300">
                              {platformName}
                            </span>
                            <span className="text-purple-400">
                              {identityDisplay}
                            </span>
                            {identity.verified && (
                              <span title="Verified">
                                <CheckCircle2 className="w-4 h-4 text-green-500" />
                              </span>
                            )}
                          </a>
                        );
                      }
                    )}
                  </div>
                </div>
              )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
        {/* Contribution Graph */}
        <div className="lg:col-span-2 border border-[#383B42] rounded p-3 sm:p-4">
          <div className="flex items-center gap-2 mb-3 sm:mb-4">
            <h2 className="text-base sm:text-lg font-semibold">
              Activity Timeline
            </h2>
            <Tooltip
              content="Shows contributions over the last 52 weeks (1 year). Each box represents one week. Darker green indicates more contributions. Data comes from: Git commits synced from git-nostr-bridge, Pull requests and issues from Nostr network, Repository creation events. Counts are updated in real-time as you push code or create PRs/issues."
              mobileClickable={true}
              className="inline-flex"
            >
              <HelpCircle className="w-4 h-4 text-gray-400 hover:text-gray-300 cursor-help" />
            </Tooltip>
          </div>
          <div className="w-full overflow-x-auto">
            <div className="w-full min-w-max sm:min-w-0">
              {/* Calculate box size to fit all weeks in container (52 weeks = 364 days) */}
              {/* Use CSS grid or flex with calculated width to fit all boxes in one row */}
              <div
                className="flex gap-0.5 sm:gap-1 mb-2"
                style={{ width: "100%", minWidth: "max-content" }}
              >
                {weeks.map((week, idx) => {
                  // Calculate box width as percentage to fit all weeks: 100% / number of weeks
                  // Use min 2px width, max 12px width for readability
                  // Since we have 52 weeks, each box should be ~1.92% of container width
                  const boxWidthPercent = 100 / weeks.length;
                  const minBoxSize = 2; // Minimum 2px for visibility
                  const maxBoxSize = 12; // Maximum 12px for readability

                  // Use calc() to ensure boxes fit: min(max(calc(100% / weeks.length - gap), minBoxSize), maxBoxSize)
                  // But since we can't use calc() in inline styles easily, use a fixed calculation
                  // For 52 weeks with 1px gap, each box gets ~1.9% width
                  return (
                    <div
                      key={idx}
                      className={`${getIntensity(
                        week.count
                      )} rounded-sm flex-shrink-0`}
                      style={{
                        width: `calc(${boxWidthPercent}% - ${
                          ((weeks.length - 1) * 4) / weeks.length
                        }px)`,
                        minWidth: `${minBoxSize}px`,
                        maxWidth: `${maxBoxSize}px`,
                        height: `calc(${boxWidthPercent}% - ${
                          ((weeks.length - 1) * 4) / weeks.length
                        }px)`,
                        minHeight: `${minBoxSize}px`,
                        maxHeight: `${maxBoxSize}px`,
                      }}
                      title={`${week.date}: ${week.count} contributions`}
                    />
                  );
                })}
              </div>
              <div className="flex justify-between text-xs text-gray-500 mt-2">
                <span>Less</span>
                <div className="flex gap-1">
                  {/* Show all intensity levels (excluding level 0) - each dot represents a distinct threshold */}
                  {intensityLevels.slice(1).map((level, idx) => {
                    const val = level ?? 0;
                    const intensityClass = getIntensity(val);
                    // Debug: Log to verify distinct colors
                    if (idx === 0) {
                      console.log(
                        `🎨 [Activity Timeline] Legend dots for maxCount=${maxCount}:`,
                        intensityLevels
                          .slice(1)
                          .map((l) => ({ level: l, color: getIntensity(l) }))
                      );
                    }
                    return (
                      <div
                        key={idx}
                        className={`w-2 h-2 ${intensityClass} rounded-sm`}
                        title={`${val} contributions`}
                      />
                    );
                  })}
                </div>
                <span>More</span>
              </div>
              <p className="text-xs sm:text-sm text-gray-400 mt-2">
                {userStats?.activityCount || 0} contributions in the last year
              </p>
            </div>
          </div>
        </div>

        {/* Stats Sidebar - Shows local activity data (from localStorage) */}
        <div className="space-y-3 sm:space-y-4">
          <div className="border border-[#383B42] rounded p-3 sm:p-4">
            <div className="flex items-center gap-2 mb-2">
              <h3 className="text-sm sm:text-base font-semibold">Statistics</h3>
              <Tooltip
                content="Activity counts from the Nostr network and local storage. Total Activity: All contributions (pushes, PRs, issues, bounties). Pushes: Git commits pushed to repositories. PRs Merged: Pull requests that were merged. Bounties Claimed: Bounties completed. Repositories: Total number of repos. Data is shown immediately from local storage, then updated from Nostr network if higher values are found. These are all-time counts (not limited to the last year)."
                mobileClickable={true}
                className="inline-flex"
              >
                <HelpCircle className="w-4 h-4 text-gray-400 hover:text-gray-300 cursor-help" />
              </Tooltip>
            </div>
            <p className="text-xs text-gray-500 mb-2 sm:mb-3">
              {nostrActivityCounts
                ? "Activity from Nostr network"
                : "Local activity data"}
            </p>
            <div className="space-y-1.5 sm:space-y-2 text-xs sm:text-sm">
              <div className="flex justify-between">
                <span className="text-gray-400">Total Activity</span>
                <span className="text-purple-400">
                  {/* Show localStorage immediately, update if Nostr has higher value */}
                  {nostrActivityCounts &&
                  nostrActivityCounts.total > (userStats?.activityCount || 0)
                    ? nostrActivityCounts.total
                    : userStats?.activityCount || 0}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Pushes</span>
                <span className="text-green-400">
                  {/* Show localStorage immediately, update if Nostr has higher value */}
                  {nostrActivityCounts &&
                  nostrActivityCounts.pushes >
                    (activityCounts.commit_created || 0)
                    ? nostrActivityCounts.pushes
                    : activityCounts.commit_created || 0}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">PRs Merged</span>
                <span className="text-cyan-400">
                  {/* Show localStorage immediately, update if Nostr has higher value */}
                  {nostrActivityCounts &&
                  nostrActivityCounts.prsMerged >
                    (activityCounts.pr_merged || 0)
                    ? nostrActivityCounts.prsMerged
                    : activityCounts.pr_merged || 0}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Bounties Claimed</span>
                <span className="text-yellow-400">
                  {activityCounts.bounty_claimed || 0}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Repositories</span>
                <span className="text-purple-400">{userRepos.length || 0}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* User Repositories */}
      {userRepos.length > 0 && (
        <div className="mt-6 border border-[#383B42] rounded-lg p-6 bg-[#171B21]">
          <h2 className="text-2xl font-semibold mb-6">
            Repositories ({userRepos.length})
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {userRepos.map((repo: any) => {
              // CRITICAL: For URLs, use slugified version (repo/slug/repositoryName)
              // For display, use original name (repo.name)
              const repoForUrl = repo.repo || repo.slug;
              const repoDisplayName = repo.name || repoForUrl; // CRITICAL: Use original name for display
              // Use npub format for URLs if we have full pubkey
              let href = `/${repo.entity}/${repoForUrl}`;
              if (
                repo.ownerPubkey &&
                /^[0-9a-f]{64}$/i.test(repo.ownerPubkey)
              ) {
                try {
                  const npub = nip19.npubEncode(repo.ownerPubkey);
                  href = `/${npub}/${repoForUrl}`;
                } catch {}
              }

              // Resolve repo icon (same pattern as explore/homepage)
              let iconUrl: string | null = null;
              try {
                // Priority 1: Stored logoUrl
                if (repo.logoUrl && repo.logoUrl.trim().length > 0) {
                  iconUrl = repo.logoUrl;
                } else if (repo.files && repo.files.length > 0) {
                  // Priority 2: Logo/repo image file from repo
                  const repoName = (repo.repo || repo.slug || repo.name || "")
                    .toLowerCase()
                    .replace(/[^a-z0-9]/g, "");
                  const imageExts = [
                    "png",
                    "jpg",
                    "jpeg",
                    "gif",
                    "webp",
                    "svg",
                    "ico",
                  ];

                  // Find all potential icon files with proper prioritization:
                  // 1. Exact "logo" files (highest priority)
                  // 2. Files named after the repo (e.g., "tides.png" for tides repo)
                  // 3. Common icon names in root (repo.png, icon.png, etc.)
                  const iconFiles = repo.files
                    .map((f: any) => f.path)
                    .filter((p: string) => {
                      const fileName = p.split("/").pop() || "";
                      const baseName = fileName
                        .replace(/\.[^.]+$/, "")
                        .toLowerCase();
                      const extension =
                        fileName.split(".").pop()?.toLowerCase() || "";
                      const isRoot = p.split("/").length === 1;

                      if (!imageExts.includes(extension)) return false;

                      // Match logo files, but exclude third-party logos (alby, etc.)
                      if (
                        baseName.includes("logo") &&
                        !baseName.includes("logo-alby") &&
                        !baseName.includes("alby-logo")
                      )
                        return true;

                      // Match repo-name-based files (e.g., "tides.png" for tides repo)
                      if (repoName && baseName === repoName) return true;

                      // Match common icon names in root directory
                      if (
                        isRoot &&
                        (baseName === "repo" ||
                          baseName === "icon" ||
                          baseName === "favicon")
                      )
                        return true;

                      return false;
                    })
                    .sort((a: string, b: string) => {
                      const aParts = a.split("/");
                      const bParts = b.split("/");
                      const aName =
                        aParts[aParts.length - 1]
                          ?.replace(/\.[^.]+$/, "")
                          .toLowerCase() || "";
                      const bName =
                        bParts[bParts.length - 1]
                          ?.replace(/\.[^.]+$/, "")
                          .toLowerCase() || "";
                      const aIsRoot = aParts.length === 1;
                      const bIsRoot = bParts.length === 1;

                      // Priority 1: Exact "logo" match
                      if (aName === "logo" && bName !== "logo") return -1;
                      if (bName === "logo" && aName !== "logo") return 1;

                      // Priority 2: Repo-name-based files
                      if (
                        repoName &&
                        aName === repoName &&
                        bName !== repoName &&
                        bName !== "logo"
                      )
                        return -1;
                      if (
                        repoName &&
                        bName === repoName &&
                        aName !== repoName &&
                        aName !== "logo"
                      )
                        return 1;

                      // Priority 3: Root directory files
                      if (aName === "logo" && bName === "logo") {
                        if (aIsRoot && !bIsRoot) return -1;
                        if (!aIsRoot && bIsRoot) return 1;
                      }
                      if (aIsRoot && !bIsRoot) return -1;
                      if (!bIsRoot && aIsRoot) return 1;

                      // Priority 4: Format preference (png > svg > webp > jpg > gif > ico)
                      const formatPriority: Record<string, number> = {
                        png: 0,
                        svg: 1,
                        webp: 2,
                        jpg: 3,
                        jpeg: 3,
                        gif: 4,
                        ico: 5,
                      };
                      const aExt = a.split(".").pop()?.toLowerCase() || "";
                      const bExt = b.split(".").pop()?.toLowerCase() || "";
                      const aPrio = formatPriority[aExt] ?? 10;
                      const bPrio = formatPriority[bExt] ?? 10;

                      return aPrio - bPrio;
                    });

                  const logoFiles = iconFiles;
                  if (logoFiles.length > 0) {
                    const logoPath = logoFiles[0];

                    // Helper function to extract owner/repo from various URL formats
                    const extractOwnerRepo = (
                      urlString: string
                    ): {
                      owner: string;
                      repo: string;
                      hostname: string;
                    } | null => {
                      try {
                        // Handle SSH format: git@github.com:owner/repo.git
                        if (
                          urlString.includes("@") &&
                          urlString.includes(":")
                        ) {
                          const match = urlString.match(
                            /(?:git@|https?:\/\/)([^\/:]+)[\/:]([^\/]+)\/([^\/]+?)(?:\.git)?$/
                          );
                          if (match && match[1] && match[2] && match[3]) {
                            const hostname = match[1]!;
                            const owner = match[2]!;
                            const repo = match[3]!.replace(/\.git$/, "");
                            return { owner, repo, hostname };
                          }
                        }

                        // Handle HTTPS/HTTP URLs
                        const url = new URL(urlString);
                        const parts = url.pathname.split("/").filter(Boolean);
                        if (parts.length >= 2 && parts[0] && parts[1]) {
                          return {
                            owner: parts[0],
                            repo: parts[1].replace(/\.git$/, ""),
                            hostname: url.hostname,
                          };
                        }
                      } catch (e) {
                        // Invalid URL format
                      }
                      return null;
                    };

                    // Try sourceUrl first
                    let gitUrl: string | undefined = repo.sourceUrl;
                    let ownerRepo: {
                      owner: string;
                      repo: string;
                      hostname: string;
                    } | null = null;

                    if (gitUrl) {
                      ownerRepo = extractOwnerRepo(gitUrl);
                    }

                    // If sourceUrl didn't work, try clone array
                    if (
                      !ownerRepo &&
                      (repo as any).clone &&
                      Array.isArray((repo as any).clone) &&
                      (repo as any).clone.length > 0
                    ) {
                      // Find first GitHub/GitLab/Codeberg URL in clone array
                      const gitCloneUrl = (repo as any).clone.find(
                        (url: string) =>
                          url &&
                          (url.includes("github.com") ||
                            url.includes("gitlab.com") ||
                            url.includes("codeberg.org"))
                      );
                      if (gitCloneUrl) {
                        ownerRepo = extractOwnerRepo(gitCloneUrl);
                      }
                    }

                    // If we found a valid git URL, construct raw URL
                    if (ownerRepo) {
                      const { owner, repo: repoName, hostname } = ownerRepo;
                      const branch = repo.defaultBranch || "main";

                      if (
                        hostname === "github.com" ||
                        hostname.includes("github.com")
                      ) {
                        iconUrl = `https://raw.githubusercontent.com/${owner}/${repoName}/${encodeURIComponent(
                          branch
                        )}/${logoPath}`;
                      } else if (
                        hostname === "gitlab.com" ||
                        hostname.includes("gitlab.com")
                      ) {
                        iconUrl = `https://gitlab.com/${owner}/${repoName}/-/raw/${encodeURIComponent(
                          branch
                        )}/${logoPath}`;
                      } else if (
                        hostname === "codeberg.org" ||
                        hostname.includes("codeberg.org")
                      ) {
                        iconUrl = `https://codeberg.org/${owner}/${repoName}/raw/branch/${encodeURIComponent(
                          branch
                        )}/${logoPath}`;
                      }
                    } else {
                      // For native Nostr repos (without sourceUrl), use the API endpoint
                      // CRITICAL: Use repositoryName from Nostr event (exact name used by git-nostr-bridge)
                      // Priority: repositoryName > repo > slug > name
                      const ownerPubkey =
                        repo.ownerPubkey ||
                        getRepoOwnerPubkey(repo, repo.entity);
                      const repoDataAny = repo as any;
                      let repoName =
                        repoDataAny?.repositoryName ||
                        repo.repo ||
                        repo.slug ||
                        repo.name;

                      // Extract repo name (handle paths like "gitnostr.com/gitworkshop")
                      if (
                        repoName &&
                        typeof repoName === "string" &&
                        repoName.includes("/")
                      ) {
                        const parts = repoName.split("/");
                        repoName = parts[parts.length - 1] || repoName;
                      }
                      if (repoName) {
                        repoName = String(repoName).replace(/\.git$/, "");
                      }

                      if (
                        ownerPubkey &&
                        /^[0-9a-f]{64}$/i.test(ownerPubkey) &&
                        repoName
                      ) {
                        const branch = repo.defaultBranch || "main";
                        iconUrl = `/api/nostr/repo/file-content?ownerPubkey=${encodeURIComponent(
                          ownerPubkey
                        )}&repo=${encodeURIComponent(
                          repoName
                        )}&path=${encodeURIComponent(
                          logoPath
                        )}&branch=${encodeURIComponent(branch)}`;
                      }
                    }
                  }
                }

                // Priority 3: Owner Nostr profile picture (last fallback)
                const ownerPubkey =
                  repo.ownerPubkey || getRepoOwnerPubkey(repo, repo.entity);
                if (ownerPubkey && /^[0-9a-f]{64}$/i.test(ownerPubkey)) {
                  // CRITICAL: Use centralized getUserMetadata function for consistent lookup
                  const ownerMeta = getUserMetadata(ownerPubkey, metadataMap);
                  if (ownerMeta?.picture && !iconUrl) {
                    const picture = ownerMeta.picture;
                    if (
                      picture &&
                      picture.trim().length > 0 &&
                      picture.startsWith("http")
                    ) {
                      iconUrl = picture;
                    }
                  }
                }
              } catch (error) {
                console.error("⚠️ [Profile] Error resolving repo icon:", error);
              }

              // Color coding by role (like contributor icons)
              const roleColors = {
                owner: "border-purple-500/50 bg-purple-900/10",
                maintainer: "border-blue-500/50 bg-blue-900/10",
                contributor: "border-green-500/50 bg-green-900/10",
                forked: "border-orange-500/50 bg-orange-900/10",
              };
              const userRole = (repo.userRole ||
                "contributor") as keyof typeof roleColors;
              const roleColor = roleColors[userRole] || "border-[#383B42]";

              return (
                <a
                  key={repo.slug}
                  href={href}
                  onClick={(e) => {
                    e.preventDefault();
                    window.location.href = href;
                  }}
                  className={`border rounded-lg p-4 hover:bg-gray-800/50 transition-all cursor-pointer ${roleColor}`}
                >
                  <div className="flex items-start gap-3">
                    {/* Repo icon with fallback */}
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <div className="relative h-10 w-10">
                        {iconUrl ? (
                          <img
                            src={iconUrl}
                            alt="repo"
                            className="h-10 w-10 rounded object-cover"
                            onError={(e) => {
                              // Fallback to gray box if image fails
                              const target = e.target as HTMLImageElement;
                              target.style.display = "none";
                              const parent = target.parentElement;
                              if (
                                parent &&
                                !parent.querySelector(".fallback-icon")
                              ) {
                                const fallback = document.createElement("div");
                                fallback.className =
                                  "fallback-icon h-10 w-10 rounded bg-gray-700 border border-gray-600";
                                parent.appendChild(fallback);
                              }
                            }}
                          />
                        ) : (
                          <div className="h-10 w-10 rounded bg-gray-700 border border-gray-600" />
                        )}
                      </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <h3 className="font-semibold text-purple-400 truncate">
                          {repoDisplayName}
                        </h3>
                        {repo.userRole && (
                          <span
                            className={`text-xs px-2 py-0.5 rounded ${
                              repo.userRole === "owner"
                                ? "bg-purple-600/30 text-purple-300"
                                : repo.userRole === "maintainer"
                                ? "bg-blue-600/30 text-blue-300"
                                : repo.userRole === "contributor"
                                ? "bg-green-600/30 text-green-300"
                                : "bg-orange-600/30 text-orange-300"
                            }`}
                          >
                            {repo.userRole}
                          </span>
                        )}
                        {/* Status badge - only show for repos owned by current user */}
                        {currentUserPubkey &&
                          repo.ownerPubkey &&
                          repo.ownerPubkey.toLowerCase() ===
                            currentUserPubkey.toLowerCase() &&
                          (() => {
                            const status = getRepoStatus(repo);
                            const style = getStatusBadgeStyle(status);
                            return (
                              <span
                                className={`text-xs px-2 py-0.5 rounded ${style.bg} ${style.text} flex-shrink-0`}
                              >
                                {style.label}
                              </span>
                            );
                          })()}
                      </div>
                      {repo.description && (
                        <p className="text-sm text-gray-400 mt-1 line-clamp-2">
                          {repo.description}
                        </p>
                      )}
                      <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
                        {repo.stars !== undefined && (
                          <span>⭐ {repo.stars || 0}</span>
                        )}
                        {repo.forks !== undefined && (
                          <span>🍴 {repo.forks || 0}</span>
                        )}
                      </div>
                    </div>
                  </div>
                </a>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
