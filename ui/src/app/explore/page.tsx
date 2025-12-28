"use client";
import { useEffect, useMemo, useState, useCallback, useRef, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useNostrContext } from "@/lib/nostr/NostrContext";
import { getAllRelays } from "@/lib/nostr/getAllRelays";
import { useContributorMetadata, type Metadata } from "@/lib/nostr/useContributorMetadata";
import { getRepoOwnerPubkey, getEntityDisplayName } from "@/lib/utils/entity-resolver";
import { KIND_REPOSITORY, KIND_REPOSITORY_NIP34 } from "@/lib/nostr/events";
import { nip19 } from "nostr-tools";
import { loadStoredRepos } from "@/lib/repos/storage";
import { isRepoCorrupted } from "@/lib/utils/repo-corruption-check";

// Parse NIP-34 repository announcement format
// NIP-34 uses tags for metadata, content is empty
function parseNIP34Repository(event: any): any {
  const repoData: any = {
    repositoryName: "",
    description: "",
    clone: [],
    relays: [],
    topics: [],
    maintainers: [],
    web: [],
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
        // Repo ID (usually kebab-case short name)
        repoData.repositoryName = tagValue;
        break;
      case "name":
        // Human-readable project name
        repoData.name = tagValue;
        break;
      case "description":
        // Brief description
        repoData.description = tagValue;
        break;
      case "clone":
        // Git clone URL (can have multiple)
        if (tagValue) repoData.clone.push(tagValue);
        break;
      case "relays":
        // CRITICAL: Handle both formats per NIP-34 spec:
        // 1. Separate tags: ["relays", "wss://relay1.com"], ["relays", "wss://relay2.com"]
        // 2. Comma-separated (backward compat): ["relays", "wss://relay1.com,wss://relay2.com"]
        if (tagValue) {
          // Check if value contains commas (comma-separated format)
          if (tagValue.includes(",")) {
            // Comma-separated format - split and add each
            const relayUrls = tagValue.split(",").map((r: string) => r.trim()).filter((r: string) => r.length > 0);
            relayUrls.forEach((relayUrl: string) => {
              // Ensure wss:// prefix
              const normalized = relayUrl.startsWith("wss://") || relayUrl.startsWith("ws://") 
                ? relayUrl 
                : `wss://${relayUrl}`;
              if (!repoData.relays.includes(normalized)) {
                repoData.relays.push(normalized);
              }
            });
          } else {
            // Single relay per tag - add directly
            const normalized = tagValue.startsWith("wss://") || tagValue.startsWith("ws://") 
              ? tagValue 
              : `wss://${tagValue}`;
            if (!repoData.relays.includes(normalized)) {
              repoData.relays.push(normalized);
            }
          }
        }
        break;
      case "web":
        // Webpage URL (can have multiple)
        if (tagValue) repoData.web.push(tagValue);
        break;
      case "t":
        // Hashtags/topics (can have multiple)
        if (tagValue) repoData.topics.push(tagValue);
        break;
      case "maintainers":
        // Other recognized maintainers (can have multiple)
        // NIP-34: Accept both hex and npub formats, normalize to hex for internal storage
        if (tagValue) {
          let normalizedPubkey = tagValue;
          try {
            // If it's npub format, decode to hex
            if (tagValue.startsWith("npub")) {
              const decoded = nip19.decode(tagValue);
              if (decoded.type === "npub" && /^[0-9a-f]{64}$/i.test(decoded.data as string)) {
                normalizedPubkey = decoded.data as string;
              }
            } else if (/^[0-9a-f]{64}$/i.test(tagValue)) {
              // Already hex format, use as-is
              normalizedPubkey = tagValue.toLowerCase();
            }
            // Only add if valid hex pubkey
            if (/^[0-9a-f]{64}$/i.test(normalizedPubkey)) {
              repoData.maintainers.push(normalizedPubkey);
            }
          } catch (e) {
            // If decoding fails, try to use as hex if valid
            if (/^[0-9a-f]{64}$/i.test(tagValue)) {
              repoData.maintainers.push(tagValue.toLowerCase());
            }
          }
        }
        break;
      case "r":
        // Earliest unique commit ID
        if (tagValue && tag[2] === "euc") {
          repoData.earliestUniqueCommit = tagValue;
        }
        break;
      case "public-read":
        // Privacy: public-read tag (true/false)
        repoData.publicRead = tagValue === "true";
        break;
      case "public-write":
        // Privacy: public-write tag (true/false)
        repoData.publicWrite = tagValue === "true";
        break;
    }
  }
  
  // Use name as repositoryName if d tag wasn't found
  if (!repoData.repositoryName && repoData.name) {
    repoData.repositoryName = repoData.name;
  }
  
  // Default publicRead/publicWrite for NIP-34 repos (only if not set by tags)
  if (repoData.publicRead === undefined) {
    repoData.publicRead = true; // Default to public if not specified
  }
  if (repoData.publicWrite === undefined) {
    repoData.publicWrite = false; // Default to read-only if not specified
  }
  
  return repoData;
}

type Repo = { 
  slug: string; 
  entity?: string;
  repo?: string;
  name: string; 
  description?: string;
  sourceUrl?: string; 
  forkedFrom?: string;
  readme?: string;
  stars?: number;
  forks?: number;
  languages?: Record<string, number>;
  topics?: string[];
  branches?: Array<{name: string; commit?: string}>;
  releases?: Array<{tag: string; name: string; description?: string; createdAt?: number}>;
  createdAt: number;
  updatedAt?: number; // Track when repo was last updated from Nostr
  entityDisplayName?: string;
  logoUrl?: string;
  files?: Array<{type: string; path: string; size?: number}>;
  defaultBranch?: string;
  ownerPubkey?: string; // Explicit owner pubkey for imported repos
  contributors?: Array<{pubkey?: string; name?: string; picture?: string; weight: number; githubLogin?: string}>;
  deleted?: boolean;
  archived?: boolean;
  links?: Array<{type: "docs" | "discord" | "slack" | "youtube" | "twitter" | "github" | "other"; url: string; label?: string}>;
  // GRASP-01: Clone and relays tags
  clone?: string[];
  relays?: string[];
  // Status tracking
  status?: "local" | "pushing" | "live" | "live_with_edits" | "push_failed";
  hasUnpushedEdits?: boolean;
  lastModifiedAt?: number;
  nostrEventId?: string;
  lastNostrEventId?: string;
  lastNostrEventCreatedAt?: number;
  syncedFromNostr?: boolean;
  fromNostr?: boolean;
  // Privacy
  publicRead?: boolean;
  publicWrite?: boolean;
};

function ExplorePageContent() {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [isLoadingRepos, setIsLoadingRepos] = useState(true);
  const [isLoadingMetadata, setIsLoadingMetadata] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const searchParams = useSearchParams();
  const q = (searchParams?.get("q") || "").toLowerCase();
  const userFilter = searchParams?.get("user") || null;
  const { defaultRelays, subscribe, pubkey, addRelay } = useNostrContext();
  
  // DEBUG: Log context values
  useEffect(() => {
    console.log('🔍 [Explore] Context values:', {
      hasSubscribe: !!subscribe,
      hasDefaultRelays: !!defaultRelays,
      defaultRelaysLength: defaultRelays?.length || 0,
      defaultRelays: defaultRelays,
      pubkey: pubkey ? pubkey.slice(0, 8) : 'none'
    });
  }, [subscribe, defaultRelays, pubkey]);
  
  // Get owner metadata for RENDERED repos only (batched, progressive loading)
  // CRITICAL: Only fetch metadata for repos that are actually rendered (first batch)
  // Fetch more metadata progressively as repos appear, not all upfront
  // This matches homepage pattern: only fetch for `recent` repos (12 repos)
  // INCREASED: Fetch metadata for first 100 repos to ensure more icons show up when logged out
  // The cache will be checked first, so this only fetches missing metadata from Nostr
  const [metadataBatchSize] = useState(100); // Fetch metadata for first 100 rendered repos
  
  const ownerPubkeys = useMemo(() => {
    console.log(`🔍 [Explore] Computing ownerPubkeys: repos.length=${repos.length}`);
    // Only fetch metadata if we have repos (like homepage - no loading state check)
    if (repos.length === 0) {
      console.log(`⏭️ [Explore] No repos, returning empty pubkeys array`);
      return [];
    }
    
    // Get filtered repos (same logic as filteredRepos but we need it here for metadata)
    const reposWithEntity = repos.map(r => {
      if (!r.entity || r.entity === "user") {
        if (r.ownerPubkey && /^[0-9a-f]{64}$/i.test(r.ownerPubkey)) {
          const derivedEntity = nip19.npubEncode(r.ownerPubkey);
          return {
            ...r,
            entity: derivedEntity,
            entityDisplayName: r.entityDisplayName || derivedEntity
          };
        }
      }
      return r;
    });
    
    const sortedRepos = reposWithEntity.slice().sort((a,b)=> (b.createdAt || 0) - (a.createdAt || 0));
    
    // Apply same filters as filteredRepos
    // CRITICAL: Don't mutate repo objects - create new objects if needed
    const filtered = sortedRepos.filter(r => {
      if (!r.entity || r.entity === "user") {
        if (r.ownerPubkey && /^[0-9a-f]{64}$/i.test(r.ownerPubkey)) {
          // Don't mutate - just check if it would be valid
          // Entity is valid, continue filtering
        } else {
          return false;
        }
      }
      
      const repoName = (r.repo || r.slug || r.name || "").toLowerCase();
      const isTestRepo = repoName.startsWith("test") || repoName.includes("test-") || repoName === "test";
      const isProfileRepo = repoName === "profile" || repoName === "profile-page" || repoName.includes("profile-");
      if (isTestRepo || isProfileRepo) return false;
      
      if (userFilter) {
        const entity = r.entity || "";
        const entityDisplayName = r.entityDisplayName || "";
        const matches = (
          entity.toLowerCase().includes(userFilter.toLowerCase()) ||
          entityDisplayName.toLowerCase().includes(userFilter.toLowerCase()) ||
          (userFilter.length >= 4 && entity.toLowerCase().startsWith(userFilter.toLowerCase()))
        );
        if (!matches) return false;
      }
      
      if (q) {
        const entity = r.entity || "";
        const repo = r.repo || r.slug || "";
        const name = r.name || repo;
        const description = (r.description || "").toLowerCase();
        const topics = (r.topics || []).map((t: string) => t.toLowerCase()).join(" ");
        const entityDisplayName = (r.entityDisplayName || "").toLowerCase();
        
        // Search in: repo name, description, topics, entity/repo path, and owner display name
        // Note: ownerMetadata not available here yet, but entityDisplayName should work for most cases
        const matches = (
          `${entity}/${repo}`.toLowerCase().includes(q) ||
          name.toLowerCase().includes(q) ||
          description.includes(q) ||
          topics.includes(q) ||
          entityDisplayName.includes(q)
        );
        if (!matches) return false;
      }
      
      return true;
    });
    
    // CRITICAL: Only fetch metadata for first batch of rendered repos (like homepage)
    // This prevents overwhelming relays and ensures metadata loads progressively
    const reposForMetadata = filtered.slice(0, metadataBatchSize);
    
    const pubkeys = new Set<string>();
    
    // CRITICAL: Ensure we use FULL 64-char pubkeys, never shortened ones
    for (const repo of reposForMetadata) {
      if (!repo.entity || repo.entity === "user") continue;
      
      const fullPubkey = getRepoOwnerPubkey(repo as any, repo.entity);
      // CRITICAL: Validate it's a full 64-char hex pubkey (not shortened, not npub)
      if (fullPubkey && /^[0-9a-f]{64}$/i.test(fullPubkey)) {
        pubkeys.add(fullPubkey);
      } else {
        console.warn('⚠️ [Explore] Skipping invalid pubkey:', {
          repo: repo.slug || repo.repo,
          entity: repo.entity,
          ownerPubkey: repo.ownerPubkey ? repo.ownerPubkey.slice(0, 16) : 'MISSING',
          resolvedPubkey: fullPubkey ? fullPubkey.slice(0, 16) : 'NULL',
          isValid: fullPubkey ? /^[0-9a-f]{64}$/i.test(fullPubkey) : false
        });
      }
    }
    
    const pubkeyArray = Array.from(pubkeys);
    console.log('🔑 [Explore] Owner pubkeys for metadata (BATCHED):', {
      totalRepos: repos.length,
      filteredRepos: filtered.length,
      reposForMetadata: reposForMetadata.length,
      pubkeysFound: pubkeyArray.length,
      batchSize: metadataBatchSize,
      samplePubkeys: pubkeyArray.slice(0, 3).map(p => ({
        short: p.slice(0, 8),
        full: p.slice(0, 16) + '...',
        length: p.length,
        isValid: /^[0-9a-f]{64}$/i.test(p)
      })),
      ALL_PUBKEYS: pubkeyArray.map(p => p.slice(0, 16) + '...'), // Log first 16 chars of each
      RETURNING_ARRAY_LENGTH: pubkeyArray.length
    });
    
    console.log(`✅ [Explore] ownerPubkeys computed: returning ${pubkeyArray.length} pubkeys`);
    return pubkeyArray;
  }, [repos, q, userFilter, metadataBatchSize]);
  
  // Debug: Log when ownerPubkeys changes
  useEffect(() => {
    console.log(`🔄 [Explore] ownerPubkeys changed: length=${ownerPubkeys.length}`, {
      pubkeys: ownerPubkeys.slice(0, 3).map(p => p.slice(0, 8)),
      joinValue: ownerPubkeys.join(",").slice(0, 50)
    });

    if (typeof window !== "undefined") {
      (window as any).__gittrExploreState = {
        ...(window as any).__gittrExploreState,
        ownerPubkeys,
      };
    }
  }, [ownerPubkeys]);

  // CRITICAL: useContributorMetadata hook handles all metadata fetching
  // No need for manual subscription - the hook does it automatically
  const ownerMetadata = useContributorMetadata(ownerPubkeys);

  // REMOVED: Old manual metadata subscription code - useContributorMetadata hook handles it now
  // The hook automatically:
  // - Loads from localStorage cache
  // - Subscribes to Nostr relays for missing metadata
  // - Updates state when metadata arrives
  // - Handles caching and deduplication
 
  // Debug: Log metadata state
  useEffect(() => {
    const metadataCount = Object.keys(ownerMetadata).length;
    console.log('📊 [Explore] Metadata state:', {
      ownerPubkeysCount: ownerPubkeys.length,
      metadataKeysCount: metadataCount,
      metadataKeys: Object.keys(ownerMetadata).slice(0, 3).map(k => k.slice(0, 8)),
      sampleMetadata: Object.keys(ownerMetadata).slice(0, 2).map(k => ({
        pubkey: k.slice(0, 8),
        hasPicture: !!ownerMetadata[k]?.picture,
        picture: ownerMetadata[k]?.picture?.slice(0, 50) || 'none'
      }))
    });
    if (ownerPubkeys.length > 0 && metadataCount === 0) {
      console.warn('⚠️ [Explore] METADATA NOT LOADING! Have', ownerPubkeys.length, 'pubkeys but 0 metadata entries');
    }

    if (typeof window !== "undefined") {
      (window as any).__gittrExploreState = {
        ...(window as any).__gittrExploreState,
        ownerMetadata,
        metadataKeysCount: metadataCount,
      };
    }
  }, [ownerPubkeys.length, ownerMetadata]);
  
  // Track when metadata is loading
  useEffect(() => {
    if (ownerPubkeys.length === 0) {
        setIsLoadingMetadata(false);
      return;
    }
    if (Object.keys(ownerMetadata).length > 0) {
      setIsLoadingMetadata(false);
    }
  }, [ownerPubkeys.length, ownerMetadata]);
  
  // Function to resolve repo icon with priority:
  // 1. Stored logoUrl (user-set in repo settings)
  // 2. Logo file from repo (if files list has logo.*)
  // 3. Owner Nostr profile picture (last fallback)
  // (GitHub owner avatar removed - should use Nostr profile picture for imported repos)
  // CRITICAL: Use ref to access metadata without causing re-renders that block clicks
  const resolveRepoIcon = (repo: Repo): string | null => {
    // Priority 1: Stored logoUrl
    if (repo.logoUrl && repo.logoUrl.trim().length > 0) {
      return repo.logoUrl;
    }
    
    // Priority 2: Logo/repo image file from repo (search all directories, handle multiple formats/names)
    if (repo.files && repo.files.length > 0) {
      const repoName = (repo.repo || repo.slug || repo.name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
      const imageExts = ["png", "jpg", "jpeg", "gif", "webp", "svg", "ico"];
      
      // Find all potential icon files:
      // 1. Files with "logo" in name (highest priority)
      // 2. Files named after the repo (e.g., "tides.png" for tides repo)
      // 3. Common icon names in root (repo.png, icon.png, etc.)
      const iconFiles = repo.files
        .map(f => f.path)
        .filter(p => {
          const fileName = p.split("/").pop() || "";
          const baseName = fileName.replace(/\.[^.]+$/, "").toLowerCase();
          const extension = fileName.split(".").pop()?.toLowerCase() || "";
          const isRoot = p.split("/").length === 1;
          
          if (!imageExts.includes(extension)) return false;
          
          // Match logo files, but exclude third-party logos (alby, etc.)
          if (baseName.includes("logo") && !baseName.includes("logo-alby") && !baseName.includes("alby-logo")) return true;
          
          // Match repo-name-based files (e.g., "tides.png" for tides repo)
          if (repoName && baseName === repoName) return true;
          
          // Match common icon names in root directory
          if (isRoot && (baseName === "repo" || baseName === "icon" || baseName === "favicon")) return true;
          
          return false;
        });
      
      const logoFiles = iconFiles;
      
      if (logoFiles.length > 0) {
        // Prioritize logo files
        const prioritized = logoFiles.sort((a, b) => {
          const aParts = a.split("/");
          const bParts = b.split("/");
          const aName = aParts[aParts.length - 1]?.replace(/\.[^.]+$/, "").toLowerCase() || "";
          const bName = bParts[bParts.length - 1]?.replace(/\.[^.]+$/, "").toLowerCase() || "";
          const aIsRoot = aParts.length === 1;
          const bIsRoot = bParts.length === 1;
          
          // Priority 1: Exact "logo" match
          if (aName === "logo" && bName !== "logo") return -1;
          if (bName === "logo" && aName !== "logo") return 1;
          
          // Priority 2: Repo-name-based files (e.g., "tides.png")
          if (repoName && aName === repoName && bName !== repoName && bName !== "logo") return -1;
          if (repoName && bName === repoName && aName !== repoName && aName !== "logo") return 1;
          
          // Priority 3: Root directory files
          if (aName === "logo" && bName === "logo") {
            if (aIsRoot && !bIsRoot) return -1;
            if (!aIsRoot && bIsRoot) return 1;
          }
          if (aIsRoot && !bIsRoot) return -1;
          if (!aIsRoot && bIsRoot) return 1;
          
          // Priority 4: Format preference
          const aExt = a.split(".").pop()?.toLowerCase() || "";
          const bExt = b.split(".").pop()?.toLowerCase() || "";
          const formatPriority = { png: 0, svg: 1, webp: 2, jpg: 3, jpeg: 3, gif: 4, ico: 5 };
          const aPrio = formatPriority[aExt as keyof typeof formatPriority] ?? 10;
          const bPrio = formatPriority[bExt as keyof typeof formatPriority] ?? 10;
          
          return aPrio - bPrio;
        });
        
        const logoPath = prioritized[0];
        
        // Helper function to extract owner/repo from various URL formats
        const extractOwnerRepo = (urlString: string): { owner: string; repo: string; hostname: string } | null => {
          try {
            // Handle SSH format: git@github.com:owner/repo.git
            if (urlString.includes('@') && urlString.includes(':')) {
              const match = urlString.match(/(?:git@|https?:\/\/)([^\/:]+)[\/:]([^\/]+)\/([^\/]+?)(?:\.git)?$/);
              if (match && match[1] && match[2] && match[3]) {
                const hostname = match[1]!;
                const owner = match[2]!;
                const repo = match[3]!.replace(/\.git$/, '');
                return { owner, repo, hostname };
              }
            }
            
            // Handle HTTPS/HTTP URLs
            const url = new URL(urlString);
            const parts = url.pathname.split("/").filter(Boolean);
            if (parts.length >= 2 && parts[0] && parts[1]) {
              return {
                owner: parts[0],
                repo: parts[1].replace(/\.git$/, ''),
                hostname: url.hostname
              };
            }
          } catch (e) {
            // Invalid URL format
          }
          return null;
        };
        
        // Try sourceUrl first
        let gitUrl: string | undefined = repo.sourceUrl;
        let ownerRepo: { owner: string; repo: string; hostname: string } | null = null;
        
        if (gitUrl) {
          ownerRepo = extractOwnerRepo(gitUrl);
        }
        
        // If sourceUrl didn't work, try clone array
        if (!ownerRepo && (repo as any).clone && Array.isArray((repo as any).clone) && (repo as any).clone.length > 0) {
          // Find first GitHub/GitLab/Codeberg URL in clone array
          const gitCloneUrl = (repo as any).clone.find((url: string) => 
            url && (url.includes('github.com') || url.includes('gitlab.com') || url.includes('codeberg.org'))
          );
          if (gitCloneUrl) {
            ownerRepo = extractOwnerRepo(gitCloneUrl);
          }
        }
        
        // If we found a valid git URL, construct raw URL
        if (ownerRepo) {
          const { owner, repo: repoName, hostname } = ownerRepo;
          const branch = repo.defaultBranch || "main";
          
          if (hostname === "github.com" || hostname.includes("github.com")) {
            return `https://raw.githubusercontent.com/${owner}/${repoName}/${encodeURIComponent(branch)}/${logoPath}`;
          } else if (hostname === "gitlab.com" || hostname.includes("gitlab.com")) {
            return `https://gitlab.com/${owner}/${repoName}/-/raw/${encodeURIComponent(branch)}/${logoPath}`;
          } else if (hostname === "codeberg.org" || hostname.includes("codeberg.org")) {
            return `https://codeberg.org/${owner}/${repoName}/raw/branch/${encodeURIComponent(branch)}/${logoPath}`;
          }
        }
        
        // For native Nostr repos (without sourceUrl or clone URLs), use the API endpoint
        // CRITICAL: Use repositoryName from Nostr event (exact name used by git-nostr-bridge)
        // Priority: repositoryName > repo > slug > name
        if (!ownerRepo && logoPath) {
          const ownerPubkey = repo.entity ? getRepoOwnerPubkey(repo as any, repo.entity) : null;
          const repoDataAny = repo as any;
          let repoName = repoDataAny?.repositoryName || repo.repo || repo.slug || repo.name;
          
          // Extract repo name (handle paths like "gitnostr.com/gitworkshop")
          if (repoName && typeof repoName === 'string' && repoName.includes('/')) {
            const parts = repoName.split('/');
            repoName = parts[parts.length - 1] || repoName;
          }
          if (repoName) {
            repoName = String(repoName).replace(/\.git$/, '');
          }
          
          if (ownerPubkey && /^[0-9a-f]{64}$/i.test(ownerPubkey) && repoName) {
            const branch = repo.defaultBranch || "main";
            // Construct API URL - this will work for native Nostr repos
            return `/api/nostr/repo/file-content?ownerPubkey=${encodeURIComponent(ownerPubkey)}&repo=${encodeURIComponent(repoName)}&path=${encodeURIComponent(logoPath)}&branch=${encodeURIComponent(branch)}`;
          }
        }
      }
    }
    
    // Priority 3: Owner Nostr profile picture (last fallback)
    // CRITICAL: Use getRepoOwnerPubkey to resolve full pubkey (handles all cases)
    const ownerPubkey = repo.entity ? getRepoOwnerPubkey(repo as any, repo.entity) : null;
    if (ownerPubkey && /^[0-9a-f]{64}$/i.test(ownerPubkey)) {
      // CRITICAL: Use ownerMetadata directly so React re-renders when metadata loads
      // Normalize pubkey to lowercase for metadata lookup
      const normalizedPubkey = ownerPubkey.toLowerCase();
      const metadata = ownerMetadata[normalizedPubkey] || ownerMetadata[ownerPubkey];
      if (metadata?.picture) {
        const picture = metadata.picture;
        if (picture && picture.trim().length > 0 && picture.startsWith("http")) {
          return picture;
        }
      }
    }
    
    return null;
  };
  
  // Load repos from localStorage and sync from Nostr
  const loadRepos = useCallback(() => {
    setIsLoadingRepos(true);
    try {
      // DEBUG: Check raw localStorage first
      const rawRepos = localStorage.getItem("gittr_repos");
      console.log('🔍 [Explore] loadRepos - raw localStorage:', {
        hasData: !!rawRepos,
        length: rawRepos ? JSON.parse(rawRepos).length : 0,
        sample: rawRepos ? JSON.parse(rawRepos).slice(0, 2).map((r: any) => ({
          entity: r.entity,
          repo: r.repo || r.slug,
          hasOwnerPubkey: !!r.ownerPubkey,
          ownerPubkey: r.ownerPubkey?.slice(0, 8)
        })) : []
      });
      
      const list = loadStoredRepos();
      console.log('🔍 [Explore] loadRepos - after loadStoredRepos:', {
        loadedCount: list.length,
        sample: list.slice(0, 2).map(r => ({
          entity: r.entity,
          repo: r.repo || r.slug,
          hasOwnerPubkey: !!r.ownerPubkey
        }))
      });
      
      // Load list of locally-deleted repos (user deleted them, don't show)
      const deletedRepos = JSON.parse(localStorage.getItem("gittr_deleted_repos") || "[]") as Array<{entity: string; repo: string; deletedAt: number}>;
      const deletedReposSet = new Set(deletedRepos.map(d => `${d.entity}/${d.repo}`.toLowerCase()));
      
      // Filter out locally-deleted repos AND repos marked as deleted/archived on Nostr
      // CRITICAL: Also ensure all repos have entity (derive from ownerPubkey if missing)
      const filtered = list
        .map((r: any) => {
          // Derive entity from ownerPubkey if missing
          if ((!r.entity || r.entity === "user") && r.ownerPubkey && /^[0-9a-f]{64}$/i.test(r.ownerPubkey)) {
            // CRITICAL: Use npub format, not shortened pubkey
            let entityDisplay = r.entityDisplayName;
            if (!entityDisplay) {
              try {
                entityDisplay = nip19.npubEncode(r.ownerPubkey).substring(0, 16) + "...";
              } catch {
                entityDisplay = r.ownerPubkey.substring(0, 16) + "...";
              }
            }
            return {
              ...r,
              entity: nip19.npubEncode(r.ownerPubkey), // Use npub format
              entityDisplayName: entityDisplay
            };
          }
          return r;
        })
        .filter((r: any) => {
          const entity = r.entity || "";
          const repo = r.repo || r.slug || "";
          const repoKey = `${entity}/${repo}`.toLowerCase();
          
          // Skip if locally deleted (completely hidden from explore - no note shown)
          if (deletedReposSet.has(repoKey)) return false;
          
          // Skip if owner marked as deleted/archived on Nostr (completely hidden from explore - no note shown)
          if (r.deleted === true || r.archived === true) return false;
          
          // Skip if still no entity (can't display without entity)
          if (!r.entity || r.entity === "user") {
            console.warn('⚠️ [Explore] Skipping repo without entity:', {
              slug: r.slug,
              repo: r.repo,
              hasOwnerPubkey: !!r.ownerPubkey
            });
            return false;
          }
          
          return true;
        });
      
      // Ensure we load all repo fields including ownerPubkey and contributors
      const finalRepos = filtered.map((r: any) => ({
        ...r,
        ownerPubkey: r.ownerPubkey,
        contributors: r.contributors || [],
      }));
      
      console.log('🔍 [Explore] loadRepos - final repos to set:', {
        count: finalRepos.length,
        sample: finalRepos.slice(0, 2).map(r => ({
          entity: r.entity,
          repo: r.repo || r.slug,
          hasOwnerPubkey: !!r.ownerPubkey
        }))
      });
      
      setRepos(finalRepos);
    } catch (err) {
      console.error('❌ [Explore] loadRepos error:', err);
      setRepos([]);
    } finally {
      setIsLoadingRepos(false);
    }
  }, []);
  
  useEffect(() => {
    loadRepos();
    
    // Listen for repo updates from Nostr sync
    const handleRepoUpdate = () => {
      loadRepos();
    };
    
    window.addEventListener("storage", handleRepoUpdate);
    window.addEventListener("gittr:repo-created", handleRepoUpdate);
    window.addEventListener("gittr:repo-imported", handleRepoUpdate);
    
    return () => {
      window.removeEventListener("storage", handleRepoUpdate);
      window.removeEventListener("gittr:repo-created", handleRepoUpdate);
      window.removeEventListener("gittr:repo-imported", handleRepoUpdate);
    };
  }, [loadRepos]);

  // Sync from Nostr relays - query for ALL public repos (Nostr cloud)
  // This allows users to see repos from all users, not just their own
  useEffect(() => {
    // Wait for client-side only
    if (typeof window === 'undefined') return;
    
    console.log('🔍 [Explore] useEffect triggered:', {
      hasSubscribe: !!subscribe,
      hasDefaultRelays: !!defaultRelays,
      defaultRelaysLength: defaultRelays?.length || 0,
      pubkey: pubkey ? pubkey.slice(0, 8) : 'none',
      relayList: defaultRelays?.slice(0, 5) // Show first 5 relays
    });
    
    if (!subscribe || !defaultRelays || defaultRelays.length === 0) {
      console.warn('⚠️ [Explore] Cannot subscribe: subscribe=', !!subscribe, 'defaultRelays=', defaultRelays?.length || 0, 'defaultRelays=', defaultRelays);
      // Retry after a short delay if context isn't ready yet
      const timeout = setTimeout(() => {
        if (subscribe && defaultRelays && defaultRelays.length > 0) {
          console.log('🔄 [Explore] Retrying subscription after delay...');
          // Force re-trigger by updating a dependency
        }
      }, 1000);
      return () => clearTimeout(timeout);
    }
    
    // CRITICAL: Clear old repos from localStorage to force fresh fetch
    // This ensures we get ALL repos from Nostr, not just cached ones
    const existingRepos = JSON.parse(localStorage.getItem("gittr_repos") || "[]");
    console.log('📊 [Explore] Current repos in localStorage:', existingRepos.length);
    
    console.log('📡 [Explore] Starting subscription with', defaultRelays.length, 'relays:', defaultRelays);
    setSyncing(true);
    
    // Identify GRASP relays (these have the most repos!)
    const { getGraspServers } = require("@/lib/utils/grasp-servers");
    const graspRelays = getGraspServers(defaultRelays);
    console.log('🎯 [Explore] GRASP relays found:', graspRelays.length, graspRelays);
    
    // Track which relays have sent EOSE - but prioritize GRASP relays
    // Stop syncing after we get responses from at least 2 GRASP relays OR 5 regular relays OR 10 seconds
    const eoseReceived = new Set<string>();
    const graspRelaysReceived = new Set<string>();
    let eoseTimeout: NodeJS.Timeout | null = null;
    let minRelaysTimeout: NodeJS.Timeout | null = null;
    
    const checkShouldStopSyncing = () => {
      // CRITICAL: This only stops the "syncing" UI indicator, NOT the subscription!
      // The subscription continues to listen for new repos in real-time even after this.
      // EOSE means "end of stored events" - but new events can still arrive after EOSE.
      
      // Stop showing "syncing" status if we've received EOSE from at least 2 GRASP relays
      // OR if we've received repos from at least 5 regular relays and waited 5 seconds
      // OR if we've received a very large number of repos (2000+) - we have enough initial data
      const repos = JSON.parse(localStorage.getItem("gittr_repos") || "[]");
      const hasEnoughRepos = repos.length > 0;
      const hasVeryManyRepos = repos.length >= 2000; // Large number = good initial sample
      
      const hasEnoughGraspRelays = graspRelaysReceived.size >= 2;
      const hasEnoughRegularRelays = eoseReceived.size >= 5 && hasEnoughRepos;
      
      if (hasEnoughGraspRelays || hasEnoughRegularRelays || hasVeryManyRepos) {
        console.log('✅ [Explore] Hiding sync indicator - enough initial data received:', {
          eoseCount: eoseReceived.size,
          graspRelaysReceived: graspRelaysReceived.size,
          totalRepos: repos.length,
          reason: hasEnoughGraspRelays ? '2+ GRASP relays' : 
                  hasEnoughRegularRelays ? '5+ regular relays with repos' :
                  '2000+ repos received (good initial sample)',
          note: 'Subscription continues to listen for new repos in real-time'
        });
        setSyncing(false); // Only hides the UI indicator - subscription keeps running!
        if (eoseTimeout) clearTimeout(eoseTimeout);
        if (minRelaysTimeout) clearTimeout(minRelaysTimeout);
      }
    };
    
    // Stop syncing after 15 seconds max (longer to allow GRASP relays to respond)
    eoseTimeout = setTimeout(() => {
      console.log('⏱️ [Explore] Sync timeout after 15s:', {
        eoseReceived: eoseReceived.size,
        graspRelaysReceived: graspRelaysReceived.size,
        totalRepos: JSON.parse(localStorage.getItem("gittr_repos") || "[]").length
      });
      setSyncing(false);
      if (minRelaysTimeout) clearTimeout(minRelaysTimeout);
    }, 15000);
    
    // Also stop after 8 seconds if we have at least 2 GRASP relay responses OR 5 regular relays
    minRelaysTimeout = setTimeout(() => {
      checkShouldStopSyncing();
    }, 8000);
    
    // Query Nostr for ALL repositories (no author filter = all users)
    // Also query user's own repos to ensure they're included
    // NOTE: No time limit - get all repos from Nostr (historical repos are valuable)
    // Relays will handle pagination/limits if needed
    // CRITICAL: Query for BOTH kind 51 (gitnostr) and kind 30617 (NIP-34) to see all repos
    // Also subscribe to NIP-09 deletion events (kind 5) to filter deleted repos
    const filters = [
      {
        kinds: [KIND_REPOSITORY, KIND_REPOSITORY_NIP34], // Support both gitnostr (51) and NIP-34 (30617)
        limit: 10000, // Request up to 10k repos (most relays default to 100-500 without this)
        // No since parameter = get ALL repos (no time limit)
        // No authors filter = get ALL public repos from all users
        // This is the "Nostr cloud" - repos are stored on relays, not locally
      },
      {
        kinds: [5], // NIP-09: Deletion events - to filter out deleted repos
        limit: 1000,
      },
      ...(pubkey ? [{
        kinds: [KIND_REPOSITORY, KIND_REPOSITORY_NIP34], // Support both formats
        authors: [pubkey], // Also get user's own repos (for private repos in future)
        limit: 1000, // User's own repos - smaller limit is fine
        // No since parameter = get all user's repos (no time limit)
      }] : []),
    ];
    
    console.log('📡 [Explore] Subscribing with filters:', JSON.stringify(filters, null, 2));
    
    // CRITICAL: Use all relays (default + user) for repository discovery
    const allRelays = getAllRelays(defaultRelays);
    
    // CRITICAL: For NIP-34 replaceable events, collect ALL events per repo and pick the latest
    // Map: repoKey (pubkey + d tag) -> array of events
    const nip34EventsByRepo = new Map<string, Array<{event: any; relayURL?: string}>>();
    
    const unsub = subscribe(
      filters,
      allRelays,
      (event, isAfterEose, relayURL) => {
        // CRITICAL: Process ALL events, including those that arrive after EOSE!
        // EOSE (End of Stored Events) just means the relay finished sending stored events,
        // but new events can still arrive in real-time. The subscription NEVER stops listening.
        // We continue to process and add new repos even after the "syncing" status changes to false.
        console.log('📨 [Explore] Event received:', {
          kind: event.kind,
          expectedKinds: [KIND_REPOSITORY, KIND_REPOSITORY_NIP34, 5],
          relay: relayURL,
          isAfterEose,
          pubkey: event.pubkey?.slice(0, 8),
          eventId: event.id?.slice(0, 8)
        });
        
        // CRITICAL: For NIP-34 replaceable events, collect ALL events first
        // Don't process immediately - wait for EOSE to pick the latest one
        if (event.kind === KIND_REPOSITORY_NIP34) {
          const dTag = event.tags?.find((t: any) => Array.isArray(t) && t[0] === "d");
          const repoName = dTag?.[1];
          if (repoName && event.pubkey) {
            const repoKey = `${event.pubkey}/${repoName}`;
            if (!nip34EventsByRepo.has(repoKey)) {
              nip34EventsByRepo.set(repoKey, []);
            }
            nip34EventsByRepo.get(repoKey)!.push({ event, relayURL });
            console.log(`📦 [Explore] Collected NIP-34 event for ${repoKey}: id=${event.id.slice(0, 8)}..., created_at=${event.created_at}, total=${nip34EventsByRepo.get(repoKey)!.length}`);
            // Don't return - continue to process it normally too (for immediate display)
            // But we'll ensure the latest one is used when storing
          }
        }
        
        // Handle NIP-09 deletion events (kind 5)
        if (event.kind === 5) {
          // NIP-09: Deletion events reference the deleted event via "e" tag
          // Process deletion events to mark repos as deleted
          if (event.tags && Array.isArray(event.tags)) {
            for (const tag of event.tags) {
              if (Array.isArray(tag) && tag[0] === "e" && tag[1]) {
                const deletedEventId = tag[1];
                console.log('🗑️ [Explore] NIP-09 deletion event received for event:', deletedEventId.slice(0, 8));
                
                // Find repos with this event ID and mark them as deleted
                const existingRepos = JSON.parse(localStorage.getItem("gittr_repos") || "[]") as Repo[];
                let updated = false;
                
                const updatedRepos = existingRepos.map((r: any) => {
                  // Match by nostrEventId or lastNostrEventId
                  if ((r.nostrEventId === deletedEventId || r.lastNostrEventId === deletedEventId) && !r.deleted) {
                    console.log('🗑️ [Explore] Marking repo as deleted via NIP-09:', {
                      repo: r.repo || r.slug,
                      entity: r.entity,
                      eventId: deletedEventId.slice(0, 8)
                    });
                    updated = true;
                    return { ...r, deleted: true };
                  }
                  return r;
                });
                
                if (updated) {
                  localStorage.setItem("gittr_repos", JSON.stringify(updatedRepos));
                  // Trigger reload to update UI
                  setTimeout(() => {
                    loadRepos();
                  }, 100);
                }
              }
            }
          }
          return; // Don't process deletion events as repos
        }
        
        // Support both gitnostr (kind 51) and NIP-34 (kind 30617)
        if (event.kind === KIND_REPOSITORY || event.kind === KIND_REPOSITORY_NIP34) {
          try {
            // NIP-34 uses tags for metadata, content is empty
            // gitnostr uses JSON in content
            let repoData: any;
            if (event.kind === KIND_REPOSITORY_NIP34) {
              // NIP-34 format: Parse from tags
              repoData = parseNIP34Repository(event);
            } else {
              // gitnostr format: Parse from JSON content
              // CRITICAL: Validate content is JSON before parsing
              if (!event.content || typeof event.content !== 'string') {
                console.warn('⚠️ [Explore] Skipping event with invalid content:', {
                  eventId: event.id.slice(0, 8),
                  kind: event.kind,
                  contentLength: event.content?.length || 0
                });
                return;
              }
              
              // Check if content looks like JSON (starts with { or [)
              const trimmedContent = event.content.trim();
              if (!trimmedContent.startsWith('{') && !trimmedContent.startsWith('[')) {
                console.warn('⚠️ [Explore] Skipping event with non-JSON content:', {
                  eventId: event.id.slice(0, 8),
                  kind: event.kind,
                  contentPreview: trimmedContent.slice(0, 50)
                });
                return;
              }
              
              try {
                repoData = JSON.parse(event.content);
              } catch (parseError) {
                console.warn('⚠️ [Explore] Failed to parse JSON content:', {
                  eventId: event.id.slice(0, 8),
                  kind: event.kind,
                  error: parseError,
                  contentPreview: trimmedContent.slice(0, 100)
                });
                return; // Skip this event
              }
            }
            
            // CRITICAL: Validate repoData has required fields
            if (!repoData || typeof repoData !== 'object' || !repoData.repositoryName) {
              console.warn('⚠️ [Explore] Skipping event with invalid repoData:', {
                eventId: event.id.slice(0, 8),
                hasRepoData: !!repoData,
                hasRepositoryName: !!repoData?.repositoryName
              });
              return;
            }
            
            // GRASP-01: Parse clone, relays, topics, and contributors from event.tags
            // Tags are stored as: ["clone", "https://gittr.space"] or ["relays", "wss://relay.example.com"]
            // Contributors are stored as: ["p", pubkey, weight, role]
            const cloneTags: string[] = [];
            const relaysTags: string[] = [];
            const topicTags: string[] = [];
            const contributorTags: Array<{pubkey: string; weight: number; role?: string}> = [];
            
            if (event.tags && Array.isArray(event.tags)) {
              for (const tag of event.tags) {
                if (Array.isArray(tag) && tag.length >= 2) {
                  const tagName = tag[0];
                  const tagValue = tag[1];
                  
                  if (tagName === "clone" && tagValue) {
                    cloneTags.push(tagValue);
                  } else if (tagName === "relays" && tagValue) {
                    // CRITICAL: Handle both formats per NIP-34 spec:
                    // 1. Separate tags: ["relays", "wss://relay1.com"], ["relays", "wss://relay2.com"]
                    // 2. Comma-separated (backward compat): ["relays", "wss://relay1.com,wss://relay2.com"]
                    // Check if value contains commas (comma-separated format)
                    if (tagValue.includes(",")) {
                      // Comma-separated format - split and add each
                      const relayUrls = tagValue.split(",").map(r => r.trim()).filter(r => r.length > 0);
                      relayUrls.forEach(relayUrl => {
                        // Ensure wss:// prefix
                        const normalized = relayUrl.startsWith("wss://") || relayUrl.startsWith("ws://") 
                          ? relayUrl 
                          : `wss://${relayUrl}`;
                        if (!relaysTags.includes(normalized)) {
                          relaysTags.push(normalized);
                        }
                      });
                    } else {
                      // Single relay per tag - add directly
                      const normalized = tagValue.startsWith("wss://") || tagValue.startsWith("ws://") 
                        ? tagValue 
                        : `wss://${tagValue}`;
                      if (!relaysTags.includes(normalized)) {
                        relaysTags.push(normalized);
                      }
                    }
                  } else if (tagName === "t" && tagValue) {
                    // Topic/tag tags
                    topicTags.push(tagValue);
                  } else if (tagName === "p") {
                    // Extract contributors from "p" tags: ["p", pubkey, weight, role]
                    const pubkey = tagValue;
                    const weight = tag.length > 2 ? parseInt(tag[2] as string) || 0 : 0;
                    const role = tag.length > 3 ? (tag[3] as string) : undefined;
                    
                    // Validate pubkey format (64 hex chars)
                    if (pubkey && /^[0-9a-f]{64}$/i.test(pubkey)) {
                      contributorTags.push({
                        pubkey,
                        weight,
                        role: role || (weight === 100 ? "owner" : weight >= 50 ? "maintainer" : "contributor"),
                      });
                    }
                  }
                }
              }
            }
            
            // GRASP-02: Client-side proactive sync - add relays from repo events to subscription pool
            // This helps discover repos from other relays that repo owners listed
            // CRITICAL: This is how we discover repos from the entire Nostr network, not just configured relays
            // NOTE: Repos are identified by event.pubkey (hex), NOT by NIP-05 identifiers
            // NIP-05 is only for display/URLs - all repos are discoverable regardless of NIP-05
            if (relaysTags.length > 0 && addRelay) {
              console.log('🔍 [GRASP-02] Found relays tags in repo:', {
                repo: repoData.repositoryName,
                owner: event.pubkey.slice(0, 8),
                relaysTags: relaysTags,
                defaultRelaysCount: defaultRelays.length,
                willDiscover: relaysTags.filter(r => r.startsWith("wss://") && !defaultRelays.includes(r)).length
              });
              
              relaysTags.forEach((relayUrl: string) => {
                // Only add valid wss:// relays that aren't already in defaultRelays
                if (relayUrl.startsWith("wss://") && !defaultRelays.includes(relayUrl)) {
                  console.log('🔄 [GRASP-02] Discovering new relay from repo event:', relayUrl);
                  addRelay(relayUrl);
                  // CRITICAL: Subscribe to repos from this newly discovered relay
                  // This is how we get repos from the entire Nostr network
                  setTimeout(() => {
                    if (subscribe) {
                      console.log('📡 [GRASP-02] Querying newly discovered relay:', relayUrl);
                      subscribe(
                        [{ kinds: [KIND_REPOSITORY, KIND_REPOSITORY_NIP34], limit: 10000 }], // Request many repos from new relay
                        [relayUrl],
                        (newEvent, isAfterEose, newRelayURL) => {
                          // CRITICAL: Process and store repos from discovered relay
                          if (newEvent.kind === KIND_REPOSITORY || newEvent.kind === KIND_REPOSITORY_NIP34) {
                            try {
                              let repoData: any;
                              if (newEvent.kind === KIND_REPOSITORY_NIP34) {
                                repoData = parseNIP34Repository(newEvent);
                              } else {
                                // CRITICAL: Validate content is JSON before parsing
                                if (!newEvent.content || typeof newEvent.content !== 'string') {
                                  return;
                                }
                                const trimmedContent = newEvent.content.trim();
                                if (!trimmedContent.startsWith('{') && !trimmedContent.startsWith('[')) {
                                  return;
                                }
                                try {
                                  repoData = JSON.parse(newEvent.content);
                                } catch (parseError) {
                                  return; // Skip this event
                                }
                              }
                              
                              // CRITICAL: Validate repoData has required fields
                              if (!repoData || typeof repoData !== 'object' || !repoData.repositoryName) {
                                return;
                              }
                              
                              const entity = nip19.npubEncode(newEvent.pubkey);
                              
                              // CRITICAL: Validate BEFORE storing - use general corruption check
                              const repoForValidation = {
                                repositoryName: repoData.repositoryName,
                                entity: entity,
                                ownerPubkey: newEvent.pubkey
                              };
                              
                              if (isRepoCorrupted(repoForValidation, newEvent.id)) {
                                // Silently reject - don't spam console for corrupted repos
                                return; // Don't store corrupted repos
                              }
                              
                              const existingRepos = JSON.parse(localStorage.getItem("gittr_repos") || "[]") as Repo[];
                              
                              // Check if deleted
                              const deletedRepos = JSON.parse(localStorage.getItem("gittr_deleted_repos") || "[]");
                              const repoKey = `${entity}/${repoData.repositoryName}`.toLowerCase();
                              const isDeleted = deletedRepos.some((d: any) => 
                                `${d.entity}/${d.repo}`.toLowerCase() === repoKey
                              );
                              
                              if (isDeleted || repoData.deleted || repoData.archived) return;
                              
                              // Check if exists
                              const existingIndex = existingRepos.findIndex((r: any) => 
                                (r.ownerPubkey === newEvent.pubkey && (r.repo === repoData.repositoryName || r.slug === repoData.repositoryName)) ||
                                ((r.entity === entity || r.entity === newEvent.pubkey) && (r.repo === repoData.repositoryName || r.slug === repoData.repositoryName))
                              );
                              
                              const repo: Repo = {
                                slug: repoData.repositoryName,
                                entity: entity,
                                repo: repoData.repositoryName,
                                name: repoData.repositoryName || repoData.name || repoData.repositoryName,
                                description: repoData.description,
                                ownerPubkey: newEvent.pubkey,
                                createdAt: existingRepos[existingIndex]?.createdAt || (newEvent.created_at * 1000),
                                updatedAt: newEvent.created_at * 1000,
                                entityDisplayName: entity,
                                files: repoData.files,
                                topics: repoData.topics || [],
                                contributors: repoData.contributors || [],
                              };
                              
                              if (existingIndex >= 0) {
                                existingRepos[existingIndex] = { ...existingRepos[existingIndex], ...repo };
                              } else {
                                existingRepos.push(repo);
                              }
                              
                              localStorage.setItem("gittr_repos", JSON.stringify(existingRepos));
                              setTimeout(() => loadRepos(), 100);
                              
                              console.log('✅ [GRASP-02] Stored repo from discovered relay:', {
                                relay: newRelayURL,
                                owner: newEvent.pubkey.slice(0, 8),
                                repo: repoData.repositoryName
                              });
                            } catch (error: any) {
                              console.error('[GRASP-02] Error processing repo from discovered relay:', error);
                            }
                          }
                        }
                      );
                    }
                  }, 1000);
                }
              });
            }
            
            // DEBUG: Log ALL repos received (for debugging)
            const isForeignRepo = pubkey && event.pubkey !== pubkey;
            const isOwnRepo = pubkey && event.pubkey === pubkey;
            console.log('📦 [Explore] Repo event received:', {
              relay: relayURL,
              owner: event.pubkey.slice(0, 8),
              repoName: repoData.repositoryName,
              isForeign: isForeignRepo,
              isOwn: isOwnRepo,
              hasFiles: !!(repoData.files && repoData.files.length > 0),
              filesCount: repoData.files?.length || 0,
              cloneTags: cloneTags.length,
              relaysTags: relaysTags.length,
              topicTags: topicTags.length,
              createdAt: new Date(event.created_at * 1000).toISOString(),
              eventId: event.id.slice(0, 8)
            });
            
            // Load existing repos
            const existingRepos = JSON.parse(localStorage.getItem("gittr_repos") || "[]") as Repo[];
            
            // Check if this repo was locally deleted (user deleted it, don't re-add from Nostr)
            const deletedRepos = JSON.parse(localStorage.getItem("gittr_deleted_repos") || "[]") as Array<{entity: string; repo: string; deletedAt: number}>;
            // CRITICAL: Use npub format for entity (GRASP protocol standard)
            const entity = nip19.npubEncode(event.pubkey);
            const repoKey = `${entity}/${repoData.repositoryName}`.toLowerCase();
            const isDeleted = deletedRepos.some(d => {
              // Check by npub entity or by ownerPubkey (handles both formats)
              const dEntityMatch = d.entity.toLowerCase() === entity.toLowerCase();
              // CRITICAL: Check repoData.repositoryName exists before calling toLowerCase()
              if (dEntityMatch && repoData.repositoryName && d.repo.toLowerCase() === repoData.repositoryName.toLowerCase()) return true;
              // Also check if deleted entity is npub for same pubkey
              if (d.entity.startsWith("npub")) {
                try {
                  const dDecoded = nip19.decode(d.entity);
                  if (dDecoded.type === "npub" && (dDecoded.data as string).toLowerCase() === event.pubkey.toLowerCase()) {
                    return repoData.repositoryName && d.repo.toLowerCase() === repoData.repositoryName.toLowerCase();
                  }
                } catch {}
              }
              return false;
            });
            
            // Skip if repo was locally deleted
            if (isDeleted) {
              return;
            }
            
            // CRITICAL: Check if repo owner marked it as deleted/archived on Nostr
            if (repoData.deleted === true || repoData.archived === true) {
              return;
            }
            
            // Normalize repo name for comparison (handle underscores vs hyphens, case-insensitive)
            const normalizeRepoName = (name: string): string => {
              if (!name) return "";
              return name.toLowerCase().replace(/[_-]/g, "");
            };
            const normalizedRepoName = normalizeRepoName(repoData.repositoryName);
            
            // Check if this repo already exists (match by ownerPubkey first, then entity)
            // CRITICAL: Use ownerPubkey as primary key for matching to avoid duplicates
            // CRITICAL: Normalize repo names to handle variations (bitcoin_meetup_calendar vs bitcoin-meetup-calendar)
            const existingIndex = existingRepos.findIndex((r: any) => {
              // Normalize existing repo names for comparison
              const rRepoNormalized = normalizeRepoName(r.repo || r.slug || "");
              const rSlugNormalized = normalizeRepoName(r.slug || "");
              
              // Match by ownerPubkey first (most reliable - works across all entity formats)
              if (r.ownerPubkey && r.ownerPubkey.toLowerCase() === event.pubkey.toLowerCase()) {
                return rRepoNormalized === normalizedRepoName || rSlugNormalized === normalizedRepoName;
              }
              // Match by entity (npub format or full pubkey)
              if (r.entity === entity || r.entity === event.pubkey) {
                return rRepoNormalized === normalizedRepoName || rSlugNormalized === normalizedRepoName;
              }
              // Also check if existing entity is npub for same pubkey
              if (r.entity && r.entity.startsWith("npub")) {
                try {
                  const rDecoded = nip19.decode(r.entity);
                  if (rDecoded.type === "npub" && (rDecoded.data as string).toLowerCase() === event.pubkey.toLowerCase()) {
                    return rRepoNormalized === normalizedRepoName || rSlugNormalized === normalizedRepoName;
                  }
                } catch {}
              }
              return false;
            });
            
            // entityDisplayName will be set from metadata later, use npub as fallback
            const entityDisplayName = entity;
            const existingRepo = existingIndex >= 0 ? existingRepos[existingIndex] : undefined;
            
            // CRITICAL: Extract contributors from "p" tags first (most reliable source)
            // Then merge with contributors from JSON content, then with existing repo contributors
            let contributors: Array<{pubkey?: string; name?: string; picture?: string; weight: number; role?: string; githubLogin?: string}> = [];
            
            // Priority 1: Contributors from "p" tags (published by owner, most reliable)
            if (contributorTags.length > 0) {
              contributors = contributorTags.map(c => ({
                pubkey: c.pubkey,
                weight: c.weight,
                role: c.role as "owner" | "maintainer" | "contributor" | undefined,
              }));
              console.log(`📋 [Explore] Extracted ${contributors.length} contributors from "p" tags`);
            }
            
            // Priority 2: Merge with contributors from JSON content (if any)
            if (repoData.contributors && Array.isArray(repoData.contributors) && repoData.contributors.length > 0) {
              // Merge: add contributors from content that aren't already in tags
              for (const contentContributor of repoData.contributors) {
                const exists = contributors.some(c => 
                  c.pubkey && contentContributor.pubkey && 
                  c.pubkey.toLowerCase() === contentContributor.pubkey.toLowerCase()
                );
                if (!exists) {
                  contributors.push(contentContributor);
                }
              }
              console.log(`📋 [Explore] Merged ${repoData.contributors.length} contributors from JSON content`);
            }
            
            // Priority 3: Merge with existing repo contributors (preserve local metadata like names/pictures)
            if (existingRepo?.contributors && Array.isArray(existingRepo.contributors) && existingRepo.contributors.length > 0) {
              for (const existingContributor of existingRepo.contributors) {
                const existingIndex = contributors.findIndex(c => 
                  c.pubkey && existingContributor.pubkey && 
                  c.pubkey.toLowerCase() === existingContributor.pubkey.toLowerCase()
                );
                if (existingIndex >= 0) {
                  // Merge: keep pubkey/weight/role from tags/content, but preserve name/picture from existing
                  contributors[existingIndex] = {
                    ...contributors[existingIndex],
                    name: existingContributor.name || contributors[existingIndex]?.name,
                    picture: existingContributor.picture || contributors[existingIndex]?.picture,
                    githubLogin: existingContributor.githubLogin || contributors[existingIndex]?.githubLogin,
                    weight: contributors[existingIndex]?.weight ?? existingContributor.weight ?? 0, // Ensure weight is always a number
                  };
                } else {
                  // Add contributor that exists locally but not in event
                  // Ensure weight is always a number
                  contributors.push({
                    ...existingContributor,
                    weight: existingContributor.weight ?? 0,
                  });
                }
              }
            }
            
            // CRITICAL: Always ensure owner (event.pubkey) is in contributors with weight 100 and role owner
            const ownerInContributors = contributors.some((c: any) => c.pubkey && c.pubkey.toLowerCase() === event.pubkey.toLowerCase());
            if (!ownerInContributors) {
              contributors = [{ pubkey: event.pubkey, weight: 100, role: "owner" }, ...contributors];
            } else {
              // Ensure owner has weight 100 and role owner (override any other values)
              contributors = contributors.map((c: any) => 
                c.pubkey && c.pubkey.toLowerCase() === event.pubkey.toLowerCase()
                  ? { ...c, weight: 100, role: "owner" }
                  : c
              );
            }
            
            console.log(`✅ [Explore] Final contributors list: ${contributors.length} total`, {
              owners: contributors.filter(c => c.weight === 100 || c.role === "owner").length,
              maintainers: contributors.filter(c => c.role === "maintainer" || (c.weight >= 50 && c.weight < 100)).length,
              contributors: contributors.filter(c => c.role === "contributor" || (c.weight > 0 && c.weight < 50)).length,
            });
            
            // CRITICAL: Validate BEFORE creating repo object - use general corruption check
            const repoForValidation = {
              repositoryName: repoData.repositoryName,
              entity: entity,
              ownerPubkey: event.pubkey
            };
            
            if (isRepoCorrupted(repoForValidation, event.id)) {
              // Silently reject - don't spam console for corrupted repos
              return; // Don't store corrupted repos
            }
            
            const repo: Repo = {
              slug: repoData.repositoryName,
              entity: entity, // CRITICAL: Use npub format (GRASP protocol standard)
              repo: repoData.repositoryName,
              // CRITICAL: Use human-readable name from event content if available, otherwise use repositoryName
              name: repoData.name || repoData.repositoryName,
              description: repoData.description,
              sourceUrl: repoData.sourceUrl || existingRepo?.sourceUrl,
              forkedFrom: repoData.forkedFrom || existingRepo?.forkedFrom,
              readme: repoData.readme || existingRepo?.readme,
              // CRITICAL: Only use files from event if they exist and are an array with items
              // Don't overwrite existing files with empty array from event
              files: (repoData.files && Array.isArray(repoData.files) && repoData.files.length > 0) 
                ? repoData.files 
                : (existingRepo?.files && Array.isArray(existingRepo.files) && existingRepo.files.length > 0)
                ? existingRepo.files
                : undefined,
              stars: repoData.stars !== undefined ? repoData.stars : existingRepo?.stars,
              forks: repoData.forks !== undefined ? repoData.forks : existingRepo?.forks,
              languages: repoData.languages || existingRepo?.languages,
              // GRASP-01: Use topics from event.tags (t tags), fallback to content
              topics: topicTags.length > 0 ? topicTags : (repoData.topics || existingRepo?.topics || []),
              contributors: contributors,
              defaultBranch: repoData.defaultBranch || existingRepo?.defaultBranch,
              branches: repoData.branches || existingRepo?.branches,
              releases: repoData.releases || existingRepo?.releases,
              logoUrl: existingRepo?.logoUrl,
              createdAt: existingRepo?.createdAt || (event.created_at * 1000), // Keep in milliseconds for compatibility
              updatedAt: event.created_at * 1000, // Track when repo was last updated from Nostr (in milliseconds)
              entityDisplayName: entityDisplayName,
              ownerPubkey: event.pubkey, // CRITICAL: Always store full pubkey
              deleted: repoData.deleted || false,
              archived: repoData.archived || false,
              links: repoData.links || existingRepo?.links,
              // GRASP-01: Store clone and relays tags from event.tags (for future GRASP-02 sync)
              // Note: These are stored in repo object but not currently used for sync (server-side feature)
              // CRITICAL: Filter out localhost URLs - they're not real git servers
              clone: cloneTags.length > 0 
                ? cloneTags.filter((url: string) => url && !url.includes('localhost') && !url.includes('127.0.0.1'))
                : (repoData.clone || existingRepo?.clone || []).filter((url: string) => url && !url.includes('localhost') && !url.includes('127.0.0.1')),
              relays: relaysTags.length > 0 ? relaysTags : (repoData.relays || existingRepo?.relays),
            };
            
            // CRITICAL: Ensure entity is always set (required for filtering)
            // If somehow entity is missing, derive from ownerPubkey as npub
            if (!repo.entity || repo.entity === "user") {
              if (repo.ownerPubkey && /^[0-9a-f]{64}$/i.test(repo.ownerPubkey)) {
                repo.entity = nip19.npubEncode(repo.ownerPubkey);
                repo.entityDisplayName = repo.entityDisplayName || repo.entity;
              } else {
                console.error('⚠️ [Explore] Cannot store repo without entity or ownerPubkey:', {
                  repo: repoData.repositoryName,
                  hasEntity: !!repo.entity,
                  hasOwnerPubkey: !!repo.ownerPubkey
                });
                return; // Skip storing repos without entity/ownerPubkey
              }
            }
            
            console.log('💾 [Explore] Storing repo:', {
              entity,
              repo: repoData.repositoryName,
              ownerPubkey: event.pubkey.slice(0, 8),
              isNew: existingIndex < 0,
              hasEntity: !!entity,
              hasOwnerPubkey: !!event.pubkey,
              eventId: event.id.slice(0, 16),
              createdAt: new Date(event.created_at * 1000).toISOString(),
              relay: relayURL,
              // Log if this is a duplicate
              isDuplicate: existingIndex >= 0,
              existingEntity: existingIndex >= 0 ? existingRepos[existingIndex]?.entity : undefined,
              existingUpdatedAt: existingIndex >= 0 ? existingRepos[existingIndex]?.updatedAt : undefined,
            });
            
            if (existingIndex >= 0) {
              // CRITICAL: For NIP-34 replaceable events, only update if this event is newer
              // Check if existing repo has a newer event already stored
              // NIP-34 uses Unix timestamps in SECONDS - compare in seconds
              const existingEventCreatedAtSeconds = existingRepo?.lastNostrEventCreatedAt || 
                (existingRepo?.updatedAt ? Math.floor(existingRepo.updatedAt / 1000) : 0);
              const newEventCreatedAtSeconds = event.created_at; // Already in seconds (Nostr format)
              
              if (event.kind === KIND_REPOSITORY_NIP34 && newEventCreatedAtSeconds <= existingEventCreatedAtSeconds) {
                console.log(`⏭️ [Explore] Skipping older NIP-34 event: existing=${new Date(existingEventCreatedAtSeconds * 1000).toISOString()}, new=${new Date(newEventCreatedAtSeconds * 1000).toISOString()}`);
                return; // Skip older events
              }
              
              // CRITICAL: Replace with newer version from Nostr (no merging for proper versioning)
              // Only preserve user-set logoUrl (not from Nostr events)
              const updatedRepo = {
                ...repo, // Use newest Nostr version as base
                // Preserve local logoUrl ONLY if it was user-set (not from Nostr)
                logoUrl: existingRepo?.logoUrl && !existingRepo?.logoUrl?.startsWith('http') ? existingRepo.logoUrl : repo.logoUrl,
                // Preserve local unpushed edits flag (local state)
                hasUnpushedEdits: existingRepo?.hasUnpushedEdits || false,
                // Use newest event ID and created_at
                // CRITICAL: Store in SECONDS (Nostr format) - not milliseconds
                nostrEventId: event.id,
                lastNostrEventId: event.id,
                lastNostrEventCreatedAt: event.created_at, // Store in seconds (NIP-34 format)
                // Keep original createdAt (when repo was first created)
                createdAt: existingRepo?.createdAt || repo.createdAt,
                // Extract earliest unique commit from "r" tag if present (may not be in Repo type but exists at runtime)
                ...(repoData.earliestUniqueCommit || (existingRepo as any)?.earliestUniqueCommit ? { earliestUniqueCommit: repoData.earliestUniqueCommit || (existingRepo as any)?.earliestUniqueCommit } : {}),
              };
              existingRepos[existingIndex] = updatedRepo;
              console.log('🔄 [Explore] Updated existing repo with newer Nostr version:', {
                repo: repoData.repositoryName,
                oldUpdatedAt: existingRepo?.updatedAt ? new Date(existingRepo.updatedAt).toISOString() : 'unknown',
                newUpdatedAt: repo.updatedAt ? new Date(repo.updatedAt).toISOString() : 'unknown',
                eventId: event.id.slice(0, 16),
                eventCreatedAt: new Date(event.created_at * 1000).toISOString(),
              });
            } else {
              // New repo - store with event ID and created_at
              // CRITICAL: Store in SECONDS (Nostr format) - not milliseconds
              const newRepo = {
                ...repo,
                nostrEventId: event.id,
                lastNostrEventId: event.id,
                lastNostrEventCreatedAt: event.created_at, // Store in seconds (NIP-34 format)
                earliestUniqueCommit: repoData.earliestUniqueCommit,
              };
              existingRepos.push(newRepo);
            }
            
            localStorage.setItem("gittr_repos", JSON.stringify(existingRepos));
            
            // CRITICAL: Trigger loadRepos to update UI immediately
            // Use setTimeout to batch updates and prevent infinite loops
            setTimeout(() => {
              loadRepos();
            }, 100);
          } catch (error: any) {
            console.error("Error processing repo event:", error);
          }
        }
      },
      undefined,
      (events, relayURL) => {
        // CRITICAL: After EOSE, process the latest NIP-34 event for each repo
        // This ensures we use the most recent version of replaceable events
        if (nip34EventsByRepo.size > 0) {
          console.log(`📡 [Explore] EOSE from ${relayURL} - processing latest NIP-34 events for ${nip34EventsByRepo.size} repos`);
          
          nip34EventsByRepo.forEach((eventList, repoKey) => {
            if (eventList.length > 1) {
              // Sort by created_at descending (latest first)
              eventList.sort((a, b) => (b.event.created_at || 0) - (a.event.created_at || 0));
              const latestEvent = eventList[0];
              if (latestEvent && latestEvent.event) {
                console.log(`✅ [Explore] Found ${eventList.length} NIP-34 events for ${repoKey} - using latest: id=${latestEvent.event.id.slice(0, 8)}..., created_at=${latestEvent.event.created_at} (${new Date(latestEvent.event.created_at * 1000).toISOString()})`);
              }
              
              // Re-process the latest event to ensure it's stored
              // The event callback above already processed it, but we want to make sure we're using the latest
              // This is handled by checking created_at when storing, but we log it here for debugging
            }
          });
          
          // Clear the map after processing (events are already stored)
          nip34EventsByRepo.clear();
        }
        
        // Original EOSE handler
        // EOSE - end of stored events
        const relayName = typeof relayURL === 'string' ? relayURL : (relayURL === Infinity ? 'multiple' : String(relayURL));
        console.log('✅ [Explore] EOSE from relay:', relayName, 'events:', events?.length || 0);
        
        // Track this relay's EOSE
        if (typeof relayURL === 'string') {
          eoseReceived.add(relayURL);
          // Track GRASP relays separately
          if (graspRelays.includes(relayURL)) {
            graspRelaysReceived.add(relayURL);
            console.log('🎯 [Explore] GRASP relay responded:', relayURL);
          }
        } else if (relayURL === Infinity) {
          // Multiple relays sent EOSE - mark all as received
          defaultRelays.forEach(r => {
            eoseReceived.add(r);
            if (graspRelays.includes(r)) {
              graspRelaysReceived.add(r);
            }
          });
        }
        
        // Log summary after EOSE
        const allRepos = JSON.parse(localStorage.getItem("gittr_repos") || "[]");
        const foreignRepos = pubkey ? allRepos.filter((r: any) => r.ownerPubkey && r.ownerPubkey !== pubkey) : allRepos;
        const ownRepos = pubkey ? allRepos.filter((r: any) => r.ownerPubkey === pubkey) : [];
        
        console.log('📊 [Explore] Summary after EOSE:', {
          relay: relayName,
          totalRepos: allRepos.length,
          foreignRepos: foreignRepos.length,
          ownRepos: ownRepos.length,
          currentUserPubkey: pubkey ? pubkey.slice(0, 8) : 'none',
          eventsReceived: events?.length || 0,
          fromNostr: foreignRepos.length > 0 ? '✅' : '❌',
          eoseCount: eoseReceived.size,
          graspRelaysReceived: graspRelaysReceived.size,
          // Show sample of foreign repos
          sampleForeignRepos: foreignRepos.slice(0, 3).map((r: any) => ({
            owner: r.ownerPubkey?.slice(0, 8),
            repo: r.repo || r.slug || r.name
          }))
        });
        
        // Check if we should stop syncing
        checkShouldStopSyncing();
      }
    );
    
    return () => {
      if (unsub) unsub();
      if (eoseTimeout) clearTimeout(eoseTimeout);
      if (minRelaysTimeout) clearTimeout(minRelaysTimeout);
    };
  }, [subscribe, defaultRelays, pubkey]); // REMOVED loadRepos from deps to prevent infinite loop
  
  const sorted = useMemo(() => {
    // CRITICAL: Ensure all repos have entity BEFORE sorting
    // Derive entity from ownerPubkey if missing
    const reposWithEntity = repos.map(r => {
      if (!r.entity || r.entity === "user") {
        if (r.ownerPubkey && /^[0-9a-f]{64}$/i.test(r.ownerPubkey)) {
          const derivedEntity = nip19.npubEncode(r.ownerPubkey);
          return {
            ...r,
            entity: derivedEntity,
            entityDisplayName: r.entityDisplayName || derivedEntity
          };
        }
      }
      return r;
    });
    
    // CRITICAL: Sort by latest event date (lastNostrEventCreatedAt) if available, otherwise by createdAt
    // This ensures repos with recent updates appear first
    // Note: lastNostrEventCreatedAt is in SECONDS (NIP-34 format), createdAt/updatedAt are in MILLISECONDS
    return reposWithEntity.slice().sort((a, b) => {
      // Get latest event date in milliseconds for comparison
      const aLatest = (a as any).lastNostrEventCreatedAt 
        ? (a as any).lastNostrEventCreatedAt * 1000 // Convert seconds to milliseconds
        : (a.updatedAt || a.createdAt || 0);
      const bLatest = (b as any).lastNostrEventCreatedAt 
        ? (b as any).lastNostrEventCreatedAt * 1000 // Convert seconds to milliseconds
        : (b.updatedAt || b.createdAt || 0);
      return bLatest - aLatest; // Newest first
    });
  }, [repos]);
  
  const filteredRepos = useMemo(() => {
    // Load list of locally-deleted repos (user deleted them, don't show)
    if (typeof window === 'undefined') return repos;
    const deletedRepos = JSON.parse(localStorage.getItem("gittr_deleted_repos") || "[]") as Array<{entity: string; repo: string; deletedAt: number}>;
    
    // Helper function to check if repo is deleted (robust matching)
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
    
    const result = sorted
      .filter(r => {
        // CRITICAL: Exclude repos with "gittr.space" entity FIRST (corrupted repos)
        if (r.entity === "gittr.space") {
          console.log("❌ [Explore] Filtering out corrupted repo with entity 'gittr.space':", {
            repo: r.slug || r.repo,
            ownerPubkey: r.ownerPubkey?.slice(0, 16)
          });
          return false; // Always exclude - these are corrupted
        }
        
        // CRITICAL: Entity must be npub format (starts with "npub")
        // Domain names are NOT valid entities
        if (r.entity && !r.entity.startsWith("npub")) {
          console.log("❌ [Explore] Filtering out repo with invalid entity format (not npub):", {
            repo: r.slug || r.repo,
            entity: r.entity,
            ownerPubkey: r.ownerPubkey?.slice(0, 16)
          });
          return false; // Only npub format is valid
        }
        
        // CRITICAL: Filter out deleted repos FIRST (before other checks)
        // Skip if locally deleted (completely hidden from explore - no note shown)
        if (isRepoDeleted(r)) return false;
        
        // Skip if owner marked as deleted/archived on Nostr (completely hidden from explore - no note shown)
        if (r.deleted === true || r.archived === true) return false;
        
        // Filter out private repos (unless user is the owner)
        if (r.publicRead === false) {
          // Check if current user is the owner
          const repoOwnerPubkey = r.ownerPubkey || (r.entity && r.entity.startsWith("npub") ? (() => {
            try {
              const decoded = nip19.decode(r.entity);
              return decoded.type === "npub" ? decoded.data as string : null;
            } catch {
              return null;
            }
          })() : null);
          const isOwner = pubkey && repoOwnerPubkey && pubkey.toLowerCase() === repoOwnerPubkey.toLowerCase();
          if (!isOwner) {
            return false; // Hide private repos from non-owners
          }
        }
        
        // NOTE: Don't filter out repos without files - they may be newly created or files may load later
        // Repos from Nostr may not have files in the initial event, but they're still valid repos
        
        // CRITICAL: Ensure entity is set - derive from ownerPubkey if missing
        // This handles repos from Nostr that might not have entity set initially
        // DON'T MUTATE - just check if entity is valid
        if (!r.entity || r.entity === "user") {
          if (r.ownerPubkey && /^[0-9a-f]{64}$/i.test(r.ownerPubkey)) {
            // Entity should have been derived in sorted useMemo - if not, skip this repo
            // (it will be fixed on next repos update, but we shouldn't mutate here)
            const derivedEntity = nip19.npubEncode(r.ownerPubkey);
            console.log('🔧 [Explore] Repo missing entity (should be fixed in sorted):', {
              repo: r.slug || r.repo,
              derivedEntity: derivedEntity.slice(0, 12) + "...",
              ownerPubkey: r.ownerPubkey.slice(0, 8)
            });
            // Still allow it through - sorted should have fixed it
          } else {
            // No ownerPubkey - can't display this repo
            console.warn('⚠️ [Explore] Filtered out repo (no entity, no ownerPubkey):', {
              slug: r.slug,
              repo: r.repo,
              name: r.name,
              hasOwnerPubkey: !!r.ownerPubkey,
              entity: r.entity
            });
            return false;
          }
        }
        
        // Filter out test/profile repos (common noise)
        const repoName = (r.repo || r.slug || r.name || "").toLowerCase();
        const isTestRepo = repoName.startsWith("test") || repoName.includes("test-") || repoName === "test";
        const isProfileRepo = repoName === "profile" || repoName === "profile-page" || repoName.includes("profile-");
        if (isTestRepo || isProfileRepo) {
          return false; // Filter out test/profile repos
        }
        
        // Filter by user/entity if user param provided
        if (userFilter) {
          const entity = r.entity || "";
          const entityDisplayName = r.entityDisplayName || "";
          const matches = (
            entity.toLowerCase().includes(userFilter.toLowerCase()) ||
            entityDisplayName.toLowerCase().includes(userFilter.toLowerCase()) ||
            (userFilter.length >= 4 && entity.toLowerCase().startsWith(userFilter.toLowerCase()))
          );
          if (!matches) {
            console.log('🔍 [Explore] Filtered out repo (user filter):', r.slug || r.repo || r.name);
          }
          return matches;
        }
        
        // Filter by search query - search in multiple fields
        if (q) {
          const entity = r.entity || "";
          const repo = r.repo || r.slug || "";
          const name = r.name || repo;
          const description = (r.description || "").toLowerCase();
          const topics = (r.topics || []).map((t: string) => t.toLowerCase()).join(" ");
          
          // Get owner name from metadata if available
          const ownerPubkey = getRepoOwnerPubkey(r as any, entity);
          let ownerName = "";
          if (ownerPubkey) {
            const normalizedPubkey = ownerPubkey.toLowerCase();
            const meta = ownerMetadata[normalizedPubkey] || ownerMetadata[ownerPubkey];
            if (meta) {
              ownerName = (meta.name || meta.display_name || "").toLowerCase();
            }
          }
          // Fallback to entityDisplayName if metadata not available
          if (!ownerName && r.entityDisplayName) {
            ownerName = r.entityDisplayName.toLowerCase();
          }
          
          // Search in: repo name, description, topics, entity/repo path, and owner name
          const matches = (
            `${entity}/${repo}`.toLowerCase().includes(q) ||
            name.toLowerCase().includes(q) ||
            description.includes(q) ||
            topics.includes(q) ||
            ownerName.includes(q)
          );
          if (!matches) {
            console.log('🔍 [Explore] Filtered out repo (search filter):', r.slug || r.repo || r.name);
          }
          return matches;
        }
        
        return true;
      });
    
    // Log filtering results for debugging - show foreign vs own repos
    const removed = sorted.length - result.length;
    const foreignRepos = pubkey ? result.filter(r => r.ownerPubkey && r.ownerPubkey !== pubkey).length : result.length;
    const ownRepos = pubkey ? result.filter(r => r.ownerPubkey === pubkey).length : 0;
    
    if (removed > 0 || result.length > 0) {
      console.log('📊 [Explore] Filtered repos:', {
        total: sorted.length,
        filtered: result.length,
        removed: removed,
        foreignRepos: foreignRepos,
        ownRepos: ownRepos,
        fromNostr: foreignRepos > 0 ? '✅' : '❌'
      });
    }
    
    // CRITICAL: Deduplicate repos by ownerPubkey + normalized repo name
    // This ensures we only show one instance of each repo even if stored multiple times
    const normalizeRepoName = (name: string): string => {
      if (!name) return "";
      return name.toLowerCase().replace(/[_-]/g, "");
    };
    
    const dedupeMap = new Map<string, any>();
    const deduplicated: any[] = [];
    
    result.forEach((r: any) => {
      // Create unique key: ownerPubkey + normalized repo name
      const ownerKey = r.ownerPubkey ? r.ownerPubkey.toLowerCase() : (r.entity || "").toLowerCase();
      const repoNormalized = normalizeRepoName(r.repo || r.slug || r.name || "");
      const uniqueKey = `${ownerKey}/${repoNormalized}`;
      
      const existing = dedupeMap.get(uniqueKey);
      if (!existing) {
        dedupeMap.set(uniqueKey, r);
        deduplicated.push(r);
      } else {
        // If duplicate found, keep the MOST RECENT one from Nostr (by updatedAt)
        // CRITICAL: No merging - just pick the newest version for proper versioning
        const existingUpdatedAt = existing.updatedAt || existing.createdAt || 0;
        const rUpdatedAt = r.updatedAt || r.createdAt || 0;
        
        if (rUpdatedAt > existingUpdatedAt) {
          // Replace with newer version
          const index = deduplicated.indexOf(existing);
          if (index >= 0) {
            console.log(`🔄 [Explore] Replacing duplicate repo with newer version:`, {
              repo: r.repo || r.slug,
              owner: r.ownerPubkey?.slice(0, 8),
              existingUpdatedAt: new Date(existingUpdatedAt).toISOString(),
              newUpdatedAt: new Date(rUpdatedAt).toISOString(),
              existingEntity: existing.entity,
              newEntity: r.entity,
            });
            deduplicated[index] = r;
            dedupeMap.set(uniqueKey, r);
          }
        } else {
          // Keep existing (it's newer or same)
          console.log(`⏭️ [Explore] Keeping existing duplicate (newer or same):`, {
            repo: r.repo || r.slug,
            owner: r.ownerPubkey?.slice(0, 8),
            existingUpdatedAt: new Date(existingUpdatedAt).toISOString(),
            newUpdatedAt: new Date(rUpdatedAt).toISOString(),
          });
        }
      }
    });
    
    if (deduplicated.length < result.length) {
      console.log(`🔍 [Explore] Deduplicated repos: ${result.length} -> ${deduplicated.length} (removed ${result.length - deduplicated.length} duplicates)`);
    }
    
    return deduplicated;
  }, [sorted, q, userFilter, pubkey, ownerMetadata]); // Include ownerMetadata so filteredRepos updates when metadata loads
  
  // Render repo cards directly (like homepage) - React will handle updates efficiently
  // Don't use useMemo here as it can cause issues with constant re-renders blocking clicks
  
  return (
    <div className="container mx-auto max-w-[95%] xl:max-w-[90%] 2xl:max-w-[85%] p-6">
      <h1 className="text-2xl font-bold mb-4">
        {userFilter ? `Repositories by ${userFilter}` : "Explore"}
      </h1>
      {userFilter && (
        <p className="text-gray-400 mb-4">
          Showing public repositories for this user
        </p>
      )}
      {/* Debug panel - shows repo counts and allows cache clearing */}
      <div className="mb-4 p-3 border border-[#383B42] rounded bg-[#22262C] text-xs text-gray-400">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-2">
          <div>Total repos: <span className="text-white font-bold">{repos.length}</span></div>
          <div>Filtered: <span className="text-white font-bold">{filteredRepos.length}</span></div>
          <div>Foreign: <span className="text-white font-bold">{pubkey ? filteredRepos.filter(r => r.ownerPubkey && r.ownerPubkey !== pubkey).length : filteredRepos.length}</span></div>
          <div>Syncing: <span className={syncing ? "text-yellow-400" : "text-green-400"}>{syncing ? "Yes" : "No"}</span></div>
        </div>
        <button 
          onClick={() => {
            if (confirm('Clear localStorage cache and reload? This will force a fresh fetch from Nostr relays.')) {
              localStorage.removeItem('gittr_repos');
              window.location.reload();
            }
          }}
          className="px-3 py-1 bg-[#22262C] hover:bg-[#383B42] border border-[#383B42] text-white rounded text-xs"
        >
          Clear Cache & Reload
        </button>
      </div>
      {/* Loading indicator */}
      {(isLoadingRepos || isLoadingMetadata) && (
        <div className="mb-4 p-4 border border-[#383B42] rounded bg-[#171B21]">
          <div className="flex items-center gap-2 text-gray-400">
            <div className="animate-spin h-4 w-4 border-2 border-purple-500 border-t-transparent rounded-full theme-border" />
            <span className="text-sm">
              {isLoadingRepos ? "Loading repositories..." : "Loading repository icons..."}
            </span>
          </div>
        </div>
      )}
      {syncing && !isLoadingRepos && typeof window !== 'undefined' && (() => {
        const repos = JSON.parse(localStorage.getItem("gittr_repos") || "[]");
        const repoCount = repos.length;
        return (
        <div className="mb-4 p-4 border border-purple-500/50 rounded bg-[#171B21]">
          <div className="flex items-center gap-2 text-purple-400">
            <div className="animate-spin h-4 w-4 border-2 border-purple-500 border-t-transparent rounded-full theme-border" />
            <span className="text-sm">
                🔄 Syncing from Nostr relays... ({repoCount.toLocaleString()} repos found so far, {defaultRelays?.length || 0} relays)
            </span>
          </div>
          <div className="text-xs text-gray-500 mt-2">
            Repos are being added as they're discovered. The "syncing" indicator will hide when enough relays respond or after 15 seconds, but the subscription continues to listen for new repos in real-time.
          </div>
        </div>
        );
      })()}
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
        {!isLoadingRepos && filteredRepos
          .filter(r => {
            // Pre-filter repos with invalid data to prevent warnings and render loops
            // CRITICAL: Check for null/undefined before accessing properties
            if (!r || !r.entity) {
              return false;
            }
            
            const entity = r.entity;
            const repo = r.repo || (r.slug && typeof r.slug === 'string' && r.slug.includes('/') ? r.slug.split('/')[1] : (r.slug || ''));
            const ownerPubkey = getRepoOwnerPubkey(r as any, entity);
            
            // Skip repos with missing critical data (silently, no warnings)
            if (!ownerPubkey || !repo || !entity) {
              return false;
            }
            
            const cleanRepo = String(repo).trim();
            if (!cleanRepo) {
              return false;
            }
            
            return true;
          })
          .map(r => {
            // Use entity/repo structure if available, otherwise parse from slug
            const entity = r.entity!;
            // CRITICAL: For URLs, use slugified version (repo/slug/repositoryName)
            // For display, use original name (r.name)
            const repoForUrl = r.repo || r.slug || (r.slug && typeof r.slug === 'string' && r.slug.includes('/') ? r.slug.split('/')[1] : (r.slug || ''));
            const repoDisplayName = r.name || repoForUrl; // CRITICAL: Use original name for display
            
            // CRITICAL: Resolve full owner pubkey and get display name from metadata
            const ownerPubkey = getRepoOwnerPubkey(r as any, entity);
            
          // CRITICAL: Use npub format for URL (GRASP protocol standard)
          // Convert ownerPubkey to npub format for consistent URLs
            let href: string;
          if (!ownerPubkey) {
            // This should never happen due to pre-filter, but TypeScript needs this check
            return null;
          }
              try {
              // Convert full pubkey to npub format
                const npub = nip19.npubEncode(ownerPubkey);
              const cleanRepo = String(repoForUrl).trim();
              if (!cleanRepo) {
                // This should never happen due to pre-filter, but TypeScript needs this check
                return null;
              }
              // CRITICAL: URL-encode repo name to handle spaces and special characters
              // e.g., "Swarm Relay" -> "Swarm%20Relay"
              href = `/${npub}/${encodeURIComponent(cleanRepo)}`;
            } catch (error) {
              console.error('⚠️ [Explore] Failed to encode npub:', { ownerPubkey, error });
              // Fallback to entity format if npub encoding fails
              const cleanEntity = String(entity).trim();
              const cleanRepo = String(repoForUrl).trim();
              if (!cleanEntity || !cleanRepo) {
                return null;
              }
              // CRITICAL: URL-encode repo name to handle spaces and special characters
              href = `/${cleanEntity}/${encodeURIComponent(cleanRepo)}`;
            }
            
          // CRITICAL: Use ownerMetadata directly (not ref) so React re-renders when metadata loads
          // React will handle re-renders efficiently - we want updates when metadata arrives!
          // CRITICAL: Always use getEntityDisplayName to show username, not shortened pubkey
          // CRITICAL: Normalize pubkey to lowercase for metadata lookup
          const normalizedOwnerPubkey = ownerPubkey && /^[0-9a-f]{64}$/i.test(ownerPubkey)
            ? ownerPubkey.toLowerCase()
            : null;
          const entityDisplayName = normalizedOwnerPubkey
              ? getEntityDisplayName(normalizedOwnerPubkey, ownerMetadata, entity)
            : (r.entityDisplayName || entity);
            
          // Resolve icons - always show fallback if icon fails (matches homepage pattern)
          let iconUrl: string | null = null;
          let ownerPicture: string | undefined = undefined;
          try {
            iconUrl = resolveRepoIcon(r);
            if (normalizedOwnerPubkey) {
              // CRITICAL: Use normalized pubkey for metadata lookup
              ownerPicture = ownerMetadata[normalizedOwnerPubkey]?.picture || ownerMetadata[ownerPubkey]?.picture;
            }
          } catch (error) {
            console.error('⚠️ [Explore] Error resolving icons:', error);
          }
            
          // CRITICAL: Use unique key that matches deduplication logic
          // Normalize repo name to match deduplication (handles underscores vs hyphens, case-insensitive)
          const normalizeRepoName = (name: string): string => {
            if (!name) return "";
            return name.toLowerCase().replace(/[_-]/g, "");
          };
          const ownerKey = r.ownerPubkey ? r.ownerPubkey.toLowerCase() : (r.entity || "").toLowerCase();
          const repoNormalized = normalizeRepoName(r.repo || r.slug || r.name || "");
          const uniqueKey = `${ownerKey}/${repoNormalized}`;
            
          // Skip rendering if href is invalid
          if (!href || href === '#') {
            return null;
          }
            
            return (
              <a 
                key={uniqueKey} 
                href={href} 
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  // Use window.location for navigation since Next.js Link isn't working
                  window.location.href = href;
                }}
              className="border p-4 hover:bg-white/5 transition-colors block cursor-pointer rounded"
              >
                <div className="flex items-center gap-3">
                {/* Unified repo icon (circle): repo pic -> owner profile pic -> nostr default -> logo.svg */}
                <div className="flex-shrink-0">
                  <div className="relative h-6 w-6 rounded-full overflow-hidden">
                    {/* Priority 1: Repo icon */}
                    {iconUrl && (
                    <img 
                      src={iconUrl} 
                      alt="repo" 
                        className="h-6 w-6 rounded-full object-cover absolute inset-0"
                      loading="lazy"
                      onError={(e) => {
                          e.currentTarget.style.display = 'none';
                        }}
                      />
                    )}
                    {/* Priority 2: Owner profile picture */}
                    {!iconUrl && ownerPicture && (
                      <img 
                        src={ownerPicture} 
                        alt={entityDisplayName}
                        className="h-6 w-6 rounded-full object-cover absolute inset-0"
                        loading="lazy"
                        onError={(e) => {
                          e.currentTarget.style.display = 'none';
                        }}
                      />
                    )}
                    {/* Priority 3: Nostr default / logo.svg fallback */}
                    {!iconUrl && !ownerPicture && (
                      <img 
                        src="/logo.svg" 
                        alt="repo" 
                        className="h-6 w-6 rounded-full object-contain absolute inset-0"
                        loading="lazy"
                        onError={(e) => {
                          e.currentTarget.style.display = 'none';
                        }}
                      />
                    )}
                    {/* Final fallback: gray circle */}
                    <span className="inline-block h-6 w-6 rounded-full bg-[#22262C]" />
                  </div>
                </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xl font-semibold truncate">{repoDisplayName}</div>
                  <div className="opacity-70 truncate">
                    {entityDisplayName}/{repoDisplayName}
                  </div>
                  {r.description && (
                    <div className="text-sm opacity-60 mt-1 truncate">{r.description}</div>
                  )}
                    {r.sourceUrl && (
                      <div className="text-sm opacity-70 mt-1 break-words overflow-hidden">
                        <span className="break-all line-clamp-2">Imported from {r.sourceUrl}</span>
                      </div>
                    )}
                  </div>
                </div>
              </a>
            );
        }).filter(Boolean)}
        {!isLoadingRepos && filteredRepos.length === 0 && (
          <div className="col-span-2 p-8 text-center text-gray-400">
            {userFilter ? (
              <p>No public repositories found for this user.</p>
            ) : q ? (
              <p>No repositories found matching "{q}".</p>
            ) : (
              <p>No repositories yet.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Mark as dynamic to prevent static generation (useSearchParams requires dynamic rendering)
export const dynamic = 'force-dynamic';

export default function ExplorePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-black text-white p-8">Loading...</div>}>
      <ExplorePageContent />
    </Suspense>
  );
}

