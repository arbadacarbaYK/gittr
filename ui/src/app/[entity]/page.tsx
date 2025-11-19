"use client";
import { useEffect, useState, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useContributorMetadata, ClaimedIdentity } from "@/lib/nostr/useContributorMetadata";
import { resolveEntityToPubkey, getEntityDisplayName, getRepoOwnerPubkey, getEntityPicture, getUserMetadata } from "@/lib/utils/entity-resolver";
import { getUserActivities, getUserActivityCounts, getContributionGraph } from "@/lib/activity-tracking";
import { getRepoStatus, getStatusBadgeStyle } from "@/lib/utils/repo-status";
import { UserStats } from "@/lib/stats";
import { nip19, getEventHash, signEvent } from "nostr-tools";
import { useNostrContext } from "@/lib/nostr/NostrContext";
import useSession from "@/lib/nostr/useSession";
import { getNostrPrivateKey } from "@/lib/security/encryptedStorage";
import { Button } from "@/components/ui/button";
import { ExternalLink, Globe, Zap, UserPlus, UserMinus, CheckCircle2 } from "lucide-react";

// Check if string is a valid Nostr pubkey (npub or hex)
function isValidPubkey(str: string): boolean {
  if (str.startsWith("npub")) return str.length > 50;
  // Hex pubkey is 64 chars
  return /^[0-9a-f]{64}$/i.test(str);
}

export default function EntityPage({ params }: { params: { entity: string } }) {
  // CRITICAL: All hooks must be called at the top level, before any conditional returns
  const router = useRouter();
  const redirectedRef = useRef(false);
  const [isPubkey, setIsPubkey] = useState(false);
  const [userRepos, setUserRepos] = useState<any[]>([]);
  const [userStats, setUserStats] = useState<UserStats | null>(null);
  const [contributionGraph, setContributionGraph] = useState<Array<{date: string; count: number}>>([]);
  const [activityCounts, setActivityCounts] = useState<Record<string, number>>({});
  
  // Get current user's pubkey for follow functionality - MUST be called before any early returns
  const { pubkey: currentUserPubkey, publish, defaultRelays, subscribe } = useNostrContext();
  const { isLoggedIn } = useSession();
  
  // For metadata lookup, use full pubkey if we resolved one, otherwise use entity
  // CRITICAL: Handle npub format entities by decoding them first
  // Also try to resolve from localStorage immediately
  const [fullPubkeyForMeta, setFullPubkeyForMeta] = useState<string>(() => {
    // If entity is npub, decode it immediately
    if (params.entity.startsWith("npub")) {
      try {
        const decoded = nip19.decode(params.entity);
        if (decoded.type === "npub") {
          const pubkey = decoded.data as string;
          if (/^[0-9a-f]{64}$/i.test(pubkey)) {
            console.log(`✅ [Profile] Decoded npub to pubkey: ${pubkey.slice(0, 8)}`);
            return pubkey;
          }
        }
      } catch (e) {
        console.error("Failed to decode npub:", e);
      }
    }
    // If entity is already a full 64-char pubkey, use it
    if (params.entity.length === 64 && /^[0-9a-f]{64}$/i.test(params.entity)) {
      console.log(`✅ [Profile] Entity is full pubkey: ${params.entity.slice(0, 8)}`);
      return params.entity;
    }
    // Try to resolve from localStorage immediately
    try {
      const repos = JSON.parse(localStorage.getItem("gittr_repos") || "[]") as any[];
      const activities = JSON.parse(localStorage.getItem("gittr_activities") || "[]") as any[];
      
      // Try to find full pubkey from repos
      const matchingRepo = repos.find((r: any) => 
        r.entity === params.entity || 
        (params.entity.length === 8 && r.entity?.toLowerCase().startsWith(params.entity.toLowerCase())) ||
        (r.ownerPubkey && /^[0-9a-f]{64}$/i.test(r.ownerPubkey) && r.ownerPubkey.toLowerCase().startsWith(params.entity.toLowerCase()))
      );
      
      if (matchingRepo?.ownerPubkey && /^[0-9a-f]{64}$/i.test(matchingRepo.ownerPubkey)) {
        console.log(`✅ [Profile] Resolved pubkey from repo: ${matchingRepo.ownerPubkey.slice(0, 8)}`);
        return matchingRepo.ownerPubkey;
      }
      
      // Try from activities
      const matchingActivity = activities.find((a: any) => 
        a.user && /^[0-9a-f]{64}$/i.test(a.user) && a.user.toLowerCase().startsWith(params.entity.toLowerCase())
      );
      if (matchingActivity?.user) {
        console.log(`✅ [Profile] Resolved pubkey from activity: ${matchingActivity.user.slice(0, 8)}`);
        return matchingActivity.user;
      }
    } catch (e) {
      console.error("Failed to resolve pubkey from localStorage:", e);
    }
    
    console.log(`⚠️ [Profile] Could not resolve full pubkey for entity: ${params.entity}`);
    return params.entity;
  });
  
  // Check if current user is following this profile
  const [isFollowing, setIsFollowing] = useState(false);
  const [followingLoading, setFollowingLoading] = useState(false);
  const [contactList, setContactList] = useState<string[]>([]);
  
  // CRITICAL: Only fetch metadata if we have a valid 64-char pubkey
  // Don't wait for isPubkey - if we have a full pubkey, fetch metadata immediately
  // CRITICAL: When viewing own profile, also include currentUserPubkey to ensure metadata is loaded
  const pubkeysForMetadata = useMemo(() => {
    const pubkeys = new Set<string>();
    
    // Priority 1: If entity is npub, decode it immediately
    if (params.entity.startsWith("npub")) {
      try {
        const decoded = nip19.decode(params.entity);
        const fullPubkey = decoded.data as string;
        if (decoded.type === "npub" && /^[0-9a-f]{64}$/i.test(fullPubkey)) {
          const normalized = fullPubkey.toLowerCase();
          console.log(`📡 [Profile] Fetching metadata for npub (decoded): ${normalized.slice(0, 8)}... (full length: ${normalized.length}, normalized to lowercase)`);
          console.log(`📡 [Profile] Full decoded pubkey: ${normalized}`);
          pubkeys.add(normalized);
        } else {
          console.error(`❌ [Profile] Decoded npub is not valid 64-char hex:`, {
            type: decoded.type,
            dataLength: fullPubkey.length,
            isValid: /^[0-9a-f]{64}$/i.test(fullPubkey),
            first8: fullPubkey.slice(0, 8)
          });
        }
      } catch (e) {
        console.error(`❌ [Profile] Failed to decode npub:`, e);
      }
    }
    
    // Priority 2: Use fullPubkeyForMeta if it's a full 64-char pubkey
    if (fullPubkeyForMeta && /^[0-9a-f]{64}$/i.test(fullPubkeyForMeta)) {
      const normalized = fullPubkeyForMeta.toLowerCase();
      console.log(`📡 [Profile] Fetching metadata for fullPubkeyForMeta: ${normalized.slice(0, 8)} (normalized to lowercase)`);
      pubkeys.add(normalized);
    }
    
    // Priority 3: If entity is already a full pubkey, use it
    if (params.entity && /^[0-9a-f]{64}$/i.test(params.entity)) {
      const normalized = params.entity.toLowerCase();
      console.log(`📡 [Profile] Fetching metadata for entity (full pubkey): ${normalized.slice(0, 8)} (normalized to lowercase)`);
      pubkeys.add(normalized);
    }
    
    // Priority 4: Try to resolve from localStorage immediately (don't wait for useEffect)
    if (params.entity && /^[0-9a-f]{8}$/i.test(params.entity)) {
      try {
        const repos = JSON.parse(localStorage.getItem("gittr_repos") || "[]") as any[];
        const activities = JSON.parse(localStorage.getItem("gittr_activities") || "[]") as any[];
        
        // Try to find full pubkey from repos
        const matchingRepo = repos.find((r: any) => 
          (r.ownerPubkey && /^[0-9a-f]{64}$/i.test(r.ownerPubkey) && r.ownerPubkey.toLowerCase().startsWith(params.entity.toLowerCase())) ||
          (r.entity && /^[0-9a-f]{64}$/i.test(r.entity) && r.entity.toLowerCase().startsWith(params.entity.toLowerCase()))
        );
        
        if (matchingRepo?.ownerPubkey && /^[0-9a-f]{64}$/i.test(matchingRepo.ownerPubkey)) {
          console.log(`📡 [Profile] Resolved pubkey from repo (useMemo): ${matchingRepo.ownerPubkey.slice(0, 8)}`);
          pubkeys.add(matchingRepo.ownerPubkey.toLowerCase());
        }
        
        // Try from activities
        const matchingActivity = activities.find((a: any) => 
          a.user && /^[0-9a-f]{64}$/i.test(a.user) && a.user.toLowerCase().startsWith(params.entity.toLowerCase())
        );
        if (matchingActivity?.user) {
          console.log(`📡 [Profile] Resolved pubkey from activity (useMemo): ${matchingActivity.user.slice(0, 8)}`);
          pubkeys.add(matchingActivity.user.toLowerCase());
        }
      } catch (e) {
        console.error(`❌ [Profile] Failed to resolve from localStorage in useMemo:`, e);
      }
    }
    
    // CRITICAL: When viewing own profile, ensure currentUserPubkey is included for metadata fetch
    // This ensures banner and other metadata are loaded even if URL format differs
    // ALWAYS add currentUserPubkey if we have a resolved pubkey and they match (or if we don't have a resolved pubkey yet, add it anyway as it might be our own profile)
    if (currentUserPubkey && /^[0-9a-f]{64}$/i.test(currentUserPubkey)) {
      const normalizedCurrentPubkey = currentUserPubkey.toLowerCase();
      
      // Strategy 1: Check if we're viewing own profile by comparing pubkeys
      const resolvedPubkey = Array.from(pubkeys)[0] || fullPubkeyForMeta;
      if (resolvedPubkey && /^[0-9a-f]{64}$/i.test(resolvedPubkey)) {
        const isOwnProfile = normalizedCurrentPubkey === resolvedPubkey.toLowerCase();
        if (isOwnProfile) {
          console.log(`📡 [Profile] Viewing own profile - adding currentUserPubkey to metadata fetch: ${currentUserPubkey.slice(0, 8)}`);
          pubkeys.add(normalizedCurrentPubkey);
        }
      } else {
        // Strategy 2: If we don't have a resolved pubkey yet, check if entity matches currentUserPubkey
        // This handles cases where the URL format doesn't match but it's still our profile
        if (params.entity.startsWith("npub")) {
          try {
            const decoded = nip19.decode(params.entity);
            if (decoded.type === "npub") {
              const decodedPubkey = (decoded.data as string).toLowerCase();
              if (decodedPubkey === normalizedCurrentPubkey) {
                console.log(`📡 [Profile] Entity npub matches currentUserPubkey - adding to metadata fetch: ${currentUserPubkey.slice(0, 8)}`);
                pubkeys.add(normalizedCurrentPubkey);
              }
            }
          } catch {}
        } else if (params.entity && /^[0-9a-f]{64}$/i.test(params.entity) && params.entity.toLowerCase() === normalizedCurrentPubkey) {
          console.log(`📡 [Profile] Entity pubkey matches currentUserPubkey - adding to metadata fetch: ${currentUserPubkey.slice(0, 8)}`);
          pubkeys.add(normalizedCurrentPubkey);
        }
      }
    }
    
    const pubkeysArray = Array.from(pubkeys);
    if (pubkeysArray.length === 0) {
      console.log(`⏭️ [Profile] Skipping metadata fetch - no valid pubkey. Entity: ${params.entity} (${params.entity.length} chars), fullPubkeyForMeta: ${fullPubkeyForMeta} (${fullPubkeyForMeta?.length || 0} chars)`);
    }
    return pubkeysArray;
  }, [fullPubkeyForMeta, params.entity, currentUserPubkey]);
  
  // CRITICAL: This hook returns the FULL metadataMap from cache, not just the pubkeys passed to it
  // The hook loads all cached metadata on initialization, so we should have access to all 15+ entries
  console.log(`🔍 [Profile] Calling useContributorMetadata with pubkeys:`, {
    pubkeysForMetadata,
    pubkeysLength: pubkeysForMetadata.length,
    pubkeysFirst8: pubkeysForMetadata.map(p => p.slice(0, 8)),
  });
  const metadataMap = useContributorMetadata(pubkeysForMetadata);
  
  // CRITICAL: Use the same pattern as settings/profile page - determine pubkey first, then call getUserMetadata directly
  // Determine which pubkey to use (same priority as settings/profile)
  const pubkeyForMetadata = useMemo(() => {
    // Priority 1: Use fullPubkeyForMeta if available (most reliable)
    if (fullPubkeyForMeta && /^[0-9a-f]{64}$/i.test(fullPubkeyForMeta)) {
      return fullPubkeyForMeta;
    }
    // Priority 2: Try params.entity if it's a full pubkey
    if (params.entity && /^[0-9a-f]{64}$/i.test(params.entity)) {
      return params.entity;
    }
    // Priority 3: Try decoding npub
    if (params.entity && params.entity.startsWith("npub")) {
      try {
        const decoded = nip19.decode(params.entity);
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
  }, [fullPubkeyForMeta, params.entity]);
  
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
        const isOwnProfile = currentUserPubkey.toLowerCase() === resolvedPubkey.toLowerCase();
        if (isOwnProfile) {
          const ownMeta = getUserMetadata(currentUserPubkey.toLowerCase(), metadataMap);
          if (ownMeta && Object.keys(ownMeta).length > 0) {
            console.log(`✅ [Profile] Found own metadata via currentUserPubkey fallback`);
            return ownMeta;
          }
        }
      }
    }
    
    return {};
  }, [pubkeyForMetadata, currentUserPubkey, fullPubkeyForMeta, metadataMap]);
  
  // Debug: Log metadata state and check for identities
  useEffect(() => {
    if (pubkeyForMetadata) {
      const normalized = pubkeyForMetadata.toLowerCase();
      const meta = metadataMap[normalized];
      console.log(`🔍 [Profile] Metadata lookup for ${normalized.slice(0, 8)}:`, {
        hasMetadata: !!meta,
        hasIdentities: !!(meta?.identities),
        identitiesCount: meta?.identities?.length || 0,
        identities: meta?.identities,
        allMetadataKeys: Object.keys(metadataMap).slice(0, 10),
        metadataMapSize: Object.keys(metadataMap).length
      });
      const cacheKeys = Object.keys(metadataMap);
      const directMatch = metadataMap[normalized];
      const caseInsensitiveMatch = cacheKeys.find(k => k.toLowerCase() === normalized);
      const caseInsensitiveData = caseInsensitiveMatch ? metadataMap[caseInsensitiveMatch] : null;
      
      console.log(`📊 [Profile] Metadata lookup for ${normalized.slice(0, 8)}:`, {
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
        cacheKeysFirst8: cacheKeys.map(k => k.slice(0, 8)),
      });
      
      // CRITICAL: Also log as string to see actual values
      console.log(`🔍 [Profile] Metadata details:`, 
        `name="${userMeta?.name || 'MISSING'}"`,
        `display_name="${userMeta?.display_name || 'MISSING'}"`,
        `picture="${userMeta?.picture ? 'EXISTS' : 'MISSING'}"`,
        `banner="${userMeta?.banner ? 'EXISTS: ' + userMeta.banner.substring(0, 50) + '...' : 'MISSING'}"`,
        `nip05="${userMeta?.nip05 || 'MISSING'}"`,
        `about="${userMeta?.about ? 'EXISTS' : 'MISSING'}"`,
        `cacheHasKey=${cacheKeys.includes(normalized)}`,
        `cacheKeysCount=${cacheKeys.length}`,
        `lookingFor="${normalized.slice(0, 16)}..."`
      );
      
      // Debug: Check raw metadata from cache
      const rawMeta = metadataMap[normalized];
      if (rawMeta) {
        console.log(`🔍 [Profile] Raw metadata from cache:`, {
          hasBanner: !!rawMeta.banner,
          bannerValue: rawMeta.banner ? rawMeta.banner.substring(0, 50) + '...' : 'none',
          allKeys: Object.keys(rawMeta)
        });
      }
    } else {
      console.log(`⚠️ [Profile] No pubkey for metadata! Entity: ${params.entity}, fullPubkeyForMeta: ${fullPubkeyForMeta}`);
    }
  }, [userMeta, pubkeyForMetadata, metadataMap, params.entity, fullPubkeyForMeta]);

  // Check if entity is a pubkey (user profile) or repo slug
  useEffect(() => {
    if (redirectedRef.current) return; // Prevent multiple redirects
    
    const entityParam = params.entity;
    
    // Reserved routes that should not be treated as entity/repo
    const reservedRoutes = ["stars", "zaps", "explore", "pulls", "issues", "repositories", "settings", "profile", "projects", "organizations", "sponsors", "upgrade", "help", "new", "login", "signup", "bounty-hunt"];
    if (reservedRoutes.includes(entityParam)) {
      // This is a reserved route, don't handle it here
      return;
    }
    
    // Check if it's a full pubkey or 8-char prefix (entity)
    const isFullPubkey = isValidPubkey(entityParam);
    const isEntityPrefix = entityParam.length === 8 && /^[0-9a-f]{8}$/i.test(entityParam);
    
    // Try to find repos with this entity first (for 8-char prefixes)
    try {
      const repos = JSON.parse(localStorage.getItem("gittr_repos") || "[]") as any[];
      
      if (isFullPubkey || isEntityPrefix) {
        // It's a user profile (full pubkey or 8-char prefix)
        setIsPubkey(true);
        
        // Find ALL repos where user is involved: owner, contributor, can merge, or forked
        // CRITICAL: Must find ALL repos where this user has any role, not just owner
        const userReposList = repos.filter((r: any) => {
          if (!r.entity || r.entity === "user") return false;
          
          // Helper to check if pubkey matches entityParam
          const pubkeyMatches = (pubkey: string | undefined) => {
            if (!pubkey || !/^[0-9a-f]{64}$/i.test(pubkey)) return false;
            if (isFullPubkey && pubkey.toLowerCase() === entityParam.toLowerCase()) return true;
            if (isEntityPrefix && pubkey.toLowerCase().startsWith(entityParam.toLowerCase())) return true;
            return false;
          };
          
          // Priority 1: Match by ownerPubkey (owner)
          if (r.ownerPubkey && pubkeyMatches(r.ownerPubkey)) return true;
          
          // Priority 2: Match by owner contributor (weight 100 = owner)
          if (r.contributors && Array.isArray(r.contributors)) {
            const ownerContributor = r.contributors.find((c: any) => 
              c.weight === 100 && pubkeyMatches(c.pubkey)
            );
            if (ownerContributor) return true;
            
            // Also check for any contributor (maintainer, contributor, or forker)
            const userContributor = r.contributors.find((c: any) => 
              pubkeyMatches(c.pubkey) && (c.weight > 0 || c.role)
            );
            if (userContributor) return true;
          }
          
          // Priority 3: Match by forkedFrom (if user forked this repo)
          if (r.forkedFrom) {
            // Check if the original repo's owner matches
            const originalRepo = repos.find((orig: any) => 
              orig.slug === r.forkedFrom || 
              (orig.entity && orig.repo && `${orig.entity}/${orig.repo}` === r.forkedFrom)
            );
            if (originalRepo) {
              const originalOwner = originalRepo.ownerPubkey || 
                originalRepo.contributors?.find((c: any) => c.weight === 100)?.pubkey;
              if (originalOwner && pubkeyMatches(originalOwner)) return true;
            }
          }
          
          // Priority 4: Match exact entity (8-char prefix)
          if (r.entity === entityParam) return true;
          
          // Priority 5: If entityParam is 8-char prefix, match entities starting with it
          if (isEntityPrefix && r.entity.toLowerCase().startsWith(entityParam.toLowerCase())) return true;
          
          // Priority 6: If entityParam is full pubkey, match entities that are its prefix
          if (isFullPubkey && r.entity.toLowerCase() === entityParam.slice(0, 8).toLowerCase()) return true;
          
          // Priority 7: If entityParam is npub, decode and match by pubkey
          if (entityParam.startsWith("npub")) {
            try {
              const decoded = nip19.decode(entityParam);
              if (decoded.type === "npub") {
                const decodedPubkey = (decoded.data as string).toLowerCase();
                // Match by ownerPubkey
                if (r.ownerPubkey && r.ownerPubkey.toLowerCase() === decodedPubkey) return true;
                // Match by contributors
                if (r.contributors && Array.isArray(r.contributors)) {
                  const matchingContributor = r.contributors.find((c: any) => 
                    c.pubkey && c.pubkey.toLowerCase() === decodedPubkey
                  );
                  if (matchingContributor) return true;
                }
                // Match by entity if it's the 8-char prefix of decoded pubkey
                if (r.entity && r.entity.toLowerCase() === decodedPubkey.slice(0, 8)) return true;
              }
            } catch {}
          }
          
          return false;
        }).map((r: any) => {
          // Add role information to each repo
          let role: "owner" | "maintainer" | "contributor" | "forked" = "contributor";
          
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
            if (r.ownerPubkey && /^[0-9a-f]{64}$/i.test(r.ownerPubkey) && r.ownerPubkey.toLowerCase().startsWith(entityParam.toLowerCase())) {
              targetPubkey = r.ownerPubkey.toLowerCase();
            } else if (fullPubkeyForMeta && /^[0-9a-f]{64}$/i.test(fullPubkeyForMeta) && fullPubkeyForMeta.toLowerCase().startsWith(entityParam.toLowerCase())) {
              targetPubkey = fullPubkeyForMeta.toLowerCase();
            }
          }
          
          if (targetPubkey) {
            // Check if owner
            if (r.ownerPubkey && r.ownerPubkey.toLowerCase() === targetPubkey) {
              role = "owner";
              // If it's a fork (has forkedFrom) and user owns it, mark as forked
              if (r.forkedFrom) {
                role = "forked";
              }
            } else if (r.contributors && Array.isArray(r.contributors)) {
              const contributor = r.contributors.find((c: any) => 
                c.pubkey && c.pubkey.toLowerCase() === targetPubkey
              );
              if (contributor) {
                if (contributor.weight === 100 || contributor.role === "owner") {
                  role = "owner";
                  // If it's a fork and user owns it, mark as forked
                  if (r.forkedFrom) {
                    role = "forked";
                  }
                } else if (contributor.weight >= 50 || contributor.role === "maintainer") {
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
        } else if (fullPubkeyForMeta && /^[0-9a-f]{64}$/i.test(fullPubkeyForMeta)) {
          pubkeyForActivities = fullPubkeyForMeta;
        } else if (isEntityPrefix && userReposList.length > 0) {
          const repoWithOwnerPubkey = userReposList.find((r: any) => r.ownerPubkey && r.ownerPubkey.length === 64);
          if (repoWithOwnerPubkey?.ownerPubkey) {
            pubkeyForActivities = repoWithOwnerPubkey.ownerPubkey;
          }
        }
        const repoActivitiesForSync = getUserActivities(pubkeyForActivities).filter(a => a.type === "repo_created" || a.type === "repo_imported");
        
        // Check if any activities don't have corresponding repos in userReposList
        const missingRepos = repoActivitiesForSync.filter(activity => {
          if (!activity.repo) return false;
          const [activityEntity, activityRepo] = activity.repo.split('/');
          return !userReposList.some((r: any) => {
            const rEntity = r.entity || "";
            const rRepo = r.repo || r.slug || "";
            return rEntity === activityEntity && rRepo === activityRepo;
          });
        });
        
        if (missingRepos.length > 0) {
          console.log(`⚠️ [Profile] Found ${missingRepos.length} repo activities without matching repos in localStorage (${userReposList.length} already found). Syncing missing ones...`);
          
          // Create minimal repo entries from activities
          const syncedRepos: any[] = [];
          missingRepos.forEach((activity) => {
            if (!activity.repo || !activity.entity) return;
            
            // Parse entity/repo from activity.repo
            const [activityEntity, activityRepo] = activity.repo.split('/');
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
              if (activityEntity.length === 8 && fullPubkeyForMeta && /^[0-9a-f]{64}$/i.test(fullPubkeyForMeta)) {
                // If activity.entity is 8-char prefix and matches fullPubkeyForMeta, use fullPubkeyForMeta
                if (fullPubkeyForMeta.toLowerCase().startsWith(activityEntity.toLowerCase())) {
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
                ownerPubkey: /^[0-9a-f]{64}$/i.test(ownerPubkey) ? ownerPubkey : undefined,
                contributors: /^[0-9a-f]{64}$/i.test(ownerPubkey) ? [{ pubkey: ownerPubkey, weight: 100 }] : [],
                createdAt: activity.timestamp,
                description: activity.metadata?.description,
              };
              
              syncedRepos.push(syncedRepo);
              repos.push(syncedRepo);
            }
          });
          
          if (syncedRepos.length > 0) {
            console.log(`✅ [Profile] Synced ${syncedRepos.length} repos from activities to localStorage`);
            localStorage.setItem("gittr_repos", JSON.stringify(repos));
            
            // Re-run the entire filtering logic now that we've synced
            // Reload repos from localStorage to get the updated list
            const updatedRepos = JSON.parse(localStorage.getItem("gittr_repos") || "[]") as any[];
            const updatedUserReposList = updatedRepos.filter((r: any) => {
              if (!r.entity || r.entity === "user") return false;
              
              const pubkeyMatches = (pubkey: string | undefined) => {
                if (!pubkey || !/^[0-9a-f]{64}$/i.test(pubkey)) return false;
                if (isFullPubkey && pubkey.toLowerCase() === entityParam.toLowerCase()) return true;
                if (isEntityPrefix && pubkey.toLowerCase().startsWith(entityParam.toLowerCase())) return true;
                return false;
              };
              
              if (r.ownerPubkey && pubkeyMatches(r.ownerPubkey)) return true;
              if (r.contributors && Array.isArray(r.contributors)) {
                const ownerContributor = r.contributors.find((c: any) => 
                  c.weight === 100 && pubkeyMatches(c.pubkey)
                );
                if (ownerContributor) return true;
              }
              if (r.entity === entityParam) return true;
              if (isEntityPrefix && r.entity.toLowerCase().startsWith(entityParam.toLowerCase())) return true;
              if (isFullPubkey && r.entity.toLowerCase() === entityParam.slice(0, 8).toLowerCase()) return true;
              
              // Priority 7: If entityParam is npub, decode and match by pubkey
              if (entityParam.startsWith("npub")) {
                try {
                  const decoded = nip19.decode(entityParam);
                  if (decoded.type === "npub") {
                    const decodedPubkey = (decoded.data as string).toLowerCase();
                    // Match by ownerPubkey
                    if (r.ownerPubkey && r.ownerPubkey.toLowerCase() === decodedPubkey) return true;
                    // Match by contributors
                    if (r.contributors && Array.isArray(r.contributors)) {
                      const matchingContributor = r.contributors.find((c: any) => 
                        c.pubkey && c.pubkey.toLowerCase() === decodedPubkey
                      );
                      if (matchingContributor) return true;
                    }
                    // Match by entity if it's the 8-char prefix of decoded pubkey
                    if (r.entity && r.entity.toLowerCase() === decodedPubkey.slice(0, 8)) return true;
                  }
                } catch {}
              }
              
              return false;
            }).map((r: any) => {
              let role: "owner" | "maintainer" | "contributor" | "forked" = "contributor";
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
                if (r.ownerPubkey && /^[0-9a-f]{64}$/i.test(r.ownerPubkey) && r.ownerPubkey.toLowerCase().startsWith(entityParam.toLowerCase())) {
                  targetPubkey = r.ownerPubkey.toLowerCase();
                } else if (fullPubkeyForMeta && /^[0-9a-f]{64}$/i.test(fullPubkeyForMeta) && fullPubkeyForMeta.toLowerCase().startsWith(entityParam.toLowerCase())) {
                  targetPubkey = fullPubkeyForMeta.toLowerCase();
                }
              }
              
              if (targetPubkey) {
                if (r.ownerPubkey && r.ownerPubkey.toLowerCase() === targetPubkey) {
                  role = "owner";
                  if (r.forkedFrom) role = "forked";
                } else if (r.contributors && Array.isArray(r.contributors)) {
                  const contributor = r.contributors.find((c: any) => 
                    c.pubkey && c.pubkey.toLowerCase() === targetPubkey
                  );
                  if (contributor) {
                    if (contributor.weight === 100 || contributor.role === "owner") {
                      role = "owner";
                      if (r.forkedFrom) role = "forked";
                    } else if (contributor.weight >= 50 || contributor.role === "maintainer") {
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
            const deletedRepos = JSON.parse(localStorage.getItem("gittr_deleted_repos") || "[]") as Array<{entity: string; repo: string; deletedAt: number}>;
            
            // Helper function to check if a repo is deleted (ONLY uses npub and ownerPubkey - NO 8-char prefixes)
            const isRepoDeleted = (r: any): boolean => {
              const repo = r.repo || r.slug || "";
              const entity = r.entity || "";
              
              // Check direct match by entity (npub format)
              const repoKey = `${entity}/${repo}`.toLowerCase();
              if (deletedRepos.some(d => `${d.entity}/${d.repo}`.toLowerCase() === repoKey)) return true;
              
              // Check by ownerPubkey (most reliable - handles npub entity mismatches)
              if (r.ownerPubkey && /^[0-9a-f]{64}$/i.test(r.ownerPubkey)) {
                const ownerPubkey = r.ownerPubkey.toLowerCase();
                // Check if deleted entity is npub for same pubkey
                if (deletedRepos.some(d => {
                  if (d.entity.startsWith("npub")) {
                    try {
                      const dDecoded = nip19.decode(d.entity);
                      if (dDecoded.type === "npub" && (dDecoded.data as string).toLowerCase() === ownerPubkey) {
                        return d.repo.toLowerCase() === repo.toLowerCase();
                      }
                    } catch {}
                  }
                  return false;
                })) return true;
              }
              
              return false;
            };
            
            // Check if viewing own profile
            const viewingOwnProfile = currentUserPubkey && fullPubkeyForMeta && /^[0-9a-f]{64}$/i.test(fullPubkeyForMeta) && 
              currentUserPubkey.toLowerCase() === fullPubkeyForMeta.toLowerCase();
            
            // Filter out deleted repos and local repos (if viewing someone else's profile)
            const filteredUpdatedRepos = updatedUserReposList.filter((r: any) => {
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
                if (status === "local" || status === "pushing" || status === "push_failed") return false;
              }
              
              return true;
            });
            
            // Deduplicate repos by entity/repo combination (keep the most recent one)
            const dedupeMap = new Map<string, any>();
            filteredUpdatedRepos.forEach((r: any) => {
              const entity = (r.entity || '').trim();
              const repo = (r.repo || r.slug || '').trim();
              const key = `${entity}/${repo}`.toLowerCase(); // Case-insensitive comparison
              const existing = dedupeMap.get(key);
              if (!existing) {
                dedupeMap.set(key, r);
              } else {
                // Keep the one with the most recent createdAt
                if ((r.createdAt || 0) > (existing.createdAt || 0)) {
                  dedupeMap.set(key, r);
                }
              }
            });
            
            const deduplicatedUpdatedRepos = Array.from(dedupeMap.values());
            
            setUserRepos(deduplicatedUpdatedRepos);
            console.log(`✅ [Profile] After sync: ${deduplicatedUpdatedRepos.length} repos found (${updatedUserReposList.length - deduplicatedUpdatedRepos.length} duplicates/deleted removed)`);
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
        const deletedRepos = JSON.parse(localStorage.getItem("gittr_deleted_repos") || "[]") as Array<{entity: string; repo: string; deletedAt: number}>;
        
        // Helper function to check if a repo is deleted (ONLY uses npub and ownerPubkey - NO 8-char prefixes)
        const isRepoDeleted = (r: any): boolean => {
          const repo = r.repo || r.slug || "";
          const entity = r.entity || "";
          
          // Check direct match by entity (npub format)
          const repoKey = `${entity}/${repo}`.toLowerCase();
          if (deletedRepos.some(d => `${d.entity}/${d.repo}`.toLowerCase() === repoKey)) return true;
          
          // Check by ownerPubkey (most reliable - handles npub entity mismatches)
          if (r.ownerPubkey && /^[0-9a-f]{64}$/i.test(r.ownerPubkey)) {
            const ownerPubkey = r.ownerPubkey.toLowerCase();
            // Check if deleted entity is npub for same pubkey
            if (deletedRepos.some(d => {
              if (d.entity.startsWith("npub")) {
                try {
                  const dDecoded = nip19.decode(d.entity);
                  if (dDecoded.type === "npub" && (dDecoded.data as string).toLowerCase() === ownerPubkey) {
                    return d.repo.toLowerCase() === repo.toLowerCase();
                  }
                } catch {}
              }
              return false;
            })) return true;
          }
          
          return false;
        };
        
        // Check if viewing own profile (will be set later, but we need it here)
        const viewingOwnProfile = currentUserPubkey && fullPubkeyForMeta && /^[0-9a-f]{64}$/i.test(fullPubkeyForMeta) && 
          currentUserPubkey.toLowerCase() === fullPubkeyForMeta.toLowerCase();
        
        // Filter out deleted repos and local repos (if viewing someone else's profile)
        const filteredRepos = userReposList.filter((r: any) => {
          // Skip if locally deleted (using robust check)
          if (isRepoDeleted(r)) return false;
          
          // Skip if marked as deleted/archived on Nostr
          if (r.deleted === true || r.archived === true) return false;
          
          // CRITICAL: On public profile (not own), only show repos that are "live" on Nostr
          // Local repos should be private and not visible to others
          // BUT: Also check if repo exists in Nostr repos list (might be from another source)
          if (!viewingOwnProfile) {
            const status = getRepoStatus(r);
            // Only show "live" or "live_with_edits" repos on public profiles
            // "local" repos are private and should not be visible
            // EXCEPTION: If repo has ownerPubkey matching the profile, it might be from Nostr
            // Check if repo exists in the main repos list (from Nostr)
            const existsInNostr = repos.some((nr: any) => {
              const nrEntity = nr.entity || "";
              const nrRepo = nr.repo || nr.slug || "";
              const rEntity = r.entity || "";
              const rRepo = r.repo || r.slug || "";
              return nrEntity.toLowerCase() === rEntity.toLowerCase() && 
                     nrRepo.toLowerCase() === rRepo.toLowerCase() &&
                     (nr.ownerPubkey?.toLowerCase() === fullPubkeyForMeta?.toLowerCase());
            });
            
            // If status is local but repo exists in Nostr repos, show it (might be syncing)
            if (status === "local" && !existsInNostr) return false;
            if (status === "pushing") return false; // Don't show repos that are currently pushing
          }
          
          return true;
        });
        
        // Deduplicate repos by entity/repo combination (keep the most recent one)
        const dedupeMap = new Map<string, any>();
        filteredRepos.forEach((r: any) => {
          const entity = (r.entity || '').trim();
          const repo = (r.repo || r.slug || '').trim();
          const key = `${entity}/${repo}`.toLowerCase(); // Case-insensitive comparison
          const existing = dedupeMap.get(key);
          if (!existing) {
            dedupeMap.set(key, r);
          } else {
            // Keep the one with the most recent createdAt
            if ((r.createdAt || 0) > (existing.createdAt || 0)) {
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
          const repoWithOwnerPubkey = userReposList.find((r: any) => r.ownerPubkey && r.ownerPubkey.length === 64);
          if (repoWithOwnerPubkey?.ownerPubkey) {
            fullPubkey = repoWithOwnerPubkey.ownerPubkey;
          } else {
            // Try from repo entities
            const repoWithFullEntity = userReposList.find((r: any) => r.entity && r.entity.length === 64);
            if (repoWithFullEntity?.entity) {
              fullPubkey = repoWithFullEntity.entity;
            } else {
              // Try from activities
              const activities = JSON.parse(localStorage.getItem("gittr_activities") || "[]");
              const matchingPubkeys = new Set<string>();
              activities.forEach((a: any) => {
                if (a.user && a.user.toLowerCase().startsWith(entityParam.toLowerCase())) {
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
        
        // Get user stats using full pubkey
        // CRITICAL: getUserActivities now filters out activities from deleted repos
        const activities = getUserActivities(fullPubkey);
        const counts = getUserActivityCounts(fullPubkey);
        const graph = getContributionGraph(fullPubkey);
        
        // Debug: log what we found
        console.log("Profile stats for", fullPubkey, {
          totalActivities: activities.length,
          commits: activities.filter(a => a.type === "commit_created").length,
          prsMerged: activities.filter(a => a.type === "pr_merged").length,
          bountiesClaimed: activities.filter(a => a.type === "bounty_claimed").length,
          counts: counts,
          allActivityTypes: activities.map(a => a.type),
          filteredReposCount: deduplicatedRepos.length, // Use actual filtered repo count
        });
        
        // If no activities found, try triggering backfill
        if (activities.length === 0) {
          console.warn("No activities found - you may need to run backfillActivities()");
          console.log("To backfill, run in console: localStorage.removeItem('gittr_activities_backfilled'); location.reload();");
        }
        
        setActivityCounts(counts);
        setContributionGraph(graph);
        
        // CRITICAL: Use actual filtered repo count instead of counting from activities
        // This ensures deleted repos are excluded
        setUserStats({
          pubkey: fullPubkey,
          activityCount: activities.length,
          prMergedCount: activities.filter((a: any) => a.type === "pr_merged").length,
          commitCount: activities.filter((a: any) => a.type === "commit_created").length,
          bountyClaimedCount: activities.filter((a: any) => a.type === "bounty_claimed").length,
          reposCreatedCount: deduplicatedRepos.length, // Use actual filtered repo count, not activities
          lastActivity: activities.length > 0 ? Math.max(...activities.map((a: any) => a.timestamp)) : 0,
        });
        
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
          const repoName = repo.repo || (repo.slug?.includes('/') ? repo.slug.split('/')[1] : repo.slug || entityParam);
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
  }, [params.entity]);
  
  useEffect(() => {
    // Only update if we don't already have a full pubkey
    if (isPubkey && (!fullPubkeyForMeta || !/^[0-9a-f]{64}$/i.test(fullPubkeyForMeta))) {
      // If entityParam is npub, decode it
      if (params.entity.startsWith("npub")) {
        try {
          const decoded = nip19.decode(params.entity);
          if (decoded.type === "npub" && /^[0-9a-f]{64}$/i.test(decoded.data as string)) {
            const fullPubkey = decoded.data as string;
            if (fullPubkeyForMeta !== fullPubkey) {
              console.log(`✅ [Profile] useEffect: Setting fullPubkeyForMeta from npub: ${fullPubkey.slice(0, 8)}`);
              setFullPubkeyForMeta(fullPubkey);
            }
            return;
          }
        } catch (e) {
          console.error(`❌ [Profile] useEffect: Failed to decode npub:`, e);
        }
      }
      
      // If entityParam is already a full pubkey, use it directly
      if (isValidPubkey(params.entity) && params.entity.length === 64) {
        if (fullPubkeyForMeta !== params.entity) {
          console.log(`✅ [Profile] useEffect: Setting fullPubkeyForMeta from entity (full): ${params.entity.slice(0, 8)}`);
        setFullPubkeyForMeta(params.entity);
        }
        return;
      }
      
      // Try to resolve full pubkey from repos or activities (only if we don't have one yet)
      if (params.entity && /^[0-9a-f]{8}$/i.test(params.entity)) {
      try {
        const repos = JSON.parse(localStorage.getItem("gittr_repos") || "[]") as any[];
        
        // First try to find by ownerPubkey (most reliable for imported repos)
        const matchingRepoByOwner = repos.find((r: any) => 
            r.ownerPubkey && /^[0-9a-f]{64}$/i.test(r.ownerPubkey) && r.ownerPubkey.toLowerCase().startsWith(params.entity.toLowerCase()));
        
        if (matchingRepoByOwner?.ownerPubkey) {
            if (fullPubkeyForMeta !== matchingRepoByOwner.ownerPubkey) {
              console.log(`✅ [Profile] useEffect: Setting fullPubkeyForMeta from repo ownerPubkey: ${matchingRepoByOwner.ownerPubkey.slice(0, 8)}`);
          setFullPubkeyForMeta(matchingRepoByOwner.ownerPubkey);
            }
          return;
        }
        
        // Then try by entity
          const matchingRepo = repos.find((r: any) => 
            r.entity && /^[0-9a-f]{64}$/i.test(r.entity) && r.entity.toLowerCase().startsWith(params.entity.toLowerCase()));
        
          if (matchingRepo?.entity) {
            if (fullPubkeyForMeta !== matchingRepo.entity) {
              console.log(`✅ [Profile] useEffect: Setting fullPubkeyForMeta from repo entity: ${matchingRepo.entity.slice(0, 8)}`);
          setFullPubkeyForMeta(matchingRepo.entity);
            }
        } else {
          // Try from activities
          const activities = JSON.parse(localStorage.getItem("gittr_activities") || "[]");
          const matchingActivity = activities.find((a: any) => 
              a.user && /^[0-9a-f]{64}$/i.test(a.user) && a.user.toLowerCase().startsWith(params.entity.toLowerCase()));
            if (matchingActivity?.user && fullPubkeyForMeta !== matchingActivity.user) {
              console.log(`✅ [Profile] useEffect: Setting fullPubkeyForMeta from activity: ${matchingActivity.user.slice(0, 8)}`);
            setFullPubkeyForMeta(matchingActivity.user);
          }
        }
        } catch (e) {
          console.error(`❌ [Profile] useEffect: Failed to resolve from localStorage:`, e);
        }
      }
    }
  }, [params.entity, isPubkey, fullPubkeyForMeta]);
  
  
  // Use getEntityDisplayName for consistent display name resolution
  // CRITICAL: Never show full npub string or shortened pubkey - always prefer username or show npub
  const displayName = useMemo(() => {
    // Priority 1: Use metadata from userMeta (already normalized via getUserMetadata)
    if (userMeta?.name && userMeta.name.trim().length > 0 && userMeta.name !== "Anonymous Nostrich" && 
        !userMeta.name.startsWith("npub") && !/^[0-9a-f]{8,64}$/i.test(userMeta.name)) {
      return userMeta.name;
    }
    if (userMeta?.display_name && userMeta.display_name.trim().length > 0 && 
        !userMeta.display_name.startsWith("npub") && !/^[0-9a-f]{8,64}$/i.test(userMeta.display_name)) {
      return userMeta.display_name;
    }
    
    // Priority 2: Try direct lookup using getUserMetadata (same as settings/profile page)
    if (fullPubkeyForMeta && /^[0-9a-f]{64}$/i.test(fullPubkeyForMeta)) {
      const fallbackMeta = getUserMetadata(fullPubkeyForMeta.toLowerCase(), metadataMap);
      if (fallbackMeta?.name && fallbackMeta.name.trim().length > 0 && fallbackMeta.name !== "Anonymous Nostrich" && 
          !fallbackMeta.name.startsWith("npub") && !/^[0-9a-f]{8,64}$/i.test(fallbackMeta.name)) {
        return fallbackMeta.name;
      }
      if (fallbackMeta?.display_name && fallbackMeta.display_name.trim().length > 0 && 
          !fallbackMeta.display_name.startsWith("npub") && !/^[0-9a-f]{8,64}$/i.test(fallbackMeta.display_name)) {
        return fallbackMeta.display_name;
      }
    }
    
    // Priority 3: If we have npub, show shortened npub (not pubkey prefix)
    if (params.entity.startsWith("npub")) {
      // Show first 16 chars of npub: "npub1n2ph08n4pqz..."
      return params.entity.substring(0, 16) + "...";
    }
    
    // Fallback: show 8-char prefix only if entity is exactly 8 chars
    return params.entity.length === 8 ? params.entity : params.entity.slice(0, 8);
  }, [userMeta, fullPubkeyForMeta, metadataMap, params.entity]);
  
  // CRITICAL: Get all metadata fields from userMeta (which uses centralized getUserMetadata function)
  // If userMeta is empty, try direct lookup as fallback (same logic as settings/profile page)
  // CRITICAL: When viewing own profile, also try currentUserPubkey as fallback to ensure metadata is found
  const isOwnProfileCheck = currentUserPubkey && fullPubkeyForMeta && /^[0-9a-f]{64}$/i.test(fullPubkeyForMeta) && 
    currentUserPubkey.toLowerCase() === fullPubkeyForMeta.toLowerCase();
  
  const picture = userMeta?.picture || 
    (fullPubkeyForMeta && /^[0-9a-f]{64}$/i.test(fullPubkeyForMeta) ? getUserMetadata(fullPubkeyForMeta.toLowerCase(), metadataMap)?.picture : null) ||
    (isOwnProfileCheck && currentUserPubkey ? getUserMetadata(currentUserPubkey.toLowerCase(), metadataMap)?.picture : null) ||
    null;
  
  // CRITICAL: Banner lookup - unified for own and foreign profiles
  // userMeta already uses getUserMetadata which handles all lookup strategies
  // So we just need to check userMeta first, then try direct lookup as fallback
  const banner = userMeta?.banner || (() => {
    // Fallback: Try direct lookup from metadataMap using fullPubkeyForMeta
    if (fullPubkeyForMeta && /^[0-9a-f]{64}$/i.test(fullPubkeyForMeta)) {
      const meta = getUserMetadata(fullPubkeyForMeta.toLowerCase(), metadataMap);
      if (meta?.banner) {
        console.log(`✅ [Banner] Found via direct lookup: ${meta.banner.substring(0, 50)}...`);
        return meta.banner;
      }
    }
    
    // Additional fallback: Try currentUserPubkey if viewing own profile
    if (isOwnProfileCheck && currentUserPubkey && /^[0-9a-f]{64}$/i.test(currentUserPubkey)) {
      const meta = getUserMetadata(currentUserPubkey.toLowerCase(), metadataMap);
      if (meta?.banner) {
        console.log(`✅ [Banner] Found via currentUserPubkey: ${meta.banner.substring(0, 50)}...`);
        return meta.banner;
      }
    }
    
    console.log(`⚠️ [Banner] NOT FOUND - userMeta.banner: ${userMeta?.banner || 'undefined'}, fullPubkeyForMeta: ${fullPubkeyForMeta?.slice(0, 8)}`);
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
      
      // Fallback 1: Try fullPubkeyForMeta lookup
      if (fullPubkeyForMeta && /^[0-9a-f]{64}$/i.test(fullPubkeyForMeta)) {
        const meta = getUserMetadata(fullPubkeyForMeta.toLowerCase(), metadataMap);
        if (meta && meta[field]) {
          return meta[field];
        }
      }
      
      // Fallback 2: If viewing own profile, try currentUserPubkey lookup
      if (isOwnProfileCheck && currentUserPubkey && /^[0-9a-f]{64}$/i.test(currentUserPubkey)) {
        const meta = getUserMetadata(currentUserPubkey.toLowerCase(), metadataMap);
        if (meta && meta[field]) {
          return meta[field];
        }
      }
      
      return undefined;
    };
  }, [userMeta, fullPubkeyForMeta, metadataMap, isOwnProfileCheck, currentUserPubkey]);
  
  const about = getMetaField('about');
  const nip05 = getMetaField('nip05');
  const website = getMetaField('website');
  const lud16 = getMetaField('lud16');
  const lnurl = getMetaField('lnurl');
  
  // Get full pubkey for display (always show npub format, never shortened pubkey)
  const displayPubkey = fullPubkeyForMeta && /^[0-9a-f]{64}$/i.test(fullPubkeyForMeta) 
    ? nip19.npubEncode(fullPubkeyForMeta) 
    : (params.entity.startsWith("npub") ? params.entity : null);
  
  // Load current user's contact list (kind 3) to check if following
  useEffect(() => {
    if (!isLoggedIn || !currentUserPubkey || !subscribe || !fullPubkeyForMeta || !/^[0-9a-f]{64}$/i.test(fullPubkeyForMeta)) return;
    
    const unsub = subscribe(
      [{
        kinds: [3], // Contact list
        authors: [currentUserPubkey],
        limit: 1,
      }],
      defaultRelays,
      (event) => {
        if (event.kind === 3) {
          try {
            const contacts = JSON.parse(event.content);
            if (contacts && typeof contacts === 'object' && contacts.p && Array.isArray(contacts.p)) {
              const pubkeys = contacts.p.map((p: any) => typeof p === 'string' ? p : (p[0] || p.pubkey || ''));
              setContactList(pubkeys);
              setIsFollowing(pubkeys.includes(fullPubkeyForMeta.toLowerCase()));
            }
          } catch (e) {
            console.error("Failed to parse contact list:", e, "Content:", event.content?.slice(0, 100));
            setContactList([]);
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
  }, [isLoggedIn, currentUserPubkey, subscribe, defaultRelays, fullPubkeyForMeta]);
  
  // Handle follow/unfollow
  const handleFollow = async () => {
    if (!isLoggedIn || !currentUserPubkey || !publish || !fullPubkeyForMeta || !/^[0-9a-f]{64}$/i.test(fullPubkeyForMeta)) {
      alert("Please log in to follow users");
      return;
    }
    
    setFollowingLoading(true);
    try {
      const privateKey = await getNostrPrivateKey();
      if (!privateKey) {
        alert("Private key not found. Please log in with your private key.");
        setFollowingLoading(false);
        return;
      }
      
      // Get current contact list
      let newContacts = [...contactList];
      const targetPubkey = fullPubkeyForMeta.toLowerCase();
      
      if (isFollowing) {
        // Unfollow: remove from list
        newContacts = newContacts.filter(p => p.toLowerCase() !== targetPubkey);
      } else {
        // Follow: add to list
        if (!newContacts.includes(targetPubkey)) {
          newContacts.push(targetPubkey);
        }
      }
      
      // Create kind 3 contact list event
      const contactListContent = {
        p: newContacts.map(pubkey => [pubkey, "", "wss://relay.damus.io"]), // Format: [pubkey, relay, petname]
      };
      
      const event = {
        kind: 3,
        created_at: Math.floor(Date.now() / 1000),
        tags: newContacts.map(pubkey => ["p", pubkey]),
        content: JSON.stringify(contactListContent),
        pubkey: currentUserPubkey,
        id: "",
        sig: "",
      };
      
      event.id = getEventHash(event);
      event.sig = signEvent(event, privateKey);
      
      // Publish to relays
      publish(event, defaultRelays);
      
      // Update local state
      setIsFollowing(!isFollowing);
      setContactList(newContacts);
      
      console.log(`✅ ${isFollowing ? 'Unfollowed' : 'Followed'} user ${fullPubkeyForMeta.slice(0, 8)}`);
    } catch (error: any) {
      console.error("Failed to follow/unfollow:", error);
      alert(`Failed to ${isFollowing ? 'unfollow' : 'follow'}: ${error.message || 'Unknown error'}`);
    } finally {
      setFollowingLoading(false);
    }
  };
  
  // Check if viewing own profile
  const isOwnProfile = currentUserPubkey && fullPubkeyForMeta && /^[0-9a-f]{64}$/i.test(fullPubkeyForMeta) && 
    currentUserPubkey.toLowerCase() === fullPubkeyForMeta.toLowerCase();
  
  // Early return check - MUST be after all hooks
  if (!isPubkey) {
    return null; // Redirecting
  }

  // Calculate contribution graph for display (last 52 weeks)
  const weeks = contributionGraph.slice(-52);
  const maxCount = Math.max(...weeks.map(w => w.count), 1);
  const intensityLevels = [0, 1, 3, 6, 10]; // GitHub-like intensity levels

  const getIntensity = (count: number) => {
    if (count === 0) return "bg-gray-800 border border-gray-700";
    const level1 = intensityLevels[1] ?? 1;
    const level2 = intensityLevels[2] ?? 3;
    const level3 = intensityLevels[3] ?? 6;
    if (count <= level1) return "bg-green-900 border border-green-800";
    if (count <= level2) return "bg-green-700 border border-green-600";
    if (count <= level3) return "bg-green-600 border border-green-500";
    return "bg-green-500 border border-green-400";
  };

  return (
    <div className="container mx-auto max-w-6xl p-6">
      {/* Banner */}
      {banner && (
        <div className="mb-6 rounded-lg overflow-hidden h-48 bg-gradient-to-r from-purple-600 to-blue-600">
          <img 
            src={banner} 
            alt={`${displayName} banner`}
            className="w-full h-full object-cover"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        </div>
      )}
      
      {/* User Profile Header */}
      <div className="mb-6 border border-[#383B42] rounded-lg p-6 bg-[#171B21]">
        <div className="flex flex-col md:flex-row items-start gap-6">
          {/* Avatar */}
          <div className="relative">
            {picture && picture.startsWith("http") ? (
            <img 
              src={picture} 
              alt={displayName}
                className="w-32 h-32 rounded-full border-4 border-[#171B21] shrink-0 object-cover"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                  const fallback = (e.target as HTMLElement).nextElementSibling as HTMLElement;
                  if (fallback) fallback.style.display = 'flex';
                }}
              />
            ) : null}
            <div 
              className={`w-32 h-32 rounded-full border-4 border-[#171B21] bg-purple-600 flex items-center justify-center text-4xl font-bold text-white shrink-0 ${picture && picture.startsWith("http") ? 'hidden' : ''}`}
            >
              {/* Use first 2 chars of displayName, but ensure it's not from npub or pubkey */}
              {(() => {
                if (displayName && displayName.length > 0 && 
                    !displayName.startsWith("npub") && 
                    !/^[0-9a-f]{8,64}$/i.test(displayName) &&
                    displayName.length <= 20) {
                  return displayName.substring(0, 2).toUpperCase();
                }
                // Try to get initials from userMeta
                if (userMeta?.name && !userMeta.name.startsWith("npub") && !/^[0-9a-f]{8,64}$/i.test(userMeta.name)) {
                  return userMeta.name.substring(0, 2).toUpperCase();
                }
                if (userMeta?.display_name && !userMeta.display_name.startsWith("npub") && !/^[0-9a-f]{8,64}$/i.test(userMeta.display_name)) {
                  return userMeta.display_name.substring(0, 2).toUpperCase();
                }
                // Last resort: use pubkey prefix
                return fullPubkeyForMeta ? fullPubkeyForMeta.slice(0, 2).toUpperCase() : "??";
              })()}
            </div>
            {nip05 && (
              <div className="absolute -bottom-2 left-1/2 transform -translate-x-1/2 bg-green-500 rounded-full p-1">
                <CheckCircle2 className="w-4 h-4 text-white" />
              </div>
          )}
          </div>
          
          {/* Profile Info */}
          <div className="flex-1 w-full">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h1 className="text-4xl font-bold mb-2">{displayName}</h1>
                {nip05 && (
                  <div className="flex items-center gap-2 text-gray-400 mb-2">
                    <CheckCircle2 className="w-4 h-4 text-green-500" />
                    <span>{nip05}</span>
                  </div>
            )}
            {about && (
                  <p className="text-gray-300 mb-4 max-w-2xl">{about}</p>
            )}
            </div>
              
              {/* Follow Button */}
              {isLoggedIn && !isOwnProfile && (
                <Button
                  onClick={handleFollow}
                  disabled={followingLoading}
                  variant={isFollowing ? "outline" : "default"}
                  className={isFollowing ? "border-purple-500 text-purple-400" : "bg-purple-600 hover:bg-purple-700"}
                >
                  {followingLoading ? (
                    "Loading..."
                  ) : isFollowing ? (
                    <>
                      <UserMinus className="w-4 h-4 mr-2" />
                      Unfollow
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
            
            {/* Stats Row - Shows data from Nostr (repos) and local activities (commits, PRs, bounties) */}
            <div className="flex flex-wrap gap-6 text-sm mb-4">
              <div className="flex items-center gap-2">
                <span className="text-gray-400">Repositories</span>
                <span className="text-purple-400 font-semibold">{userRepos.length}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-gray-400">Commits</span>
                <span className="text-green-400 font-semibold">{activityCounts.commit_created || 0}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-gray-400">PRs Merged</span>
                <span className="text-cyan-400 font-semibold">{activityCounts.pr_merged || 0}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-gray-400">Bounties</span>
                <span className="text-yellow-400 font-semibold">{activityCounts.bounty_claimed || 0}</span>
              </div>
            </div>
            
            {/* Links */}
            <div className="flex flex-wrap gap-4">
              {website && (
                <a 
                  href={website.startsWith('http') ? website : `https://${website}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-purple-400 hover:text-purple-300 text-sm"
                >
                  <Globe className="w-4 h-4" />
                  <span>{website.replace(/^https?:\/\//, '')}</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
              {(lud16 || lnurl) && (
                <div className="flex items-center gap-2 text-yellow-400 text-sm">
                  <Zap className="w-4 h-4" />
                  <span>Lightning: {lud16 || lnurl}</span>
                </div>
              )}
              {displayPubkey && (
                <div className="flex items-center gap-2 text-gray-400 text-xs font-mono">
                  <span>npub: {displayPubkey}</span>
                  <a 
                    href={`https://nostr.me/${displayPubkey}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-purple-400 hover:text-purple-300"
                  >
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              )}
              {fullPubkeyForMeta && /^[0-9a-f]{64}$/i.test(fullPubkeyForMeta) && (
                <div className="flex items-center gap-2 text-gray-400 text-xs font-mono">
                  <span>pubkey: {fullPubkeyForMeta}</span>
                </div>
              )}
            </div>
            
            {/* Claimed Identities (NIP-39) */}
            {(() => {
              // Debug: Log what we have
              if (userMeta) {
                console.log(`🔍 [Profile] userMeta for ${fullPubkeyForMeta?.slice(0, 8)}:`, {
                  hasIdentities: !!userMeta.identities,
                  identitiesCount: userMeta.identities?.length || 0,
                  identities: userMeta.identities,
                  allKeys: Object.keys(userMeta),
                  metadataMapSize: Object.keys(metadataMap).length,
                  metadataMapHasPubkey: !!(pubkeyForMetadata && metadataMap[pubkeyForMetadata.toLowerCase()]),
                  metadataMapIdentities: pubkeyForMetadata ? (metadataMap[pubkeyForMetadata.toLowerCase()]?.identities || []) : []
                });
              }
              return null;
            })()}
            {userMeta?.identities && Array.isArray(userMeta.identities) && userMeta.identities.length > 0 && (
              <div className="mt-4 pt-4 border-t border-[#383B42]">
                <h3 className="text-sm font-semibold text-gray-400 mb-2">Verified Identities</h3>
                <div className="flex flex-wrap gap-2">
                  {userMeta.identities.map((identity: ClaimedIdentity, idx: number) => {
            const platformIcon = identity.platform === "github" ? "🐙" 
              : identity.platform === "twitter" ? "🐦" 
              : identity.platform === "telegram" ? "✈️"
              : identity.platform === "mastodon" ? "🐘"
              : "🔗";
            const platformUrl = identity.platform === "github" 
              ? `https://github.com/${identity.identity}`
              : identity.platform === "twitter"
              ? `https://x.com/${identity.identity}`
              : identity.platform === "telegram"
              ? identity.proof ? `https://t.me/${identity.proof}` : null
              : identity.platform === "mastodon"
              ? identity.identity.includes("@") 
                ? `https://${identity.identity.split("@")[1]}/@${identity.identity.split("@")[0]}`
                : null
              : null;
            const platformName = identity.platform === "twitter" 
              ? "X" 
              : identity.platform === "telegram"
              ? "Telegram"
              : identity.platform === "mastodon"
              ? "Mastodon"
              : identity.platform.charAt(0).toUpperCase() + identity.platform.slice(1);
            const identityDisplay = identity.platform === "telegram"
              ? `User ID: ${identity.identity}`
              : identity.platform === "mastodon"
              ? identity.identity
              : `@${identity.identity}`;
                    
                    return (
                      <a
                        key={idx}
                        href={platformUrl || "#"}
                        target={platformUrl ? "_blank" : undefined}
                        rel={platformUrl ? "noopener noreferrer" : undefined}
                        className="flex items-center gap-2 px-3 py-1.5 bg-[#22262C] border border-[#383B42] rounded-md text-sm hover:bg-[#2a2e34] hover:border-purple-500/50 transition-colors"
                        title={identity.proof ? `Proof: ${identity.proof}` : "No proof available"}
                      >
                <span>{platformIcon}</span>
                <span className="text-gray-300">{platformName}</span>
                <span className="text-purple-400">{identityDisplay}</span>
                        {identity.verified && (
                          <span title="Verified">
                            <CheckCircle2 className="w-4 h-4 text-green-500" />
                          </span>
                        )}
                      </a>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Contribution Graph */}
        <div className="lg:col-span-2 border border-[#383B42] rounded p-4">
          <h2 className="font-semibold mb-4">Activity Timeline</h2>
          <div className="overflow-x-auto">
            <div className="inline-block min-w-full">
              <div className="flex gap-1 mb-2" style={{ width: `${weeks.length * 12}px` }}>
                {weeks.map((week, idx) => (
                  <div
                    key={idx}
                    className={`w-2 h-2 ${getIntensity(week.count)} rounded-sm`}
                    title={`${week.date}: ${week.count} contributions`}
                  />
                ))}
              </div>
              <div className="flex justify-between text-xs text-gray-500 mt-2">
                <span>Less</span>
                <div className="flex gap-1">
                  {intensityLevels.slice(1).map((level, idx) => {
                    const val = level ?? 0;
                    return <div key={idx} className={`w-2 h-2 ${getIntensity(val)} rounded-sm`} />;
                  })}
                  <div className={`w-2 h-2 ${getIntensity(maxCount)} rounded-sm`} />
                </div>
                <span>More</span>
              </div>
              <p className="text-sm text-gray-400 mt-2">
                {userStats?.activityCount || 0} contributions in the last year
              </p>
            </div>
          </div>
        </div>

        {/* Stats Sidebar - Shows local activity data (from localStorage) */}
        <div className="space-y-4">
          <div className="border border-[#383B42] rounded p-4">
            <h3 className="font-semibold mb-2">Statistics</h3>
            <p className="text-xs text-gray-500 mb-3">Local activity data</p>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-400">Total Activity</span>
                <span className="text-purple-400">{userStats?.activityCount || 0}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Commits</span>
                <span className="text-green-400">{activityCounts.commit_created || 0}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">PRs Merged</span>
                <span className="text-cyan-400">{activityCounts.pr_merged || 0}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Bounties Claimed</span>
                <span className="text-yellow-400">{activityCounts.bounty_claimed || 0}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Repositories</span>
                <span className="text-purple-400">{userStats?.reposCreatedCount || 0}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* User Repositories */}
      {userRepos.length > 0 && (
        <div className="mt-6 border border-[#383B42] rounded-lg p-6 bg-[#171B21]">
          <h2 className="text-2xl font-semibold mb-6">Repositories ({userRepos.length})</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {userRepos.map((repo: any) => {
              // CRITICAL: For URLs, use slugified version (repo/slug/repositoryName)
              // For display, use original name (repo.name)
              const repoForUrl = repo.repo || repo.slug;
              const repoDisplayName = repo.name || repoForUrl; // CRITICAL: Use original name for display
              // Use npub format for URLs if we have full pubkey
              let href = `/${repo.entity}/${repoForUrl}`;
              if (repo.ownerPubkey && /^[0-9a-f]{64}$/i.test(repo.ownerPubkey)) {
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
                  // Priority 2: Logo file from repo
                  const logoFiles = repo.files
                    .map((f: any) => f.path)
                    .filter((p: string) => {
                      const fileName = p.split("/").pop() || "";
                      const baseName = fileName.replace(/\.[^.]+$/, "").toLowerCase();
                      const extension = fileName.split(".").pop()?.toLowerCase() || "";
                      const imageExts = ["png", "jpg", "jpeg", "gif", "webp", "svg", "ico"];
                      return baseName.includes("logo") && imageExts.includes(extension);
                    });
                  if (logoFiles.length > 0) {
                    const logoPath = logoFiles[0];
                    if (repo.sourceUrl) {
                      try {
                        const url = new URL(repo.sourceUrl);
                        if (url.hostname === "github.com") {
                          const parts = url.pathname.split("/").filter(Boolean);
                          if (parts.length >= 2 && parts[0] && parts[1]) {
                            const owner = parts[0];
                            const repoName = parts[1].replace(/\.git$/, "");
                            const branch = repo.defaultBranch || "main";
                            iconUrl = `https://raw.githubusercontent.com/${owner}/${repoName}/${encodeURIComponent(branch)}/${logoPath}`;
                          }
                        }
                      } catch {}
                    } else {
                      // For native Nostr repos (without sourceUrl), use the API endpoint
                      const ownerPubkey = repo.ownerPubkey || getRepoOwnerPubkey(repo, repo.entity);
                      const repoName = repo.repo || repo.slug || repo.name;
                      if (ownerPubkey && /^[0-9a-f]{64}$/i.test(ownerPubkey) && repoName) {
                        const branch = repo.defaultBranch || "main";
                        iconUrl = `/api/nostr/repo/file-content?ownerPubkey=${encodeURIComponent(ownerPubkey)}&repo=${encodeURIComponent(repoName)}&path=${encodeURIComponent(logoPath)}&branch=${encodeURIComponent(branch)}`;
                      }
                    }
                  }
                }
                
                // Priority 3: Owner Nostr profile picture (last fallback)
                const ownerPubkey = repo.ownerPubkey || getRepoOwnerPubkey(repo, repo.entity);
                if (ownerPubkey && /^[0-9a-f]{64}$/i.test(ownerPubkey)) {
                  // CRITICAL: Use centralized getUserMetadata function for consistent lookup
                  const ownerMeta = getUserMetadata(ownerPubkey, metadataMap);
                  if (ownerMeta?.picture && !iconUrl) {
                    const picture = ownerMeta.picture;
                    if (picture && picture.trim().length > 0 && picture.startsWith("http")) {
                      iconUrl = picture;
                    }
                  }
                }
              } catch (error) {
                console.error('⚠️ [Profile] Error resolving repo icon:', error);
              }
              
              // Color coding by role (like contributor icons)
              const roleColors = {
                owner: "border-purple-500/50 bg-purple-900/10",
                maintainer: "border-blue-500/50 bg-blue-900/10",
                contributor: "border-green-500/50 bg-green-900/10",
                forked: "border-orange-500/50 bg-orange-900/10",
              };
              const userRole = (repo.userRole || "contributor") as keyof typeof roleColors;
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
                              target.style.display = 'none';
                              const parent = target.parentElement;
                              if (parent && !parent.querySelector('.fallback-icon')) {
                                const fallback = document.createElement('div');
                                fallback.className = 'fallback-icon h-10 w-10 rounded bg-gray-700 border border-gray-600';
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
                        <h3 className="font-semibold text-purple-400 truncate">{repoDisplayName}</h3>
                        {repo.userRole && (
                          <span className={`text-xs px-2 py-0.5 rounded ${
                            repo.userRole === "owner" ? "bg-purple-600/30 text-purple-300" :
                            repo.userRole === "maintainer" ? "bg-blue-600/30 text-blue-300" :
                            repo.userRole === "contributor" ? "bg-green-600/30 text-green-300" :
                            "bg-orange-600/30 text-orange-300"
                          }`}>
                            {repo.userRole}
                          </span>
                        )}
                        {/* Status badge - only show for repos owned by current user */}
                        {currentUserPubkey && repo.ownerPubkey && repo.ownerPubkey.toLowerCase() === currentUserPubkey.toLowerCase() && (() => {
                          const status = getRepoStatus(repo);
                          const style = getStatusBadgeStyle(status);
                          return (
                            <span className={`text-xs px-2 py-0.5 rounded ${style.bg} ${style.text} flex-shrink-0`}>
                              {style.label}
                            </span>
                          );
                        })()}
                      </div>
                      {repo.description && (
                        <p className="text-sm text-gray-400 mt-1 line-clamp-2">{repo.description}</p>
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

