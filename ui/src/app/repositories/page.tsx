"use client";

// Force dynamic rendering - this page uses localStorage which is not available during static generation
export const dynamic = 'force-dynamic';

import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import useSession from "@/lib/nostr/useSession";
import { useNostrContext } from "@/lib/nostr/NostrContext";
import { KIND_REPOSITORY, KIND_REPOSITORY_NIP34 } from "@/lib/nostr/events";
import { useContributorMetadata } from "@/lib/nostr/useContributorMetadata";
import { useEntityOwner } from "@/lib/utils/use-entity-owner";
import { getRepoOwnerPubkey } from "@/lib/utils/entity-resolver";
import { findRepoByEntityAndName } from "@/lib/utils/repo-finder";
import { getRepoStorageKey } from "@/lib/utils/entity-normalizer";
import { getUserActivities } from "@/lib/activity-tracking";
import { getRepoStatus, getStatusBadgeStyle } from "@/lib/utils/repo-status";
import { formatDateTime24h } from "@/lib/utils/date-format";
import { pushRepoToNostr } from "@/lib/nostr/push-repo-to-nostr";
import { pushFilesToBridge } from "@/lib/nostr/push-to-bridge";
import { getNostrPrivateKey } from "@/lib/security/encryptedStorage";
import { isOwner } from "@/lib/repo-permissions";
import { nip19 } from "nostr-tools";
import { Lock, Globe, Upload, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { loadStoredRepos, saveStoredRepos, type StoredRepo } from "@/lib/repos/storage";

type Repo = { 
  slug: string; 
  entity?: string; 
  entityDisplayName?: string; 
  repo?: string; 
  name: string; 
  sourceUrl?: string; 
  forkedFrom?: string;
  readme?: string;
  files?: Array<{type: string; path: string; size?: number}>;
  stars?: number;
  forks?: number;
  languages?: Record<string, number>;
  topics?: string[];
  contributors?: Array<{pubkey?: string; name?: string; picture?: string; weight: number; githubLogin?: string}>;
  defaultBranch?: string;
  branches?: Array<{name: string; commit?: string}>;
  releases?: Array<{tag: string; name: string; description?: string; createdAt?: number}>;
  logoUrl?: string;
  createdAt: number;
  publicRead?: boolean;
  ownerPubkey?: string; // Full 64-char pubkey of the repository owner
  links?: Array<{type: "docs" | "discord" | "slack" | "youtube" | "twitter" | "github" | "other"; url: string; label?: string}>;
  clone?: string[];
  relays?: string[];
};

export default function RepositoriesPage() {
  // CRITICAL: Prevent SSR - return empty content during server-side rendering
  const [mounted, setMounted] = useState(false);
  const [repos, setRepos] = useState<Repo[]>([]);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showClearForeignConfirm, setShowClearForeignConfirm] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [pushingRepos, setPushingRepos] = useState<Set<string>>(new Set());
  const [clickedRepo, setClickedRepo] = useState<string | null>(null); // Track which repo is being navigated to
  const syncedFromActivitiesRef = useRef<Set<string>>(new Set()); // Track which repos we've already synced
  const router = useRouter();
  const { name: userName, isLoggedIn } = useSession();
  const { subscribe, publish, defaultRelays, pubkey } = useNostrContext();
  
  useEffect(() => {
    setMounted(true);
  }, []);
  
  // Clear clicked repo state when navigation completes
  useEffect(() => {
    if (!clickedRepo) return;
    
    // Clear on window focus (navigation likely completed)
    const handleFocus = () => {
      setTimeout(() => setClickedRepo(null), 100);
    };
    
    // Clear on visibility change (tab switch)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        setTimeout(() => setClickedRepo(null), 100);
      }
    };
    
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    return () => {
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [clickedRepo]);
  
  // DEBUG: Log relay configuration
  useEffect(() => {
    console.log('🔌 Relay configuration:', {
      relayCount: defaultRelays.length,
      relays: defaultRelays,
      currentUserPubkey: pubkey ? pubkey.slice(0, 8) : 'none (logged out)',
      isLoggedIn: !!pubkey
    });
  }, [defaultRelays, pubkey]);
  
  // Get owner metadata for all repos (for profile pictures)
  // CRITICAL: Always use FULL pubkeys for metadata fetching, never 8-char prefixes
  const ownerPubkeys = useMemo(() => {
    const pubkeys = new Set<string>();
    
    for (const repo of repos) {
      if (!repo.entity || repo.entity === "user") continue;
      
      // Use getRepoOwnerPubkey to resolve full pubkey (handles all cases)
      const fullPubkey = getRepoOwnerPubkey(repo as any, repo.entity);
      if (fullPubkey && /^[0-9a-f]{64}$/i.test(fullPubkey)) {
        pubkeys.add(fullPubkey);
      }
    }
    
    return Array.from(pubkeys);
  }, [repos]);
  
  const ownerMetadata = useContributorMetadata(ownerPubkeys);
  
  // Resolve missing ownerPubkeys from Nostr (runs in useEffect, not useMemo)
  // This ensures all repos have ownerPubkey set for proper metadata fetching
  useEffect(() => {
    if (typeof window === 'undefined') return; // Don't run during SSR
    if (!subscribe || !defaultRelays || defaultRelays.length === 0) return;
    
    const reposToResolve = repos.filter((repo: any) => {
      if (!repo.entity || repo.entity === "user") return false;
      if (repo.ownerPubkey && /^[0-9a-f]{64}$/i.test(repo.ownerPubkey)) return false; // Already resolved
      // Only try to resolve if entity is NOT npub format (backward compatibility for old repos)
      return !repo.entity.startsWith("npub");
    });
    
    if (reposToResolve.length === 0) return;
    
    let resolvedCount = 0;
    const unsub = subscribe(
      [{ kinds: [KIND_REPOSITORY, KIND_REPOSITORY_NIP34] }], // Support both gitnostr and NIP-34
      defaultRelays,
      (event, isAfterEose, relayURL) => {
        if (typeof window === 'undefined') return; // Don't access localStorage during SSR
        if ((event.kind === KIND_REPOSITORY || event.kind === KIND_REPOSITORY_NIP34) && !isAfterEose && /^[0-9a-f]{64}$/i.test(event.pubkey)) {
          try {
            let repoData;
            try {
              repoData = JSON.parse(event.content);
            } catch (parseError) {
              console.warn(`[Repositories] Failed to parse repo event content as JSON:`, parseError, `Content: ${event.content?.substring(0, 50)}...`);
              return; // Skip this event if content is not valid JSON
            }
            
            // Find matching repo
            const matchingRepo = reposToResolve.find((r: any) => 
              (repoData.repositoryName === (r.repo || r.slug)) &&
              event.pubkey.toLowerCase().startsWith(r.entity.toLowerCase())
            );
            
            if (matchingRepo) {
              // Update repo with ownerPubkey
              const allRepos = loadStoredRepos();
              const repoIndex = allRepos.findIndex((r) => 
                r.entity === matchingRepo.entity && (r.repo === matchingRepo.repo || r.slug === matchingRepo.slug)
              );
              
              if (repoIndex >= 0 && allRepos[repoIndex] && !allRepos[repoIndex].ownerPubkey) {
                allRepos[repoIndex].ownerPubkey = event.pubkey;
                
                // Ensure owner is in contributors with full pubkey
                if (!allRepos[repoIndex].contributors || !Array.isArray(allRepos[repoIndex].contributors)) {
                  allRepos[repoIndex].contributors = [];
                }
                const ownerExists = allRepos[repoIndex].contributors.some((c: any) => c.pubkey === event.pubkey);
                if (!ownerExists) {
                  allRepos[repoIndex].contributors.unshift({ pubkey: event.pubkey, weight: 100, role: "owner" });
                } else {
                  // Update existing owner contributor to ensure it has full pubkey
                  const ownerIndex = allRepos[repoIndex].contributors.findIndex((c: any) => c.pubkey === event.pubkey);
                  if (ownerIndex >= 0) {
                    allRepos[repoIndex].contributors[ownerIndex] = {
                      ...allRepos[repoIndex].contributors[ownerIndex],
                      pubkey: event.pubkey,
                      weight: 100,
                      role: "owner"
                    };
                  }
                }
                
                saveStoredRepos(allRepos);
                setRepos([...allRepos] as Repo[]);
                resolvedCount++;
                
                // If all resolved, we can unsubscribe early
                if (resolvedCount >= reposToResolve.length && unsub) {
                  unsub();
                }
              }
            }
          } catch (e) {
            console.error("Error resolving ownerPubkey from Nostr:", e);
          }
        }
      },
      undefined,
      (events, relayURL) => {
        // EOSE - done resolving
        if (unsub) unsub();
      }
    );
    
    // Timeout after 10 seconds
    const timeout = setTimeout(() => {
      if (unsub) unsub();
    }, 10000);
    
    return () => {
      clearTimeout(timeout);
      if (unsub) unsub();
    };
  }, [repos, subscribe, defaultRelays]);
  
  // Helper removed - use getRepoOwnerPubkey from entity-resolver instead
  
  // Function to resolve repo icon with priority (memoized to react to ownerMetadata changes):
  // 1. Stored logoUrl (user-set in repo settings)
  // 2. Logo file from repo (if files list has logo.*)
  // 3. Owner Nostr profile picture (last fallback)
  const resolveRepoIcon = useCallback((repo: Repo): string | null => {
    // Priority 1: Stored logoUrl
    if (repo.logoUrl && repo.logoUrl.trim().length > 0) {
      return repo.logoUrl;
    }
    
    // Priority 2: Logo file from repo (search all directories, handle multiple formats/names)
    if (repo.files && repo.files.length > 0) {
      // Find all potential icon files - search in ALL directories, handle various naming patterns:
      // 1. Files with "logo" in name (highest priority)
      // 2. Files named after the repo (e.g., "tides.png" for tides repo)
      // 3. Common icon names in root (repo.png, icon.png, etc.)
      // - Multiple formats: .png, .jpg, .jpeg, .gif, .webp, .svg, .ico
      const repoName = (repo.repo || repo.slug || repo.name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
      const imageExts = ["png", "jpg", "jpeg", "gif", "webp", "svg", "ico"];
      
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
        if (!ownerRepo) {
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
          
          if (ownerPubkey && /^[0-9a-f]{64}$/i.test(ownerPubkey) && repoName && logoPath) {
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
      const metadata = ownerMetadata[ownerPubkey];
      if (metadata?.picture) {
        const picture = metadata.picture;
        if (picture && picture.trim().length > 0 && picture.startsWith("http")) {
          return picture;
        }
      }
    }
    
    return null;
  }, [ownerMetadata]);
  
  // Load from localStorage first and listen for updates
  const loadRepos = useCallback(() => {
    if (typeof window === 'undefined') {
      setRepos([]);
      return; // Don't access localStorage during SSR
    }
    try {
      const list = JSON.parse(localStorage.getItem("gittr_repos") || "[]") as Repo[];
      
      // Debug: Check for tides repo (case-insensitive)
      const tidesRepo = list.find(r => {
        const repoName = r.repo || r.slug || r.name || "";
        return repoName.toLowerCase() === "tides";
      });
      if (tidesRepo) {
        console.log("🔍 [Repositories] Found tides repo in localStorage:", {
          entity: tidesRepo.entity,
          entityLength: tidesRepo.entity?.length,
          entityIsNpub: tidesRepo.entity?.startsWith("npub"),
          repo: tidesRepo.repo,
          slug: tidesRepo.slug,
          name: tidesRepo.name,
          ownerPubkey: (tidesRepo as any).ownerPubkey?.slice(0, 16),
          ownerPubkeyLength: (tidesRepo as any).ownerPubkey?.length,
          ownerPubkeyIs64Char: (tidesRepo as any).ownerPubkey?.length === 64,
          hasContributors: !!(tidesRepo.contributors && Array.isArray(tidesRepo.contributors)),
          contributorsCount: tidesRepo.contributors?.length || 0,
          ownerContributor: tidesRepo.contributors?.find((c: any) => c.weight === 100),
          currentUserPubkey: pubkey?.slice(0, 16),
          ownerMatches: pubkey && (tidesRepo as any).ownerPubkey ? (tidesRepo as any).ownerPubkey.toLowerCase() === pubkey.toLowerCase() : false,
        });
      } else {
        console.log("⚠️ [Repositories] tides repo NOT found in localStorage. Total repos:", list.length);
        // Debug: Check for any repo with "tide" in the name
        const tideRepos = list.filter(r => {
          const repoName = (r.repo || r.slug || r.name || "").toLowerCase();
          return repoName.includes("tide");
        });
        if (tideRepos.length > 0) {
          console.log("🔍 [Repositories] Found repos with 'tide' in name:", tideRepos.map((r: any) => ({
            repo: r.repo,
            slug: r.slug,
            name: r.name,
            entity: r.entity,
          })));
        }
      }
      
      // Load list of locally-deleted repos (user deleted them, don't re-add from Nostr)
      const deletedRepos = JSON.parse(localStorage.getItem("gittr_deleted_repos") || "[]") as Array<{entity: string; repo: string; deletedAt: number}>;
      const deletedReposSet = new Set(deletedRepos.map(d => `${d.entity}/${d.repo}`.toLowerCase()));
      
      // AUTO-FIX: Delete test_repo_icon_check_fork
      const filtered = list.filter(r => {
        const repoName = r.repo || r.slug || r.name || "";
        
        if (repoName === "test_repo_icon_check_fork") return false;
        
        // Filter out locally-deleted repos
        const entity = r.entity || "";
        const repo = r.repo || r.slug || "";
        const repoKey = `${entity}/${repo}`.toLowerCase();
        if (deletedReposSet.has(repoKey)) return false;
        
        // Filter out repos marked as deleted/archived on Nostr (owner's deletion request)
        if ((r as any).deleted === true || (r as any).archived === true) return false;
        
        return true;
      });
      
      // AUTO-FIX: Fix tides repo ownership if it belongs to current user
      const fixed = filtered.map(r => {
        const repoName = r.repo || r.slug || r.name || "";
        
        // Fix tides repo if it exists and belongs to current user
        if (repoName === "tides" && pubkey) {
          // Check if it's actually the user's repo (has sourceUrl from GitHub import)
          if ((r as any).sourceUrl && (r as any).sourceUrl.includes("github.com")) {
            // This is an imported repo - ensure ownerPubkey is set correctly
            if (!(r as any).ownerPubkey || (r as any).ownerPubkey !== pubkey) {
              const updated = { ...r } as any;
              updated.ownerPubkey = pubkey;
              
              // Ensure owner is in contributors
              if (!updated.contributors || !Array.isArray(updated.contributors)) {
                updated.contributors = [];
              }
              const ownerExists = updated.contributors.some((c: any) => c.pubkey === pubkey);
              if (!ownerExists) {
                updated.contributors.unshift({
                  pubkey: pubkey,
                  weight: 100,
                  role: "owner"
                });
              } else {
                updated.contributors = updated.contributors.map((c: any) => 
                  c.pubkey === pubkey ? { ...c, weight: 100, role: "owner" } : c
                );
              }
              
              // Ensure entity is npub format (GRASP protocol standard)
              if (!updated.entity || updated.entity === "user") {
                try {
                  updated.entity = nip19.npubEncode(pubkey);
                } catch (e) {
                  console.error("Failed to encode npub for entity:", e);
                }
              }
              
              console.log("🔧 Auto-fixed tides repo ownership");
              return updated;
            }
          }
        }
        
        return r;
      });
      
      // CRITICAL: Don't set entityDisplayName to current user's name - it should be the owner's display name
      // The actual owner's name will be fetched via useContributorMetadata hook
      // Only set entityDisplayName if it's missing (for backward compatibility)
      const updated = fixed.map(r => {
        // If entityDisplayName is missing, set a temporary display name
        // This will be overridden by ownerMetadata when it loads
        if (!r.entityDisplayName) {
          // For npub format, use shortened version for display only
          // For full pubkey, encode to npub first, then shorten for display
          const displayName = r.entity?.startsWith("npub")
            ? r.entity.slice(0, 12) + "..." // Shortened npub for display
            : (r.ownerPubkey && /^[0-9a-f]{64}$/i.test(r.ownerPubkey))
            ? nip19.npubEncode(r.ownerPubkey).slice(0, 12) + "..." // Encode to npub, then shorten
            : (r.entity || "");
          return { ...r, entityDisplayName: displayName };
        }
        return r;
      });
      
      // Save if anything changed
      if (updated.length !== list.length || updated.some((r, i) => JSON.stringify(r) !== JSON.stringify(list[i]))) {
        localStorage.setItem("gittr_repos", JSON.stringify(updated));
        if (updated.length !== list.length) {
          console.log(`✅ Auto-deleted test_repo_icon_check_fork (removed ${list.length - updated.length} instance(s))`);
        }
      }
      setRepos(updated);
    } catch (e) { 
      console.error("Error loading repos:", e);
      setRepos([]); 
    }
  }, [pubkey]);

  useEffect(() => {
    if (typeof window === 'undefined') return; // Don't run during SSR
    loadRepos();
    
    // Listen for storage changes (when repos are created/imported in other tabs)
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === "gittr_repos") {
        console.log("📦 [Repositories] Storage event detected, reloading repos...");
        loadRepos();
      }
    };
    
    // Listen for custom events when repos are created/imported
    const handleRepoUpdate = (event: Event) => {
      const customEvent = event as CustomEvent;
      console.log("📦 [Repositories] Custom event detected (repo-created/imported), reloading repos...", {
        hasDetail: !!customEvent?.detail,
        reposInDetail: customEvent?.detail?.repos?.length || 0,
      });
      // Small delay to ensure localStorage is updated
      setTimeout(() => {
        loadRepos();
      }, 100);
    };
    
    window.addEventListener("storage", handleStorageChange);
    window.addEventListener("gittr:repo-created", handleRepoUpdate as EventListener);
    window.addEventListener("gittr:repo-imported", handleRepoUpdate as EventListener);
    
    return () => {
      window.removeEventListener("storage", handleStorageChange);
      window.removeEventListener("gittr:repo-created", handleRepoUpdate as EventListener);
      window.removeEventListener("gittr:repo-imported", handleRepoUpdate as EventListener);
    };
  }, [loadRepos]);

  // Sync from Nostr relays - query for ALL public repos (Nostr cloud)
  // This allows users to see repos from all users, not just their own
  useEffect(() => {
    if (!subscribe || !defaultRelays || defaultRelays.length === 0) return;
    
    setSyncing(true);
    
    // Query Nostr for ALL repositories (no author filter = all users)
    // Also query user's own repos to ensure they're included
    // NOTE: No time limit - get all repos from Nostr (historical repos are valuable)
    // Relays will handle pagination/limits if needed
    
    // CRITICAL: For NIP-34 replaceable events, collect ALL events per repo and pick the latest
    // Map: repoKey (pubkey + d tag) -> array of events
    const nip34EventsByRepo = new Map<string, Array<{event: any; relayURL?: string}>>();
    
    const unsub = subscribe(
      [
        {
          kinds: [KIND_REPOSITORY, KIND_REPOSITORY_NIP34], // Support both gitnostr and NIP-34
          limit: 10000, // Request up to 10k repos (most relays default to 100-500 without this)
          // No since parameter = get ALL repos (no time limit)
          // No authors filter = get ALL public repos from all users
          // This is the "Nostr cloud" - repos are stored on relays, not locally
        },
        ...(pubkey ? [{
          kinds: [KIND_REPOSITORY, KIND_REPOSITORY_NIP34], // Support both gitnostr and NIP-34
          authors: [pubkey], // Also get user's own repos (for private repos in future)
          limit: 1000, // User's own repos - smaller limit is fine
          // No since parameter = get all user's repos (no time limit)
        }] : []),
      ],
      defaultRelays,
      (event, isAfterEose, relayURL) => {
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
            console.log(`📦 [Repos] Collected NIP-34 event for ${repoKey}: id=${event.id.slice(0, 8)}..., created_at=${event.created_at}, total=${nip34EventsByRepo.get(repoKey)!.length}`);
            // Don't return - continue to process it normally too (for immediate display)
            // But we'll ensure the latest one is used when storing
          }
        }
        
        // Process ALL events, not just before EOSE (EOSE just means "end of stored events", but new events can still arrive)
        if (event.kind === KIND_REPOSITORY || event.kind === KIND_REPOSITORY_NIP34) {
          try {
            let repoData: any;
            if (event.kind === KIND_REPOSITORY_NIP34) {
              // NIP-34 format: Parse from tags
              repoData = { repositoryName: "", description: "", clone: [], relays: [], topics: [] };
              if (event.tags && Array.isArray(event.tags)) {
                for (const tag of event.tags) {
                  if (!Array.isArray(tag) || tag.length < 2) continue;
                  const tagName = tag[0];
                  const tagValue = tag[1];
                  if (tagName === "d") repoData.repositoryName = tagValue;
                  else if (tagName === "name" && !repoData.repositoryName) repoData.repositoryName = tagValue;
                  else if (tagName === "description") repoData.description = tagValue;
                  else if (tagName === "clone" && tagValue) repoData.clone.push(tagValue);
                  else if (tagName === "relays" && tagValue) repoData.relays.push(tagValue);
                  else if (tagName === "t" && tagValue) repoData.topics.push(tagValue);
                  else if (tagName === "r" && tagValue && tag[2] === "euc") {
                    // Extract earliest unique commit from "r" tag with "euc" marker
                    repoData.earliestUniqueCommit = tagValue;
                  }
                }
              }
              repoData.publicRead = true;
              repoData.publicWrite = false;
            } else {
              try {
                repoData = JSON.parse(event.content);
              } catch (parseError) {
                console.warn(`[Repositories] Failed to parse repo event content as JSON:`, parseError, `Content: ${event.content?.substring(0, 50)}...`);
                return; // Skip this event if content is not valid JSON
              }
            }
            
            // Ensure repoData is defined before proceeding
            if (!repoData) {
              console.warn(`[Repositories] repoData is undefined after parsing`);
              return;
            }
            
            // GRASP-01: Parse clone, relays, topics, contributors, source, and forkedFrom from event.tags
            const cloneTags: string[] = [];
            const relaysTags: string[] = [];
            const topicTags: string[] = [];
            const contributorTags: Array<{pubkey: string; weight: number; role?: string}> = [];
            let sourceUrlFromTag: string | undefined;
            let forkedFromFromTag: string | undefined;
            
            if (event.tags && Array.isArray(event.tags)) {
              for (const tag of event.tags) {
                if (Array.isArray(tag) && tag.length >= 2) {
                  const tagName = tag[0];
                  const tagValue = tag[1];
                  
                  if (tagName === "clone" && tagValue) {
                    cloneTags.push(tagValue);
                  } else if (tagName === "relays" && tagValue) {
                    relaysTags.push(tagValue);
                  } else if (tagName === "t" && tagValue) {
                    topicTags.push(tagValue);
                  } else if (tagName === "source" && tagValue) {
                    // Extract sourceUrl from "source" tag (used in push-repo-to-nostr.ts)
                    sourceUrlFromTag = tagValue;
                  } else if (tagName === "forkedFrom" && tagValue) {
                    // Extract forkedFrom from "forkedFrom" tag
                    forkedFromFromTag = tagValue;
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
            
            // DEBUG: Log ALL repos received (for debugging)
            const isForeignRepo = pubkey && event.pubkey !== pubkey;
            const isOwnRepo = pubkey && event.pubkey === pubkey;
            console.log('📦 Repo event received:', {
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
            
            if (typeof window === 'undefined') return; // Don't access localStorage during SSR
            // Load existing repos
            const existingRepos = JSON.parse(localStorage.getItem("gittr_repos") || "[]") as Repo[];
            
            // Check if this repo was locally deleted (user deleted it, don't re-add from Nostr)
            const deletedRepos = JSON.parse(localStorage.getItem("gittr_deleted_repos") || "[]") as Array<{entity: string; repo: string; deletedAt: number}>;
            // CRITICAL: Use npub format for entity (GRASP protocol standard)
            let entity: string;
            try {
              entity = nip19.npubEncode(event.pubkey);
            } catch {
              entity = event.pubkey; // Fallback to full pubkey if encoding fails
            }
            const repoKey = `${entity}/${repoData.repositoryName}`.toLowerCase();
            const isDeleted = deletedRepos.some(d => {
              // Check by npub entity or by ownerPubkey (handles both formats)
              const dEntityMatch = d.entity.toLowerCase() === entity.toLowerCase();
              if (dEntityMatch && d.repo.toLowerCase() === repoData.repositoryName.toLowerCase()) return true;
              // Also check if deleted entity is npub for same pubkey
              if (d.entity.startsWith("npub")) {
                try {
                  const dDecoded = nip19.decode(d.entity);
                  if (dDecoded.type === "npub" && (dDecoded.data as string).toLowerCase() === event.pubkey.toLowerCase()) {
                    return d.repo.toLowerCase() === repoData.repositoryName.toLowerCase();
                  }
                } catch {}
              }
              return false;
            });
            
            // Skip if repo was locally deleted
            if (isDeleted) {
              console.log(`⏭️ Skipping locally-deleted repo: ${repoKey}`);
              return;
            }
            
            // CRITICAL: Check if repo owner marked it as deleted/archived on Nostr
            // Respect owner's deletion request - don't show repos they've marked as deleted
            if (repoData.deleted === true || repoData.archived === true) {
              console.log(`⏭️ Skipping owner-deleted/archived repo from Nostr: ${repoKey}`, {
                deleted: repoData.deleted,
                archived: repoData.archived,
                owner: entity.slice(0, 12) + "..."
              });
              return;
            }
            
            // Check if this repo already exists (match by entity OR by ownerPubkey)
            const existingIndex = existingRepos.findIndex((r: any) => {
              // Match by ownerPubkey first (most reliable - works across all entity formats)
              if (r.ownerPubkey === event.pubkey) {
                return r.repo === repoData.repositoryName || r.slug === repoData.repositoryName;
              }
              // Match by entity (npub format or full pubkey)
              if (r.entity === entity || r.entity === event.pubkey) {
                return r.repo === repoData.repositoryName || r.slug === repoData.repositoryName;
              }
              // Also check if existing entity is npub for same pubkey
              if (r.entity && r.entity.startsWith("npub")) {
                try {
                  const rDecoded = nip19.decode(r.entity);
                  if (rDecoded.type === "npub" && (rDecoded.data as string).toLowerCase() === event.pubkey.toLowerCase()) {
                    return r.repo === repoData.repositoryName || r.slug === repoData.repositoryName;
                  }
                } catch {}
              }
              return false;
            });
            
            // The actual owner's name will be fetched via useContributorMetadata hook
            const entityDisplayName = entity; // Will be overridden by ownerMetadata when it loads
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
              console.log(`📋 [Repos] Extracted ${contributors.length} contributors from "p" tags`);
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
              console.log(`📋 [Repos] Merged ${repoData.contributors.length} contributors from JSON content`);
            }
            
            // Priority 3: Merge with existing repo contributors (preserve local metadata like names/pictures)
            if (existingRepo?.contributors && Array.isArray(existingRepo.contributors) && existingRepo.contributors.length > 0) {
              for (const existingContributor of existingRepo.contributors) {
                const existingIndex = contributors.findIndex(c => 
                  c.pubkey && existingContributor.pubkey && 
                  c.pubkey.toLowerCase() === existingContributor.pubkey.toLowerCase()
                );
                if (existingIndex >= 0 && contributors[existingIndex]) {
                  // Merge: keep pubkey/weight/role from tags/content, but preserve name/picture from existing
                  contributors[existingIndex] = {
                    ...contributors[existingIndex],
                    weight: contributors[existingIndex].weight || 0,
                    name: existingContributor.name || contributors[existingIndex].name,
                    picture: existingContributor.picture || contributors[existingIndex].picture,
                    githubLogin: existingContributor.githubLogin || contributors[existingIndex].githubLogin,
                  };
                } else {
                  // Add contributor that exists locally but not in event
                  contributors.push(existingContributor);
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
            
            console.log(`✅ [Repos] Final contributors list: ${contributors.length} total`, {
              owners: contributors.filter(c => c.weight === 100 || c.role === "owner").length,
              maintainers: contributors.filter(c => c.role === "maintainer" || (c.weight >= 50 && c.weight < 100)).length,
              contributors: contributors.filter(c => c.role === "contributor" || (c.weight > 0 && c.weight < 50)).length,
            });
            
            // CRITICAL: Set sourceUrl from clone URLs if sourceUrl is missing
            // Priority 1: Use sourceUrl from event tags ("source" tag), event content, or existing repo
            let finalSourceUrl = sourceUrlFromTag || repoData.sourceUrl || existingRepo?.sourceUrl;
            // Priority 2: If no sourceUrl, try to find GitHub/GitLab/Codeberg clone URL (preferred)
            // CRITICAL: Only use GitHub/GitLab/Codeberg URLs as sourceUrl - Nostr git servers are handled by multi-source fetcher
            if (!finalSourceUrl && cloneTags.length > 0) {
              const gitCloneUrl = cloneTags.find((url: string) => 
                url.includes('github.com') || url.includes('gitlab.com') || url.includes('codeberg.org')
              );
              if (gitCloneUrl) {
                finalSourceUrl = gitCloneUrl.replace(/\.git$/, '');
              }
            }
            // Also check existing repo's clone URLs if still no sourceUrl
            if (!finalSourceUrl && existingRepo?.clone && Array.isArray(existingRepo.clone) && existingRepo.clone.length > 0) {
              const gitCloneUrl = existingRepo.clone.find((url: string) => 
                url.includes('github.com') || url.includes('gitlab.com') || url.includes('codeberg.org')
              );
              if (gitCloneUrl) {
                finalSourceUrl = gitCloneUrl.replace(/\.git$/, '');
              }
            }
            // Note: We don't use Nostr git server URLs (gittr.space, etc.) as sourceUrl
            // Those are handled by the multi-source fetcher or git-nostr-bridge
            
            // CRITICAL: Validate entity is not a domain name
            if (!entity || entity === "gittr.space" || (entity.includes(".") && !entity.startsWith("npub"))) {
              console.error("❌ [Repositories] Invalid entity detected from Nostr event, skipping:", {
                entity,
                eventId: event.id.slice(0, 8),
                repoName: repoData.repositoryName,
                eventPubkey: event.pubkey.slice(0, 8)
              });
              return; // Skip this repo - invalid entity
            }
            
            // CRITICAL: Validate repositoryName matches what we expect (prevent name corruption)
            if (repoData.repositoryName && repoData.repositoryName.toLowerCase() === "tides" && repoData.repositoryName !== repoData.repositoryName) {
              console.error("❌ [Repositories] Repository name mismatch detected, skipping:", {
                repositoryName: repoData.repositoryName,
                eventId: event.id.slice(0, 8),
                entity,
                eventPubkey: event.pubkey.slice(0, 8)
              });
              return; // Skip this repo - name corruption detected
            }
            
            // CRITICAL: Never use entity from repoData - it might be corrupted
            // Always use entity derived from event.pubkey (the actual owner)
            // Remove any entity field from repoData if it exists
            const { entity: _, ...cleanRepoData } = repoData as any;
            
            // Merge ALL metadata from Nostr event
            const repo: any = {
              slug: repoData.repositoryName,
              entity: entity, // ALWAYS use npub format derived from event.pubkey (GRASP protocol standard)
              entityDisplayName: entityDisplayName, // Will be overridden by ownerMetadata when fetched
              repo: repoData.repositoryName,
              // CRITICAL: Use human-readable name from event content if available, otherwise use repositoryName
              name: repoData.name || repoData.repositoryName,
              // CRITICAL: Set ownerPubkey to event.pubkey (the actual owner, not current user!)
              ownerPubkey: event.pubkey,
              // Mark as synced from Nostr = "live"
              syncedFromNostr: true,
              nostrEventId: event.id,
              description: repoData.description,
              // Sync ALL extended metadata
              sourceUrl: finalSourceUrl || sourceUrlFromTag || repoData.sourceUrl || existingRepo?.sourceUrl,
              forkedFrom: forkedFromFromTag || repoData.forkedFrom || existingRepo?.forkedFrom,
              readme: repoData.readme !== undefined ? repoData.readme : (existingRepo?.readme !== undefined ? existingRepo.readme : ""),
              files: repoData.files !== undefined ? repoData.files : (existingRepo?.files !== undefined ? existingRepo.files : []),
              stars: repoData.stars !== undefined ? repoData.stars : existingRepo?.stars,
              forks: repoData.forks !== undefined ? repoData.forks : existingRepo?.forks,
              languages: repoData.languages || existingRepo?.languages,
              // GRASP-01: Use topics from event.tags (t tags), fallback to content
              topics: topicTags.length > 0 ? topicTags : (repoData.topics || existingRepo?.topics || []),
              contributors: contributors, // Include owner with weight 100 and full pubkey
              defaultBranch: repoData.defaultBranch || existingRepo?.defaultBranch,
              branches: repoData.branches || existingRepo?.branches,
              releases: repoData.releases || existingRepo?.releases,
              logoUrl: existingRepo?.logoUrl, // Preserve local-only
              createdAt: existingRepo?.createdAt || (event.created_at * 1000),
              // CRITICAL: Preserve deletion markers from Nostr (owner's deletion request)
              deleted: repoData.deleted,
              archived: repoData.archived,
              // Repository links
              links: repoData.links || existingRepo?.links,
              // GRASP-01: Store clone and relays tags from event.tags
              // CRITICAL: Filter out localhost URLs - they're not real git servers
              clone: cloneTags.length > 0 
                ? cloneTags.filter((url: string) => url && !url.includes('localhost') && !url.includes('127.0.0.1'))
                : (repoData.clone || existingRepo?.clone || []).filter((url: string) => url && !url.includes('localhost') && !url.includes('127.0.0.1')),
              relays: relaysTags.length > 0 ? relaysTags : (repoData.relays || existingRepo?.relays),
            };
            
            // Merge with existing data
            // CRITICAL: Always update ownerPubkey even for existing repos (fixes repos synced before the fix)
            if (existingIndex >= 0 && existingRepos[existingIndex]) {
              // CRITICAL: For NIP-34 replaceable events, only update if this event is newer
              // Check if existing repo has a newer event already stored
              // NIP-34 uses Unix timestamps in SECONDS - compare in seconds
              const existingRepo = existingRepos[existingIndex];
              const existingEventCreatedAtSeconds = (existingRepo as any)?.lastNostrEventCreatedAt || 
                ((existingRepo as any)?.updatedAt ? Math.floor((existingRepo as any).updatedAt / 1000) : 0);
              const newEventCreatedAtSeconds = event.created_at; // Already in seconds (Nostr format)
              
              if (event.kind === KIND_REPOSITORY_NIP34 && newEventCreatedAtSeconds <= existingEventCreatedAtSeconds) {
                console.log(`⏭️ [Repos] Skipping older NIP-34 event: existing=${new Date(existingEventCreatedAtSeconds * 1000).toISOString()}, new=${new Date(newEventCreatedAtSeconds * 1000).toISOString()}`);
                return; // Skip older events
              }
              
              // CRITICAL: Validate existing repo entity is not corrupted
              const existingEntity = existingRepos[existingIndex].entity;
              if (existingEntity === "gittr.space" || (!existingEntity?.startsWith("npub") && existingEntity?.includes("."))) {
                console.error("❌ [Repositories] Existing repo has corrupted entity, fixing:", {
                  oldEntity: existingEntity,
                  newEntity: entity,
                  repoName: repoData.repositoryName,
                  eventId: event.id.slice(0, 8)
                });
                // Replace corrupted entity with correct one
                repo.entity = entity;
              }
              
              // CRITICAL: Preserve existing sourceUrl if new one is not available
              // This prevents losing GitHub/GitLab/Codeberg sourceUrl when syncing from Nostr
              const preservedSourceUrl = repo.sourceUrl || existingRepos[existingIndex].sourceUrl;
              existingRepos[existingIndex] = { 
                ...existingRepos[existingIndex], 
                ...repo,
                // CRITICAL: Ensure entity is never "gittr.space" or a domain name
                entity: (repo.entity && repo.entity !== "gittr.space" && (repo.entity.startsWith("npub") || !repo.entity.includes("."))) ? repo.entity : entity,
                // Preserve sourceUrl if it was set (don't overwrite with undefined)
                sourceUrl: preservedSourceUrl,
                // Force update ownerPubkey and contributors to fix old repos
                ownerPubkey: event.pubkey,
                contributors: contributors,
                // Store latest event ID and created_at
                // CRITICAL: Store in SECONDS (Nostr format) - not milliseconds
                nostrEventId: event.id,
                lastNostrEventId: event.id,
                lastNostrEventCreatedAt: event.created_at, // Store in seconds (NIP-34 format)
                // Extract earliest unique commit from "r" tag if present (may not be in Repo type but exists at runtime)
                ...(repoData.earliestUniqueCommit || (existingRepos[existingIndex] as any)?.earliestUniqueCommit ? { earliestUniqueCommit: repoData.earliestUniqueCommit || (existingRepos[existingIndex] as any)?.earliestUniqueCommit } : {}),
              };
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
            
            // CRITICAL: Clean up repos with invalid entity formats
            // Remove repos with "gittr.space" entity (the specific corruption bug)
            // Also remove repos with entity that's not npub format (domain names, etc.)
            const cleanedRepos = existingRepos.filter((r: any) => {
              // Remove if entity is exactly "gittr.space" (the known corruption)
              if (r.entity === "gittr.space") {
                const repoName = r.repo || r.slug || r.name || "";
                console.error("❌ [Repositories] Removing repo with corrupted entity 'gittr.space':", {
                  entity: r.entity,
                  repo: repoName,
                  ownerPubkey: (r as any).ownerPubkey?.slice(0, 16),
                  nostrEventId: (r as any).nostrEventId?.slice(0, 16),
                  lastNostrEventId: (r as any).lastNostrEventId?.slice(0, 16),
                  syncedFromNostr: r.syncedFromNostr
                });
                return false; // Remove corrupted repos
              }
              
              // Remove if entity is not npub format (domain names, etc. are invalid)
              // Entity MUST be npub format (starts with "npub") - this is the GRASP protocol standard
              if (r.entity && !r.entity.startsWith("npub")) {
                const repoName = r.repo || r.slug || r.name || "";
                console.error("❌ [Repositories] Removing repo with invalid entity format (not npub):", {
                  entity: r.entity,
                  repo: repoName,
                  ownerPubkey: (r as any).ownerPubkey?.slice(0, 16),
                  nostrEventId: (r as any).nostrEventId?.slice(0, 16)
                });
                return false; // Remove repos with invalid entity format
              }
              
              return true; // Keep repos with valid npub entity
            });
            
            // Log how many were removed
            const removedCount = existingRepos.length - cleanedRepos.length;
            if (removedCount > 0) {
              console.log(`🧹 [Repositories] Cleaned up ${removedCount} repo(s) with corrupted/invalid entity`);
            }
            
            // Save to localStorage (with corrupted repos removed)
            localStorage.setItem("gittr_repos", JSON.stringify(cleanedRepos));
            
            // CRITICAL: Don't call setRepos here - it causes infinite loops
            // The repos will be loaded from localStorage via loadRepos() when needed
            // or via storage event listeners. This prevents maximum update depth errors.
          } catch (error) {
            console.error("Failed to process repo event from Nostr:", error);
          }
        }
        
        // EOSE is called per relay - don't set syncing=false here, wait for all relays
        // We'll track EOSE separately and only mark as complete when all relays are done
        if (isAfterEose) {
          // DEBUG: Log summary after EOSE from this relay
          if (typeof window === 'undefined') return; // Don't access localStorage during SSR
          const allRepos = JSON.parse(localStorage.getItem("gittr_repos") || "[]");
          const foreignRepos = pubkey ? allRepos.filter((r: any) => r.ownerPubkey && r.ownerPubkey !== pubkey) : allRepos;
          const foreignReposWithFiles = foreignRepos.filter((r: any) => r.files && r.files.length > 0);
            const reposWithOwnerPubkeys = allRepos.filter((r: any) => 
              r.ownerPubkey && /^[0-9a-f]{64}$/i.test(r.ownerPubkey)
            ).length;
            console.log('📊 EOSE from relay:', {
              relay: relayURL,
              totalRepos: allRepos.length,
              foreignRepos: foreignRepos.length,
              foreignReposWithFiles: foreignReposWithFiles.length,
              reposWithOwnerPubkeys: reposWithOwnerPubkeys,
              currentUserPubkey: pubkey ? pubkey.slice(0, 8) : 'none'
            });
        }
      },
      undefined,
      (events, relayURL) => {
        // Final EOSE callback - all events from all relays received
        // Note: This is called per relay, so we need to track when ALL relays are done
        // For now, we'll use a delay to ensure all relays have sent EOSE
        setTimeout(() => {
          if (typeof window === 'undefined') return; // Don't access localStorage during SSR
          setSyncing(false);
          const allRepos = JSON.parse(localStorage.getItem("gittr_repos") || "[]");
          const foreignRepos = pubkey ? allRepos.filter((r: any) => r.ownerPubkey && r.ownerPubkey !== pubkey) : allRepos;
          const foreignReposWithFiles = foreignRepos.filter((r: any) => r.files && r.files.length > 0);
          
          // Count repos with valid owner pubkeys (for profile pics)
          const reposWithOwnerPubkeys = allRepos.filter((r: any) => 
            r.ownerPubkey && /^[0-9a-f]{64}$/i.test(r.ownerPubkey)
          ).length;
          
          console.log('✅ Nostr sync complete (all relays):', {
            totalRepos: allRepos.length,
            foreignRepos: foreignRepos.length,
            foreignReposWithFiles: foreignReposWithFiles.length,
            reposWithOwnerPubkeys: reposWithOwnerPubkeys,
            relays: defaultRelays.length,
            relayList: defaultRelays,
            currentUserPubkey: pubkey ? pubkey.slice(0, 8) : 'none'
          });
          
          // CRITICAL: Reload repos from localStorage after all events are processed
          // This updates the UI without causing infinite loops (only called once after EOSE)
          loadRepos();
        }, 2000); // Wait 2 seconds after last EOSE to ensure all relays have finished
      },
      { allowDuplicateEvents: false }
    );
    
    return () => {
      unsub();
    };
  }, [subscribe, pubkey, defaultRelays, userName]); // Note: pubkey optional - syncs ALL repos even when not logged in
  
  // Make findCorruptTidesRepos available in console for debugging
  useEffect(() => {
    if (typeof window !== 'undefined' && mounted) {
      // Dynamic import to avoid SSR issues
      import("./find-corrupt-tides-repos").then(({ findCorruptTidesRepos }) => {
        (window as any).findCorruptTidesRepos = findCorruptTidesRepos;
        console.log("💡 Run findCorruptTidesRepos() in console to find corrupt tides repos with entity 'gittr.space'");
      });
    }
  }, [mounted]);
  
  // CRITICAL: Sync repos from activities if they're missing from localStorage
  // This handles the case where repos were created locally but not synced to localStorage
  useEffect(() => {
    if (typeof window === 'undefined') return; // Don't access localStorage during SSR
    if (!pubkey) return; // Not logged in = can't sync
    
    try {
      const allRepos = JSON.parse(localStorage.getItem("gittr_repos") || "[]") as any[];
      
      // Debug: Check for tides in allRepos
      const tidesInAllRepos = allRepos.filter((r: any) => {
        const repoName = r.repo || r.slug || r.name || "";
        return repoName.toLowerCase() === "tides";
      });
      if (tidesInAllRepos.length > 0) {
        console.log("🔍 [Repositories] Found tides in allRepos BEFORE filter:", tidesInAllRepos.length, tidesInAllRepos.map((r: any) => ({
          entity: r.entity,
          repo: r.repo,
          slug: r.slug,
          name: r.name,
          ownerPubkey: (r as any).ownerPubkey?.slice(0, 16),
        })));
      } else {
        console.log("⚠️ [Repositories] tides NOT in allRepos before filter");
      }
      
      // Filter repos owned by current user
      // CRITICAL: Match the structure created by /new and /import pages:
      // - entity: npub format (GRASP protocol standard)
      // - ownerPubkey: full 64-char pubkey
      // - contributors: array with owner having weight 100
      const userReposList = allRepos.filter((r: any) => {
        // CRITICAL: Exclude repos with "gittr.space" entity (the corruption bug)
        // These are corrupted repos that should never exist - exclude them completely
        if (r.entity === "gittr.space") {
          const repoName = r.repo || r.slug || r.name || "";
          console.log("❌ [Repositories] Excluding repo with corrupted entity 'gittr.space':", {
            repo: repoName,
            ownerPubkey: (r as any).ownerPubkey?.slice(0, 16),
            nostrEventId: (r as any).nostrEventId?.slice(0, 16),
            lastNostrEventId: (r as any).lastNostrEventId?.slice(0, 16)
          });
          return false; // Always exclude - these are corrupted
        }
        
        if (!r.entity || r.entity === "user") {
          const repoName = r.repo || r.slug || r.name || "";
          if (repoName.toLowerCase() === "tides") {
            console.log("❌ [Repositories] tides excluded - invalid entity:", r.entity);
          }
          return false;
        }
        
        // CRITICAL: Entity must be npub format (starts with "npub")
        // Domain names like "gittr.space" are NOT valid entities
        if (!r.entity.startsWith("npub")) {
          const repoName = r.repo || r.slug || r.name || "";
          console.log("❌ [Repositories] Excluding repo with invalid entity format (not npub):", {
            repo: repoName,
            entity: r.entity,
            ownerPubkey: (r as any).ownerPubkey?.slice(0, 16)
          });
          return false; // Only npub format is valid
        }
        
        const repoName = r.repo || r.slug || r.name || "";
        const isTides = repoName.toLowerCase() === "tides";
        
        if (isTides) {
          // Try to decode npub to show pubkey in logs
          let decodedEntityPubkey: string | null = null;
          if (r.entity?.startsWith("npub")) {
            try {
              const decoded = nip19.decode(r.entity);
              if (decoded.type === "npub") {
                decodedEntityPubkey = decoded.data as string;
              }
            } catch {}
          }
          console.log("🔍 [Repositories] Filtering tides repo - START:", {
            entity: r.entity,
            entityLength: r.entity?.length,
            entityIsNpub: r.entity?.startsWith("npub"),
            decodedEntityPubkey: decodedEntityPubkey?.slice(0, 16),
            ownerPubkey: (r as any).ownerPubkey?.slice(0, 16),
            ownerPubkeyLength: (r as any).ownerPubkey?.length,
            ownerPubkeyIs64Char: (r as any).ownerPubkey?.length === 64,
            currentUserPubkey: pubkey?.slice(0, 16),
            currentUserPubkeyLength: pubkey?.length,
            hasContributors: !!(r.contributors && Array.isArray(r.contributors)),
            contributorsCount: r.contributors?.length || 0,
            ownerContributor: r.contributors?.find((c: any) => c.weight === 100),
          });
        }
        
        // Priority 1: Check direct ownerPubkey match (most reliable)
        if ((r as any).ownerPubkey && typeof (r as any).ownerPubkey === "string") {
          const ownerPubkey = (r as any).ownerPubkey;
          if (ownerPubkey.toLowerCase() === pubkey.toLowerCase()) {
            if (isTides) console.log("✅ [Repositories] tides matched by direct ownerPubkey:", ownerPubkey.slice(0, 8));
            return true;
          }
        }
        
        // Priority 2: Check getRepoOwnerPubkey (uses ownerPubkey or contributors)
        const repoOwnerPubkey = getRepoOwnerPubkey(r as any, r.entity);
        if (repoOwnerPubkey && repoOwnerPubkey.toLowerCase() === pubkey.toLowerCase()) {
          if (isTides) console.log("✅ [Repositories] tides matched by repoOwnerPubkey:", repoOwnerPubkey.slice(0, 8));
          return true;
        }
        
        // Priority 3: Check entity match (npub format - decode and compare)
        if (r.entity && r.entity.startsWith("npub")) {
          try {
            const decoded = nip19.decode(r.entity);
            if (decoded.type === "npub") {
              const entityPubkey = decoded.data as string;
              if (entityPubkey.toLowerCase() === pubkey.toLowerCase()) {
                if (isTides) console.log("✅ [Repositories] tides matched by npub entity:", r.entity);
                return true;
              } else {
                if (isTides) console.log("❌ [Repositories] tides - npub entity decoded but pubkey doesn't match:", {
                  entity: r.entity,
                  decodedPubkey: entityPubkey.slice(0, 16),
                  currentUserPubkey: pubkey.slice(0, 16),
                });
              }
            }
          } catch (e) {
            if (isTides) console.log("❌ [Repositories] tides - invalid npub format:", r.entity, e);
          }
        } else if (r.entity) {
          if (isTides) console.log("❌ [Repositories] tides - entity is not npub format:", {
            entity: r.entity,
            entityLength: r.entity?.length,
            entityIsNpub: r.entity?.startsWith("npub"),
          });
        }
        
        // Priority 4: Check contributors for owner with matching pubkey
        if (r.contributors && Array.isArray(r.contributors)) {
          const ownerContributor = r.contributors.find((c: any) => 
            c.pubkey && 
            typeof c.pubkey === "string" &&
            c.pubkey.toLowerCase() === pubkey.toLowerCase() && 
            (c.weight === 100 || c.role === "owner")
          );
          if (ownerContributor) {
            if (isTides) console.log("✅ [Repositories] tides matched by contributor:", ownerContributor);
            return true;
          } else {
            if (isTides) {
              const allContributors = r.contributors.map((c: any) => ({
                pubkey: c.pubkey?.slice(0, 16),
                pubkeyLength: c.pubkey?.length,
                weight: c.weight,
                role: c.role,
              }));
              console.log("❌ [Repositories] tides - no matching contributor found. All contributors:", allContributors);
            }
          }
        } else {
          if (isTides) console.log("❌ [Repositories] tides - no contributors array");
        }
        
        if (isTides) {
          console.log("❌ [Repositories] tides NOT matched - all checks failed:", {
            entity: r.entity,
            repoOwnerPubkey: repoOwnerPubkey?.slice(0, 16),
            directOwnerPubkey: (r as any).ownerPubkey?.slice(0, 16),
            currentUser: pubkey.slice(0, 16),
            hasContributors: !!(r.contributors && Array.isArray(r.contributors)),
            ownerContributor: r.contributors?.find((c: any) => c.weight === 100),
          });
        }
        return false;
      });
      
      // Get repo activities for current user
      const repoActivitiesForSync = getUserActivities(pubkey).filter(a => a.type === "repo_created" || a.type === "repo_imported");
      
      // Debug: Check for tides in activities
      const tidesActivity = repoActivitiesForSync.find(a => {
        const [activityEntity, activityRepo] = (a.repo || "").split('/');
        return activityRepo && activityRepo.toLowerCase() === "tides";
      });
      if (tidesActivity) {
        console.log("🔍 [Repositories] Found tides in activities:", {
          type: tidesActivity.type,
          repo: tidesActivity.repo,
          entity: tidesActivity.entity,
          user: tidesActivity.user?.slice(0, 8),
        });
      } else {
        console.log("⚠️ [Repositories] tides NOT found in activities");
      }
      
      // Check if any activities don't have corresponding repos
      const missingRepos = repoActivitiesForSync.filter(activity => {
        if (!activity.repo) return false;
        const [activityEntity, activityRepo] = activity.repo.split('/');
        const found = userReposList.some((r: any) => {
          const rEntity = r.entity || "";
          const rRepo = r.repo || r.slug || "";
          return rEntity === activityEntity && rRepo === activityRepo;
        });
        if (!found && activityRepo && activityRepo.toLowerCase() === "tides") {
          console.log("⚠️ [Repositories] tides activity found but repo missing from userReposList");
        }
        return !found;
      });
      
      if (missingRepos.length > 0) {
        console.log(`⚠️ [Repositories] Found ${missingRepos.length} repo activities without matching repos (${userReposList.length} already found). Syncing missing ones...`);
      }
      
      if (missingRepos.length > 0) {
        console.log(`⚠️ [Repositories] Found ${missingRepos.length} repo activities without matching repos (${userReposList.length} already found). Syncing missing ones...`);
        
        const syncedRepos: any[] = [];
        missingRepos.forEach((activity) => {
          if (!activity.repo || !activity.entity) return;
          
          const [activityEntity, activityRepo] = activity.repo.split('/');
          if (!activityEntity || !activityRepo) return;
          
          // Check if we've already synced this repo in this session
          const syncKey = `${activityEntity}/${activityRepo}`;
          if (syncedFromActivitiesRef.current.has(syncKey)) {
            return; // Already synced, skip
          }
          
          // CRITICAL: Use findRepoByEntityAndName to handle npub format matching
          // This ensures we don't create duplicates when entity formats differ
          // Also check in userReposList (already filtered) to avoid duplicates
          const existingRepo = findRepoByEntityAndName(allRepos, activityEntity, activityRepo);
          const existsInAllRepos = !!existingRepo;
          
          // Also check if it's already in userReposList (might have been added but filtered out)
          const existsInUserRepos = userReposList.some((r: any) => {
            const rEntity = r.entity || "";
            const rRepo = r.repo || r.slug || "";
            return rEntity === activityEntity && rRepo === activityRepo;
          });
          
          const exists = existsInAllRepos || existsInUserRepos;
          
          if (!exists) {
            console.log(`📦 [Repositories] Syncing missing repo from activity: ${activityRepo}`, {
              activityEntity,
              activityRepo,
              activityUser: activity.user?.slice(0, 8),
            });
            
            // CRITICAL: Resolve ownerPubkey from activity data
            let ownerPubkey = activity.user; // Start with activity.user (should be full pubkey)
            
            // CRITICAL: Only handle npub format or full 64-char pubkey - NO 8-char prefixes
            if (activityEntity.startsWith("npub")) {
              try {
                const decoded = nip19.decode(activityEntity);
                if (decoded.type === "npub") {
                  ownerPubkey = decoded.data as string; // Use decoded pubkey as owner
                }
              } catch {}
            } else if (/^[0-9a-f]{64}$/i.test(activityEntity)) {
              // If activityEntity is already a full pubkey, use it
              ownerPubkey = activityEntity;
            }
            
            // CRITICAL: Ensure ownerPubkey is valid (64-char hex)
            if (!ownerPubkey || !/^[0-9a-f]{64}$/i.test(ownerPubkey)) {
              // If we still don't have a valid ownerPubkey, use current user's pubkey if available
              if (pubkey && /^[0-9a-f]{64}$/i.test(pubkey)) {
                ownerPubkey = pubkey;
              } else {
                console.warn(`⚠️ [Repositories] Cannot resolve ownerPubkey for ${activityRepo}, skipping sync`);
                return; // Skip this repo if we can't resolve owner
              }
            }
            
            // CRITICAL: Ensure entity is in npub format (GRASP protocol standard)
            let entityNpub = activityEntity;
            if (!activityEntity.startsWith("npub")) {
              // Convert to npub if not already
              try {
                entityNpub = nip19.npubEncode(ownerPubkey);
              } catch (e) {
                console.error(`Failed to encode npub for ${activityRepo}:`, e);
                entityNpub = activityEntity; // Fallback to original
              }
            }
            
            const syncedRepo: any = {
              slug: activityRepo,
              entity: entityNpub, // Use npub format
              repo: activityRepo,
              name: activity.repoName || activityRepo,
              ownerPubkey: ownerPubkey, // Always set to full 64-char pubkey
              contributors: [{ pubkey: ownerPubkey, weight: 100, role: "owner" }], // Ensure owner is in contributors
              createdAt: activity.timestamp,
              description: activity.metadata?.description,
            };
            
            // CRITICAL: Log synced repo structure for tides
            if (activityRepo.toLowerCase() === "tides") {
              console.log("✅ [Repositories] Synced tides repo structure:", {
                entity: syncedRepo.entity,
                entityIsNpub: syncedRepo.entity?.startsWith("npub"),
                ownerPubkey: syncedRepo.ownerPubkey?.slice(0, 16),
                ownerPubkeyLength: syncedRepo.ownerPubkey?.length,
                ownerPubkeyIs64Char: syncedRepo.ownerPubkey?.length === 64,
                currentUserPubkey: pubkey?.slice(0, 16),
                ownerMatches: pubkey && syncedRepo.ownerPubkey ? syncedRepo.ownerPubkey.toLowerCase() === pubkey.toLowerCase() : false,
                hasContributors: !!(syncedRepo.contributors && Array.isArray(syncedRepo.contributors)),
                contributorsCount: syncedRepo.contributors?.length || 0,
                ownerContributor: syncedRepo.contributors?.find((c: any) => c.weight === 100),
              });
            }
            
            syncedRepos.push(syncedRepo);
            allRepos.push(syncedRepo);
            syncedFromActivitiesRef.current.add(syncKey); // Mark as synced
          }
        });
        
        if (syncedRepos.length > 0) {
          console.log(`✅ [Repositories] Synced ${syncedRepos.length} repos from activities to localStorage`);
          localStorage.setItem("gittr_repos", JSON.stringify(allRepos));
          
          // CRITICAL: Don't call setRepos directly - let loadRepos() handle filtering
          // This ensures repos are properly filtered and displayed
          setTimeout(() => {
            loadRepos();
          }, 100);
        }
      }
    } catch (error) {
      console.error("Failed to sync repos from activities:", error);
    }
  }, [pubkey]); // CRITICAL: Only run when pubkey changes, NOT when repos.length changes (prevents infinite loop)
  
  // CRITICAL: Show loading state during SSR or before mount, but don't return early (all hooks must be called)
  if (typeof window === 'undefined' || !mounted) {
    return (
      <div className="container mx-auto max-w-[95%] xl:max-w-[90%] 2xl:max-w-[85%] p-6">
        <div className="flex justify-between items-center mb-4">
          <h1 className="text-2xl font-bold">Your repositories</h1>
        </div>
        <p className="text-gray-400">Loading...</p>
      </div>
    );
  }
  
  return (
    <div className="container mx-auto max-w-[95%] xl:max-w-[90%] 2xl:max-w-[85%] p-6">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-bold">Your repositories</h1>
        <div className="flex items-center gap-2">
          {syncing && <span className="text-xs text-gray-400">Syncing from Nostr...</span>}
          <button
            onClick={() => setShowClearConfirm(true)}
            className="border border-purple-500/50 bg-purple-900/20 hover:bg-purple-900/30 text-purple-300 px-3 py-1 rounded transition-colors"
            title="Clear all locally stored repositories and related data (files, issues, PRs, commits) from localStorage. Repos published to Nostr will be re-synced. ⚠️ Recommended to run this regularly to free up browser storage space."
          >
            Clear Local Repos
          </button>
          
          {pubkey && (
            <button
              onClick={() => setShowClearForeignConfirm(true)}
              className="border border-orange-500/50 bg-orange-900/20 hover:bg-orange-900/30 text-orange-300 px-3 py-1 rounded transition-colors"
              title="Clear all foreign repositories (repos you don't own) and their related data from localStorage. Your own repos will be kept. ⚠️ Recommended to run this regularly to free up browser storage space."
            >
              Clear Foreign Repos
            </button>
          )}
          
          {/* Clear Foreign Repos Confirmation Modal */}
          {showClearForeignConfirm && (
            <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={() => setShowClearForeignConfirm(false)}>
              <div className="bg-[#0E1116] border border-[#383B42] rounded-lg p-6 max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
                <h2 className="text-xl font-bold mb-4 text-orange-400">⚠️ Clear Foreign Repositories</h2>
                
                <div className="space-y-4 mb-6">
                  <div className="bg-yellow-900/20 border border-yellow-600/50 rounded p-4">
                    <p className="font-semibold text-yellow-300 mb-2">What will be deleted:</p>
                    <ul className="list-disc list-inside space-y-1 text-sm text-yellow-200/90">
                      <li>All repositories you don't own (foreign repos)</li>
                      <li>All imported files, issues, PRs, and commits for foreign repos</li>
                      <li>All local data for repos owned by other users</li>
                    </ul>
                  </div>
                  
                  <div className="bg-green-900/20 border border-green-600/50 rounded p-4">
                    <p className="font-semibold text-green-300 mb-2">✅ What will NOT be deleted:</p>
                    <ul className="list-disc list-inside space-y-1 text-sm text-green-200/90">
                      <li>Your own repositories (repos you own)</li>
                      <li>All data for your own repos (files, issues, PRs, commits)</li>
                      <li>Any data stored on the Nostr network</li>
                    </ul>
                  </div>
                  
                  <div className="bg-blue-900/20 border border-blue-600/50 rounded p-4">
                    <p className="font-semibold text-blue-300 mb-2">When to use this:</p>
                    <ul className="list-disc list-inside space-y-1 text-sm text-blue-200/90">
                      <li>To free up browser storage space</li>
                      <li>To remove repos you've browsed but don't own</li>
                      <li>To clean up imported/explored repos</li>
                      <li>To keep only your own repositories locally</li>
                    </ul>
                  </div>
                  
                  <div className="bg-red-900/20 border border-red-600/50 rounded p-4">
                    <p className="font-semibold text-red-300 mb-2">⚠️ Important:</p>
                    <p className="text-sm text-red-200/90">
                      This action cannot be undone. Foreign repos will be removed from localStorage. You can always re-browse them later, but any local changes or data will be lost.
                    </p>
                    <p className="text-sm text-yellow-200/90 mt-2">
                      💡 <strong>Tip:</strong> Running this regularly (e.g., weekly) helps free up browser storage space and keeps your local data clean.
                    </p>
                  </div>
                </div>
                
                <div className="flex gap-3 justify-end">
                  <button
                    onClick={() => setShowClearForeignConfirm(false)}
                    className="border border-[#383B42] bg-[#22262C] hover:bg-[#2a2e35] px-4 py-2 rounded transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      if (!pubkey) {
                        alert("Error: Not logged in. Cannot identify foreign repos.");
                        setShowClearForeignConfirm(false);
                        return;
                      }

                      try {
                        if (typeof window === 'undefined') return; // Don't access localStorage during SSR
                        // Load all repos
                        const allRepos = JSON.parse(localStorage.getItem("gittr_repos") || "[]") as any[];
                        
                        console.log(`🔍 [Clear Foreign Repos] Starting with ${allRepos.length} total repos`);
                        
                        // Filter to keep only repos owned by current user
                        // Use the SAME logic as the display filter to ensure consistency
                        const userRepos = allRepos.filter((repo: any) => {
                          // Priority 1: Check direct ownerPubkey match (most reliable)
                          const directOwnerPubkey = repo.ownerPubkey;
                          if (directOwnerPubkey && directOwnerPubkey.toLowerCase() === pubkey.toLowerCase()) {
                            return true;
                          }
                          
                          // Priority 2: Check via getRepoOwnerPubkey (uses ownerPubkey or contributors)
                          const repoOwnerPubkey = getRepoOwnerPubkey(repo, repo.entity);
                          if (repoOwnerPubkey && repoOwnerPubkey.toLowerCase() === pubkey.toLowerCase()) {
                            return true;
                          }
                          
                          // Priority 3: Check contributors for owner with matching pubkey
                          if (repo.contributors && Array.isArray(repo.contributors)) {
                            const ownerContributor = repo.contributors.find((c: any) => 
                              c.pubkey && c.pubkey.toLowerCase() === pubkey.toLowerCase() && 
                              (c.weight === 100 || c.role === "owner")
                            );
                            if (ownerContributor) return true;
                          }
                          
                          // Priority 4: Check if entity (npub format) matches current user's pubkey
                          if (repo.entity && repo.entity.startsWith("npub")) {
                            try {
                              const decoded = nip19.decode(repo.entity);
                              if (decoded.type === "npub") {
                                const entityPubkey = decoded.data as string;
                                if (entityPubkey.toLowerCase() === pubkey.toLowerCase()) {
                                  // Additional check: ensure ownerPubkey matches if it exists
                                  if (directOwnerPubkey && directOwnerPubkey.toLowerCase() !== pubkey.toLowerCase()) {
                                    return false;
                                  }
                                  return true;
                                }
                              }
                            } catch {}
                          }
                          
                          return false;
                        });

                        // Get list of foreign repos for cleanup
                        const foreignRepos = allRepos.filter((repo: any) => {
                          // Use the same logic as userRepos filter (inverse)
                          const directOwnerPubkey = repo.ownerPubkey;
                          if (directOwnerPubkey && directOwnerPubkey.toLowerCase() === pubkey.toLowerCase()) {
                            return false;
                          }
                          
                          const repoOwnerPubkey = getRepoOwnerPubkey(repo, repo.entity);
                          if (repoOwnerPubkey && repoOwnerPubkey.toLowerCase() === pubkey.toLowerCase()) {
                            return false;
                          }
                          
                          if (repo.contributors && Array.isArray(repo.contributors)) {
                            const ownerContributor = repo.contributors.find((c: any) => 
                              c.pubkey && c.pubkey.toLowerCase() === pubkey.toLowerCase() && 
                              (c.weight === 100 || c.role === "owner")
                            );
                            if (ownerContributor) return false;
                          }
                          
                          if (repo.entity && repo.entity.startsWith("npub")) {
                            try {
                              const decoded = nip19.decode(repo.entity);
                              if (decoded.type === "npub") {
                                const entityPubkey = decoded.data as string;
                                if (entityPubkey.toLowerCase() === pubkey.toLowerCase()) {
                                  if (directOwnerPubkey && directOwnerPubkey.toLowerCase() !== pubkey.toLowerCase()) {
                                    return true; // Foreign if ownerPubkey doesn't match
                                  }
                                  return false; // Own repo
                                }
                              }
                            } catch {}
                          }
                          
                          // Repos without owner are considered foreign
                          return true;
                        });
                        
                        console.log(`🔍 [Clear Foreign Repos] Ownership check results:`, {
                          totalRepos: allRepos.length,
                          userRepos: userRepos.length,
                          foreignRepos: foreignRepos.length,
                          currentUserPubkey: pubkey.slice(0, 8) + "...",
                        });

                        // Save only user's repos
                        localStorage.setItem("gittr_repos", JSON.stringify(userRepos));

                        // Collect foreign repo identifiers for cleanup
                        // Use the same key format as getRepoStorageKey: prefix__entity__repo
                        const foreignRepoKeyPatterns: string[] = [];
                        foreignRepos.forEach((repo: any) => {
                          const entity = repo.entity || repo.slug?.split("/")[0] || "";
                          const repoName = repo.repo || repo.slug?.split("/")[1] || repo.name || repo.slug || "";
                          if (entity && repoName) {
                            // Build key pattern using getRepoStorageKey format
                            // This ensures we match the exact format used in storage
                            const testKey = getRepoStorageKey("gittr_test", entity, repoName);
                            // Extract the entity__repo part (after "gittr_test__")
                            const pattern = testKey.replace("gittr_test__", "");
                            foreignRepoKeyPatterns.push(pattern);
                            
                            // Also add raw entity/repo for legacy keys (just in case)
                            foreignRepoKeyPatterns.push(`${entity}__${repoName}`);
                            foreignRepoKeyPatterns.push(`${entity}_${repoName}`);
                          }
                        });

                        // Clear all separate storage keys for foreign repos
                        const keysToRemove: string[] = [];
                        for (let i = 0; i < localStorage.length; i++) {
                          const key = localStorage.key(i);
                          if (!key) continue;

                          // Check if this key is for a foreign repo
                          // Keys use format: prefix__entity__repo (double underscore separators)
                          let isForeignRepoKey = false;
                          for (const pattern of foreignRepoKeyPatterns) {
                            // Match keys that contain the entity__repo pattern
                            // Format: gittr_*__entity__repo or gittr_*_entity_repo (legacy)
                            if (
                              key.includes(`__${pattern}`) || // Standard format: prefix__entity__repo
                              key.includes(`_${pattern.replace("__", "_")}`) ||  // Legacy format with single underscore
                              key.includes(`/${pattern.replace("__", "/")}`) // URL format
                            ) {
                              // Verify it's a repo-related key
                              if (
                                key.startsWith("gittr_files__") ||
                                key.startsWith("gittr_issues__") ||
                                key.startsWith("gittr_prs__") ||
                                key.startsWith("gittr_commits__") ||
                                key.startsWith("gittr_releases__") ||
                                key.startsWith("gittr_discussions__") ||
                                key.startsWith("gittr_milestones_") ||
                                key.startsWith("gittr_overrides__") ||
                                key.startsWith("gittr_repo_overrides__") ||
                                key.startsWith("gittr_accumulated_zaps_") ||
                                key.includes("gittr_issue_comments_")
                              ) {
                                isForeignRepoKey = true;
                                break;
                              }
                            }
                          }
                          
                          if (isForeignRepoKey) {
                            keysToRemove.push(key);
                          }
                        }

                        keysToRemove.forEach(key => localStorage.removeItem(key));

                        const foreignCount = foreignRepos.length;
                        const totalCleared = keysToRemove.length;
                        console.log(`✅ Cleared ${foreignCount} foreign repos and ${totalCleared} related storage keys from localStorage`);

                        setShowClearForeignConfirm(false);

                        // Show success feedback
                        alert(`✅ Successfully cleared!\n\n• Removed ${foreignCount} foreign repositories\n• Removed ${totalCleared} related storage keys (files, issues, PRs, commits)\n• Kept ${userRepos.length} of your own repositories\n\nForeign repos can be re-browsed from Nostr relays.`);

                        loadRepos();
                        window.location.reload();
                      } catch (error) {
                        console.error("Failed to clear foreign repos:", error);
                        alert(`❌ Error clearing foreign repos: ${error}`);
                        setShowClearForeignConfirm(false);
                      }
                    }}
                    className="border border-orange-500/50 bg-orange-900/20 hover:bg-orange-900/30 text-orange-300 px-4 py-2 rounded transition-colors font-semibold"
                  >
                    Yes, Clear Foreign Repos
                  </button>
                </div>
              </div>
            </div>
          )}
          
          {/* Clear Local Repos Confirmation Modal */}
          {showClearConfirm && (
            <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={() => setShowClearConfirm(false)}>
              <div className="bg-[#0E1116] border border-[#383B42] rounded-lg p-6 max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
                <h2 className="text-xl font-bold mb-4 text-red-400">⚠️ Clear Local Repositories</h2>
                
                <div className="space-y-4 mb-6">
                  <div className="bg-yellow-900/20 border border-yellow-600/50 rounded p-4">
                    <p className="font-semibold text-yellow-300 mb-2">What will be deleted:</p>
                    <ul className="list-disc list-inside space-y-1 text-sm text-yellow-200/90">
                      <li>All local repositories (not yet pushed to Nostr)</li>
                      <li>All imported files, issues, PRs, and commits stored locally</li>
                      <li>All local edits and changes not yet published</li>
                    </ul>
                  </div>
                  
                  <div className="bg-green-900/20 border border-green-600/50 rounded p-4">
                    <p className="font-semibold text-green-300 mb-2">✅ What will NOT be deleted:</p>
                    <ul className="list-disc list-inside space-y-1 text-sm text-green-200/90">
                      <li>Repositories published to Nostr (they will be re-synced from relays)</li>
                      <li>Any data stored on the Nostr network</li>
                    </ul>
                  </div>
                  
                  <div className="bg-blue-900/20 border border-blue-600/50 rounded p-4">
                    <p className="font-semibold text-blue-300 mb-2">When to use this:</p>
                    <ul className="list-disc list-inside space-y-1 text-sm text-blue-200/90">
                      <li>To free up browser storage space</li>
                      <li>To reset local data and re-sync from Nostr</li>
                      <li>To remove corrupted local data</li>
                      <li>To start fresh after testing or development</li>
                    </ul>
                  </div>
                  
                  <div className="bg-red-900/20 border border-red-600/50 rounded p-4">
                    <p className="font-semibold text-red-300 mb-2">⚠️ Important:</p>
                    <p className="text-sm text-red-200/90">
                      This action cannot be undone for local repositories. Any repos that haven't been pushed to Nostr will be permanently lost.
                    </p>
                    <p className="text-sm text-yellow-200/90 mt-2">
                      💡 <strong>Tip:</strong> Running this regularly (e.g., weekly) helps free up browser storage space and keeps your local data clean.
                    </p>
                  </div>
                </div>
                
                <div className="flex gap-3 justify-end">
                  <button
                    onClick={() => setShowClearConfirm(false)}
                    className="border border-[#383B42] bg-[#22262C] hover:bg-[#2a2e35] px-4 py-2 rounded transition-colors"
                  >
                    Cancel
                  </button>
          <button
            onClick={() => {
                // Clear main repo storage
                localStorage.removeItem("gittr_repos");
                localStorage.removeItem("gittr_deleted_repos");
                localStorage.removeItem("gittr_activities");
                
                // Clear all separate storage keys (files, issues, PRs, commits)
                const keysToRemove: string[] = [];
                for (let i = 0; i < localStorage.length; i++) {
                  const key = localStorage.key(i);
                  if (key && (
                    key.startsWith("gittr_files__") ||
                    key.startsWith("gittr_issues__") ||
                    key.startsWith("gittr_prs__") ||
                    key.startsWith("gittr_commits__")
                  )) {
                    keysToRemove.push(key);
                  }
                }
                
                keysToRemove.forEach(key => localStorage.removeItem(key));
                
                const totalCleared = keysToRemove.length;
                console.log(`✅ Cleared all locally stored repos and ${totalCleared} separate storage keys from localStorage`);
                      
                      setShowClearConfirm(false);
                
                // Show success feedback
                alert(`✅ Successfully cleared!\n\n• Removed all local repositories\n• Removed ${totalCleared} separate storage keys (files, issues, PRs, commits)\n\nRepos published to Nostr will be re-synced from relays.`);
                
                loadRepos();
                window.location.reload();
            }}
                    className="border border-red-500/50 bg-red-900/20 hover:bg-red-900/30 text-red-300 px-4 py-2 rounded transition-colors font-semibold"
          >
                    Yes, Clear Local Data
          </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="space-y-2">
        {repos.filter(r => {
          // CRITICAL: "Your repositories" should ONLY show repos owned by the current user
          if (!pubkey) return false; // Not logged in = no repos
          
          // Priority 1: Check direct ownerPubkey match (most reliable)
          if ((r as any).ownerPubkey && (r as any).ownerPubkey.toLowerCase() === pubkey.toLowerCase()) return true;
          
          // Priority 2: Check via getRepoOwnerPubkey (uses ownerPubkey or contributors)
          const repoOwnerPubkey = getRepoOwnerPubkey(r as any, r.entity);
          if (repoOwnerPubkey && repoOwnerPubkey.toLowerCase() === pubkey.toLowerCase()) return true;
          
          // Priority 3: Check contributors for owner with matching pubkey
          if (r.contributors && Array.isArray(r.contributors)) {
            const ownerContributor = r.contributors.find((c: any) => 
              c.pubkey && c.pubkey.toLowerCase() === pubkey.toLowerCase() && 
              (c.weight === 100 || c.role === "owner")
            );
            if (ownerContributor) return true;
          }
          
          // Priority 4: Check if entity (npub format) matches current user's pubkey
          if (r.entity && r.entity.startsWith("npub")) {
            try {
              const decoded = nip19.decode(r.entity);
              if (decoded.type === "npub") {
                const entityPubkey = decoded.data as string;
                if (entityPubkey.toLowerCase() === pubkey.toLowerCase()) {
                  // Additional check: ensure ownerPubkey matches if it exists
                  if ((r as any).ownerPubkey && (r as any).ownerPubkey.toLowerCase() !== pubkey.toLowerCase()) return false;
                  return true;
                }
              }
            } catch {}
          }
          
          return false;
        }).length === 0 && <p>No repositories yet.</p>}
        {(() => {
          // Load list of locally-deleted repos (user deleted them, don't show)
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
          
          // Filter, sort, and deduplicate repos
          const filtered = repos.filter(r => {
            // CRITICAL: Exclude repos with "gittr.space" entity FIRST (before any other checks)
            // These are corrupted repos that should never exist
            if (r.entity === "gittr.space") {
              const repoName = r.repo || r.slug || r.name || "";
              console.log("❌ [Repositories] Filtering out corrupted repo with entity 'gittr.space':", {
                repo: repoName,
                ownerPubkey: (r as any).ownerPubkey?.slice(0, 16)
              });
              return false; // Always exclude - these are corrupted
            }
            
            // CRITICAL: Entity must be npub format (starts with "npub")
            // Domain names are NOT valid entities
            if (!r.entity || !r.entity.startsWith("npub")) {
              const repoName = r.repo || r.slug || r.name || "";
              console.log("❌ [Repositories] Filtering out repo with invalid entity format:", {
                repo: repoName,
                entity: r.entity,
                ownerPubkey: (r as any).ownerPubkey?.slice(0, 16)
              });
              return false; // Only npub format is valid
            }
            
            // CRITICAL: Filter out deleted repos FIRST (before ownership checks)
            // Skip if locally deleted (completely hidden - no note shown)
            if (isRepoDeleted(r)) return false;
            
            // Skip if owner marked as deleted/archived on Nostr (completely hidden - no note shown)
            if ((r as any).deleted === true || (r as any).archived === true) return false;
            
            // CRITICAL: "Your repositories" should ONLY show repos owned by the current user
            if (!pubkey) return false; // Not logged in = no repos
            
            const repoName = r.repo || r.slug || r.name || "";
            const repoOwnerPubkey = getRepoOwnerPubkey(r as any, r.entity);
            const directOwnerPubkey = (r as any).ownerPubkey;
            
            // Debug logging for tides repo
            if (repoName.toLowerCase() === "tides") {
              console.log("🔍 [Repositories] Filtering tides repo:", {
                repoName,
                entity: r.entity,
                repoOwnerPubkey: repoOwnerPubkey?.slice(0, 8),
                directOwnerPubkey: directOwnerPubkey?.slice(0, 8),
                currentUserPubkey: pubkey?.slice(0, 8),
                hasContributors: !!(r.contributors && Array.isArray(r.contributors)),
                ownerContributor: r.contributors?.find((c: any) => c.weight === 100),
              });
            }
            
            // Priority 1: Check direct ownerPubkey match (most reliable)
            if (directOwnerPubkey && directOwnerPubkey.toLowerCase() === pubkey.toLowerCase()) {
              if (repoName.toLowerCase() === "tides") console.log("✅ [Repositories] tides matched by direct ownerPubkey");
              return true;
            }
            
            // Priority 2: Check via getRepoOwnerPubkey (uses ownerPubkey or contributors)
            if (repoOwnerPubkey && repoOwnerPubkey.toLowerCase() === pubkey.toLowerCase()) {
              if (repoName.toLowerCase() === "tides") console.log("✅ [Repositories] tides matched by repoOwnerPubkey");
              return true;
            }
            
            // Priority 3: Check contributors for owner with matching pubkey
            if (r.contributors && Array.isArray(r.contributors)) {
              const ownerContributor = r.contributors.find((c: any) => 
                c.pubkey && c.pubkey.toLowerCase() === pubkey.toLowerCase() && 
                (c.weight === 100 || c.role === "owner")
              );
              if (ownerContributor) {
                if (repoName.toLowerCase() === "tides") console.log("✅ [Repositories] tides matched by contributor");
                return true;
              }
            }
            
            // Priority 4: Check if entity (npub format) matches current user's pubkey (fallback)
            if (r.entity && r.entity.startsWith("npub")) {
              try {
                const decoded = nip19.decode(r.entity);
                if (decoded.type === "npub") {
                  const entityPubkey = decoded.data as string;
                  if (entityPubkey.toLowerCase() === pubkey.toLowerCase()) {
                    // Additional check: ensure ownerPubkey matches if it exists
                    if (directOwnerPubkey && directOwnerPubkey.toLowerCase() !== pubkey.toLowerCase()) {
                      if (repoName.toLowerCase() === "tides") console.log("❌ [Repositories] tides excluded - npub entity matches but ownerPubkey doesn't");
                      return false;
                    }
                    if (repoName.toLowerCase() === "tides") console.log("✅ [Repositories] tides matched by npub entity");
                    return true;
                  }
                }
              } catch (e) {
                if (repoName.toLowerCase() === "tides") console.log("❌ [Repositories] tides - failed to decode npub entity:", r.entity);
              }
            }
            
            // Filter out repos without valid entity (npub format required)
            if (!r.entity || r.entity === "user" || !r.entity.startsWith("npub")) {
              // Try one more time to migrate if user is now logged in AND repo belongs to them
              if (isLoggedIn && userName && userName !== "Anonymous Nostrich" && pubkey) {
                // CRITICAL: Only migrate if repo belongs to current user (check ownerPubkey)
                const isUserRepo = (r as any).ownerPubkey === pubkey || 
                  (r.contributors && r.contributors.some((c: any) => c.pubkey === pubkey && c.weight === 100));
                
                if (isUserRepo) {
                  // Use npub format for entity (GRASP protocol standard)
                  let entityNpub: string;
                  try {
                    entityNpub = nip19.npubEncode(pubkey);
                  } catch (e) {
                    console.error("Failed to encode npub for entity migration:", e);
                    return false; // Can't migrate without valid npub
                  }
                  const updated = repos.map(rr => rr === r ? { 
                    ...rr, 
                    entity: entityNpub, 
                    entityDisplayName: userName || entityNpub.slice(0, 12) + "...", // Use userName or shortened npub for display
                    ownerPubkey: pubkey // Ensure ownerPubkey is set
                  } : rr);
                  localStorage.setItem("gittr_repos", JSON.stringify(updated));
                  // Return true to show it this time, but it will be properly migrated next render
                  return false; // Still filter it out this render
                }
              }
              return false; // Filter out invalid repos
            }
            
            // All checks above should have caught it - if we get here, it's not the user's repo
            return false;
          });
          
          // CRITICAL: Sort by latest event date (lastNostrEventCreatedAt) if available, otherwise by createdAt
          // This ensures repos with recent updates appear first
          // Note: lastNostrEventCreatedAt is in SECONDS (NIP-34 format), createdAt/updatedAt are in MILLISECONDS
          const sorted = filtered.sort((a, b) => {
            // Get latest event date in milliseconds for comparison
            const aLatest = (a as any).lastNostrEventCreatedAt 
              ? (a as any).lastNostrEventCreatedAt * 1000 // Convert seconds to milliseconds
              : ((a as any).updatedAt || a.createdAt || 0);
            const bLatest = (b as any).lastNostrEventCreatedAt 
              ? (b as any).lastNostrEventCreatedAt * 1000 // Convert seconds to milliseconds
              : ((b as any).updatedAt || b.createdAt || 0);
            return bLatest - aLatest; // Newest first
          });
          
          // Deduplicate repos by entity/repo combination
          // CRITICAL: Merge local and Nostr versions intelligently:
          // - If both exist, merge them (preserve local logoUrl, keep Nostr metadata)
          // - Only show local version if it has unpushed edits
          const dedupeMap = new Map<string, any>();
          sorted.forEach((r: any) => {
            const entity = (r.entity || '').trim();
            const repo = (r.repo || r.slug || r.name || '').trim();
            // Normalize repo name for matching (handle variations like bitcoin_meetup_calendar vs bitcoin-meetup-calendar)
            const normalizedRepo = repo.toLowerCase().replace(/[_-]/g, '');
            const key = `${entity}/${normalizedRepo}`.toLowerCase(); // Case-insensitive comparison
            const existing = dedupeMap.get(key);
            
            if (!existing) {
              dedupeMap.set(key, r);
            } else {
              // Merge repos: preserve local logoUrl, keep Nostr metadata
              const status = getRepoStatus(r);
              const existingStatus = getRepoStatus(existing);
              
              // If one is local and one is live, merge them
              if ((status === "local" && (existingStatus === "live" || existingStatus === "live_with_edits")) ||
                  (existingStatus === "local" && (status === "live" || status === "live_with_edits"))) {
                // Merge: keep Nostr version as base, but preserve local logoUrl and unpushed edits
                const localVersion = status === "local" ? r : existing;
                const nostrVersion = status === "local" ? existing : r;
                
                const merged = {
                  ...nostrVersion, // Use Nostr version as base (has all metadata)
                  // Preserve local logoUrl if it exists and is different from Nostr
                  logoUrl: localVersion.logoUrl || nostrVersion.logoUrl,
                  // Preserve local unpushed edits flag
                  hasUnpushedEdits: localVersion.hasUnpushedEdits || nostrVersion.hasUnpushedEdits,
                  // Keep the most recent modification time
                  lastModifiedAt: Math.max(localVersion.lastModifiedAt || 0, nostrVersion.lastModifiedAt || 0),
                  // Keep both event IDs if they exist
                  nostrEventId: nostrVersion.nostrEventId || localVersion.nostrEventId,
                  lastNostrEventId: nostrVersion.lastNostrEventId || localVersion.lastNostrEventId,
                  // Preserve local status if it has unpushed edits
                  status: (localVersion.hasUnpushedEdits || (localVersion.lastModifiedAt && nostrVersion.lastNostrEventCreatedAt && localVersion.lastModifiedAt > nostrVersion.lastNostrEventCreatedAt * 1000)) 
                    ? "live_with_edits" 
                    : (nostrVersion.status || "live"),
                };
                
                dedupeMap.set(key, merged);
              } else {
                // Both are same type, keep the most recent one
                if ((r.createdAt || 0) > (existing.createdAt || 0)) {
                  dedupeMap.set(key, r);
                }
              }
            }
          });
          
          const deduplicatedRepos = Array.from(dedupeMap.values());
          
          return deduplicatedRepos.map((r: any, index: number) => {
            // Entity is guaranteed to be valid here
            const entity = r.entity!;
            // CRITICAL: For URLs, use slugified version (repo/slug/repositoryName)
            // For display, use original name (r.name)
            const repoForUrl = r.repo || r.slug || "unnamed-repo";
            const displayName = r.name || repoForUrl; // CRITICAL: Use original name for display
            
            // CRITICAL: Resolve full owner pubkey for proper metadata fetching
            const ownerPubkey = getRepoOwnerPubkey(r, entity);
            
            // CRITICAL: Use npub format for URLs (GRASP protocol standard)
            // Convert ownerPubkey to npub format for consistent URLs
            let repoHref: string;
            
            if (ownerPubkey) {
              try {
                const npub = nip19.npubEncode(ownerPubkey);
                repoHref = `/${npub}/${repoForUrl}`;
              } catch (error) {
                console.error('⚠️ [Repositories] Failed to encode npub:', { ownerPubkey, error });
                // Fallback to entity format if npub encoding fails
                repoHref = `/${entity}/${repoForUrl}`;
              }
            } else {
              // Fallback if no ownerPubkey
              repoHref = `/${entity}/${repoForUrl}`;
            }
            
            // Fetch owner metadata using full pubkey
            const ownerMeta = ownerPubkey ? ownerMetadata[ownerPubkey] : undefined;
            
            // Use owner's Nostr metadata name if available, otherwise fallback to entity (npub format)
            // CRITICAL: Never use r.entityDisplayName - it might be wrong (set to current user's name)
            const entityDisplay = ownerMeta?.name || ownerMeta?.display_name || (entity.startsWith("npub") ? entity.slice(0, 12) + "..." : entity);
            
            // Resolve icon - this will update reactively when ownerMetadata changes
            const iconUrl = resolveRepoIcon(r);
            
            const status = getRepoStatus(r);
            const isLocal = status === "local" || status === "live_with_edits";
            const isPushing = pushingRepos.has(`${entity}/${repoForUrl}`);
            
            const repoKey = `${entity}/${repoForUrl}`;
            const isNavigating = clickedRepo === repoKey;
            
            return (
              <div 
                key={`${entity}/${repoForUrl}-${index}`} 
                className={`border p-3 transition-all duration-200 ${
                  isNavigating 
                    ? "bg-purple-500/20 border-purple-500/50 shadow-lg" 
                    : "hover:bg-white/5"
                }`}
              >
                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
                  <div
                    className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer"
                    onClick={(e) => {
                      // CRITICAL: Use window.location for immediate navigation (bypasses React completely)
                      // This ensures navigation happens instantly, even during heavy re-renders
                      e.preventDefault();
                      e.stopPropagation();
                      
                      // Set clicked state immediately for visual feedback
                      setClickedRepo(repoKey);
                      
                      // Navigate immediately using window.location (completely bypasses React)
                      window.location.href = repoHref;
                    }}
                  >
                    {/* Repo icon with fallback */}
                    {iconUrl ? (
                      <img 
                        src={iconUrl} 
                        alt="repo" 
                        className="h-6 w-6 rounded-sm object-contain flex-shrink-0"
                        onError={(e) => {
                          // Fallback to empty square on error
                          e.currentTarget.style.display = 'none';
                          const parent = e.currentTarget.parentElement;
                          if (parent && !parent.querySelector('.icon-fallback')) {
                            const fallback = document.createElement('span');
                            fallback.className = 'icon-fallback inline-block h-6 w-6 rounded-sm bg-[#22262C] flex-shrink-0';
                            parent.insertBefore(fallback, e.currentTarget);
                          }
                        }}
                      />
                    ) : (
                      <span className="inline-block h-6 w-6 rounded-sm bg-[#22262C] flex-shrink-0" />
                    )}
                    {/* Repo name and info - flex column to avoid wrapping issues */}
                    <div className="flex flex-col gap-1 min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <div className="font-semibold text-cyan-400 min-w-0 flex-1 flex items-center gap-2">
                          {isNavigating && (
                            <Loader2 className="h-4 w-4 animate-spin text-purple-400 flex-shrink-0" />
                          )}
                          <span className="truncate">{displayName}</span>
                          <span className="opacity-70 hidden sm:inline">/ {entityDisplay}</span>
                        </div>
                        {/* Status badge */}
                        {(() => {
                          const style = getStatusBadgeStyle(status);
                          return (
                            <span className={`text-xs px-2 py-0.5 rounded ${style.bg} ${style.text} flex-shrink-0`}>
                              {style.label}
                            </span>
                          );
                        })()}
                        <Badge variant="outline" className="text-xs flex items-center gap-1 flex-shrink-0">
                          {r.publicRead !== false ? (
                            <>
                              <Globe className="h-3 w-3" />
                              Public
                            </>
                          ) : (
                            <>
                              <Lock className="h-3 w-3" />
                              Private
                            </>
                          )}
                        </Badge>
                      </div>
                      {r.description && r.description.trim() ? (
                        <div className="text-sm opacity-70 line-clamp-2">
                          {r.description}
                        </div>
                      ) : r.sourceUrl ? (
                        <div className="text-sm opacity-70 whitespace-nowrap overflow-hidden text-ellipsis">
                          Imported from {r.sourceUrl}
                        </div>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:ml-4 flex-shrink-0 w-full sm:w-auto">
                    {/* Push button for local repos - only visible to owner */}
                    {isLocal && pubkey && isOwner(pubkey, r.contributors, r.ownerPubkey) && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={isPushing}
                        className="text-xs whitespace-nowrap w-full sm:w-auto"
                        onClick={async (e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          
                          if (!pubkey || !publish || !subscribe || !defaultRelays) {
                            alert("Please log in to push repositories");
                            return;
                          }
                          
                          try {
                            // Check for NIP-07 first (preferred method)
                            const hasNip07 = typeof window !== "undefined" && window.nostr;
                            let privateKey: string | undefined;
                            
                            if (!hasNip07) {
                              // Fallback to stored private key only if NIP-07 not available
                              privateKey = await getNostrPrivateKey() || undefined;
                              if (!privateKey) {
                                alert("No signing method available.\n\nPlease use a NIP-07 extension (like Alby or nos2x) or configure a private key in Settings.");
                                return;
                              }
                            }
                            
                            setPushingRepos(prev => new Set(prev).add(`${entity}/${repoForUrl}`));
                            
                            const result = await pushRepoToNostr({
                              repoSlug: repoForUrl,
                              entity,
                              publish,
                              subscribe,
                              defaultRelays,
                              privateKey, // Optional - will use NIP-07 if available
                              pubkey,
                              onProgress: (message) => {
                                console.log(`[Push ${repoForUrl}] ${message}`);
                              },
                            });
                            
                            if (result.success) {
                              const shouldAutoBridge = !r.sourceUrl;
                              if (
                                shouldAutoBridge &&
                                r.ownerPubkey &&
                                result.filesForBridge &&
                                result.filesForBridge.length > 0
                              ) {
                                try {
                                  await pushFilesToBridge({
                                    ownerPubkey: r.ownerPubkey.toLowerCase(),
                                    repoSlug: repoForUrl,
                                    entity,
                                    branch: r.defaultBranch || "main",
                                    files: result.filesForBridge,
                                  });
                                } catch (bridgeError: any) {
                                  console.error("Bridge sync failed:", bridgeError);
                                  alert(
                                    `⚠️ Repository event published but bridge sync failed: ${
                                      bridgeError?.message || bridgeError?.toString() || "Unknown error"
                                    }`
                                  );
                                }
                              }
                              // Reload repos to show updated status
                              const updatedRepos = JSON.parse(localStorage.getItem("gittr_repos") || "[]");
                              setRepos([...updatedRepos]);
                              
                              if (result.confirmed) {
                                alert(`✅ Repository pushed to Nostr!\nEvent ID: ${result.eventId?.slice(0, 16)}...`);
                              } else {
                                alert(`⚠️ Repository published but awaiting confirmation.\nEvent ID: ${result.eventId?.slice(0, 16)}...`);
                              }
                            } else {
                              alert(`❌ Failed to push: ${result.error}`);
                            }
                          } catch (error: any) {
                            console.error("Failed to push repo:", error);
                            alert(`Failed to push: ${error.message || "Unknown error"}`);
                          } finally {
                            setPushingRepos(prev => {
                              const next = new Set(prev);
                              next.delete(`${entity}/${repoForUrl}`);
                              return next;
                            });
                          }
                        }}
                      >
                        <Upload className="h-3 w-3 mr-1" />
                        {isPushing ? "Pushing..." : "Push to Nostr"}
                      </Button>
                    )}
                    <div className="opacity-70 text-xs sm:text-sm whitespace-nowrap">
                      {(r as any).lastNostrEventCreatedAt ? (
                        <>
                          <span className="hidden sm:inline">Last push: </span>
                          {formatDateTime24h((r as any).lastNostrEventCreatedAt * 1000)}
                        </>
                      ) : (r as any).lastPushAttempt ? (
                        <>
                          <span className="hidden sm:inline">Push attempted: </span>
                          {formatDateTime24h((r as any).lastPushAttempt)}
                        </>
                      ) : (r as any).lastModifiedAt ? (
                        <>
                          <span className="hidden sm:inline">Modified: </span>
                          {formatDateTime24h((r as any).lastModifiedAt)}
                        </>
                      ) : (
                        <>
                          <span className="hidden sm:inline">Created: </span>
                          {formatDateTime24h(r.createdAt)}
                        </>
                      )}
                    </div>
                </div>
                </div>
              </div>
            );
          });
        })()}
      </div>
    </div>
  );
}


