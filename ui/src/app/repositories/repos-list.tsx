"use client";

import { nip19 } from "nostr-tools";
import { Lock, Globe, Upload, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getRepoOwnerPubkey } from "@/lib/utils/entity-resolver";
import { getRepoStatus, getStatusBadgeStyle } from "@/lib/utils/repo-status";
import { formatDateTime24h } from "@/lib/utils/date-format";
import { pushRepoToNostr } from "@/lib/nostr/push-repo-to-nostr";
import { pushFilesToBridge } from "@/lib/nostr/push-to-bridge";
import { getNostrPrivateKey } from "@/lib/security/encryptedStorage";
import { isOwner } from "@/lib/repo-permissions";
import { isRepoCorrupted } from "@/lib/utils/repo-corruption-check";
// resolveRepoIcon is defined locally below

interface ReposListProps {
  repos: any[];
  pubkey: string | null;
  pushingRepos: Set<string>;
  setPushingRepos: (setter: (prev: Set<string>) => Set<string>) => void;
  clickedRepo: string | null;
  setClickedRepo: (repo: string | null) => void;
  publish?: (event: any, relays: string[]) => void;
  subscribe?: any;
  defaultRelays?: string[];
  ownerMetadata: Record<string, any>;
}

export function ReposList({
  repos,
  pubkey,
  pushingRepos,
  setPushingRepos,
  clickedRepo,
  setClickedRepo,
  publish,
  subscribe,
  defaultRelays,
  ownerMetadata,
}: ReposListProps) {
  // Function to resolve repo icon with priority (memoized to react to ownerMetadata changes):
  // 1. Stored logoUrl (user-set in repo settings)
  // 2. Logo file from repo (if files list has logo.*)
  // 3. Owner Nostr profile picture (last fallback)
  const resolveRepoIcon = (repo: any): string | null => {
    // Priority 1: Stored logoUrl
    if (repo.logoUrl && repo.logoUrl.trim().length > 0) {
      return repo.logoUrl;
    }
    
    // Priority 2: Logo file from repo (search all directories, handle multiple formats/names)
    if (repo.files && repo.files.length > 0) {
      const repoName = (repo.repo || repo.slug || repo.name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
      const imageExts = ["png", "jpg", "jpeg", "gif", "webp", "svg", "ico"];
      
      const iconFiles = repo.files
        .map((f: any) => f.path)
        .filter((p: string) => {
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
      
      if (iconFiles.length > 0) {
        // Prioritize logo files
        const prioritized = iconFiles.sort((a: string, b: string) => {
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
          const formatPriority: Record<string, number> = { png: 0, svg: 1, webp: 2, jpg: 3, jpeg: 3, gif: 4, ico: 5 };
          const aPrio = formatPriority[aExt] ?? 10;
          const bPrio = formatPriority[bExt] ?? 10;
          
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
        if (!ownerRepo && repo.clone && Array.isArray(repo.clone) && repo.clone.length > 0) {
          // Find first GitHub/GitLab/Codeberg URL in clone array
          const gitCloneUrl = repo.clone.find((url: string) => 
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
          const ownerPubkey = repo.entity ? getRepoOwnerPubkey(repo, repo.entity) : null;
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
            return `/api/nostr/repo/file-content?ownerPubkey=${encodeURIComponent(ownerPubkey)}&repo=${encodeURIComponent(repoName)}&path=${encodeURIComponent(logoPath)}&branch=${encodeURIComponent(branch)}`;
          }
        }
      }
    }
    
    // Priority 3: Owner Nostr profile picture (last fallback)
    const ownerPubkey = repo.entity ? getRepoOwnerPubkey(repo, repo.entity) : null;
    if (ownerPubkey && /^[0-9a-f]{64}$/i.test(ownerPubkey)) {
      const normalizedKey = ownerPubkey.toLowerCase();
      const metadata = ownerMetadata[normalizedKey] || ownerMetadata[ownerPubkey];
      if (metadata?.picture) {
        const picture = metadata.picture;
        if (picture && picture.trim().length > 0 && picture.startsWith("http")) {
          return picture;
        }
      }
    }
    
    return null;
  };
  
  // CRITICAL: Guard against SSR/localStorage access before component is ready
  if (typeof window === "undefined" || typeof localStorage === "undefined") {
    return (
      <div className="space-y-2">
        <p className="text-gray-400">Loading repositories...</p>
      </div>
    );
  }
  
  // Filter repos to only show user's repos
  const filteredRepos = repos.filter(r => {
    // CRITICAL: Exclude repos with "gittr.space" entity FIRST (before any other checks)
    // These are corrupted repos that should never exist
    if (r.entity === "gittr.space") {
      const repoName = r.repo || r.slug || r.name || "";
      console.log("❌ [ReposList] Excluding repo with corrupted entity 'gittr.space':", {
        repo: repoName,
        ownerPubkey: (r as any).ownerPubkey?.slice(0, 16)
      });
      return false; // Always exclude - these are corrupted
    }
    
    // CRITICAL: Entity must be npub format (starts with "npub")
    // Domain names are NOT valid entities
    if (!r.entity || !r.entity.startsWith("npub")) {
      const repoName = r.repo || r.slug || r.name || "";
      console.log("❌ [ReposList] Excluding repo with invalid entity format (not npub):", {
        repo: repoName,
        entity: r.entity,
        ownerPubkey: (r as any).ownerPubkey?.slice(0, 16)
      });
      return false; // Only npub format is valid
    }
    
    // CRITICAL: "Your repositories" should ONLY show repos owned by the current user
    if (!pubkey) return false; // Not logged in = no repos
    
    // Priority 1: Check direct ownerPubkey match (most reliable)
    if ((r as any).ownerPubkey && (r as any).ownerPubkey.toLowerCase() === pubkey.toLowerCase()) {
      return true;
    }
    
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
  });
  
  // Show "No repositories yet" if filtered list is empty
  if (filteredRepos.length === 0) {
    return (
      <div>
        <p>No repositories yet.</p>
      </div>
    );
  }
  
  // Load list of locally-deleted repos (user deleted them, don't show)
  const deletedRepos = JSON.parse(localStorage.getItem("gittr_deleted_repos") || "[]") as Array<{entity: string; repo: string; deletedAt: number; ownerPubkey?: string}>;
  
  // Helper function to check if repo is deleted (robust matching)
  const isRepoDeleted = (r: any): boolean => {
    const repo = r.repo || r.slug || "";
    const entity = r.entity || "";
    
    // Priority 1: Check by ownerPubkey (most reliable - works across all entity formats)
    if (r.ownerPubkey && /^[0-9a-f]{64}$/i.test(r.ownerPubkey)) {
      const ownerPubkey = r.ownerPubkey.toLowerCase();
      if (deletedRepos.some(d => {
        // Check by ownerPubkey field (if stored)
        if (d.ownerPubkey && d.ownerPubkey.toLowerCase() === ownerPubkey) {
          return d.repo.toLowerCase() === repo.toLowerCase();
        }
        // Check if deleted entity is npub for same pubkey
        if (d.entity.startsWith("npub")) {
          try {
            const dDecoded = nip19.decode(d.entity);
            if (dDecoded.type === "npub" && (dDecoded.data as string).toLowerCase() === ownerPubkey) {
              return d.repo.toLowerCase() === repo.toLowerCase();
            }
          } catch {}
        }
        // Check if deleted entity is pubkey format
        if (d.entity && /^[0-9a-f]{64}$/i.test(d.entity) && d.entity.toLowerCase() === ownerPubkey) {
          return d.repo.toLowerCase() === repo.toLowerCase();
        }
        return false;
      })) return true;
    }
    
    // Priority 2: Check direct match by entity (npub format)
    const repoKey = `${entity}/${repo}`.toLowerCase();
    if (deletedRepos.some(d => `${d.entity}/${d.repo}`.toLowerCase() === repoKey)) return true;
    
    return false;
  };
  
  // Filter, sort, and deduplicate repos (use filteredRepos from above)
  const filtered = filteredRepos.filter(r => {
    // CRITICAL: Filter out corrupted repos FIRST (before any other checks)
    if (isRepoCorrupted(r, (r as any).nostrEventId || (r as any).lastNostrEventId)) {
      return false; // Never show corrupted repos
    }
    
    // CRITICAL: Filter out deleted repos FIRST (before ownership checks)
    if (isRepoDeleted(r)) return false;
    
    // Skip if owner marked as deleted/archived on Nostr
    if ((r as any).deleted === true || (r as any).archived === true) return false;
    
    // CRITICAL: "Your repositories" should ONLY show repos owned by the current user
    if (!pubkey) return false;
    
    const repoName = r.repo || r.slug || r.name || "";
    const repoOwnerPubkey = getRepoOwnerPubkey(r as any, r.entity);
    const directOwnerPubkey = (r as any).ownerPubkey;
    
    // Priority 1: Check direct ownerPubkey match (most reliable)
    if (directOwnerPubkey && directOwnerPubkey.toLowerCase() === pubkey.toLowerCase()) {
      return true;
    }
    
    // Priority 2: Check via getRepoOwnerPubkey (uses ownerPubkey or contributors)
    if (repoOwnerPubkey && repoOwnerPubkey.toLowerCase() === pubkey.toLowerCase()) {
      return true;
    }
    
    // Priority 3: Check contributors for owner with matching pubkey
    if (r.contributors && Array.isArray(r.contributors)) {
      const ownerContributor = r.contributors.find((c: any) => 
        c.pubkey && c.pubkey.toLowerCase() === pubkey.toLowerCase() && 
        (c.weight === 100 || c.role === "owner")
      );
      if (ownerContributor) return true;
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
              return false;
            }
            return true;
          }
        }
      } catch (e) {}
    }
    
    // Filter out repos without valid entity (npub format required)
    if (!r.entity || r.entity === "user" || !r.entity.startsWith("npub")) {
      return false;
    }
    
    return false;
  });
  
  // Sort by: 1) Status priority, 2) Date (newest first), 3) Name (alphabetical)
  const sorted = filtered.sort((a, b) => {
    // Get status for both repos
    const statusA = getRepoStatus(a);
    const statusB = getRepoStatus(b);
    
    // Status priority: pushing > push_failed > local > live_with_edits > live
    // This ensures repos needing attention appear first
    const statusPriority: Record<string, number> = {
      pushing: 0,        // Highest priority - currently being worked on
      push_failed: 1,    // Needs attention
      local: 2,          // Needs to be pushed
      live_with_edits: 3, // Has changes to push
      live: 4,           // Everything is good
    };
    
    const priorityA = statusPriority[statusA] ?? 5;
    const priorityB = statusPriority[statusB] ?? 5;
    
    // First, sort by status priority
    if (priorityA !== priorityB) {
      return priorityA - priorityB;
    }
    
    // If same status, sort by date (newest first)
    const aLatest = (a as any).lastNostrEventCreatedAt 
      ? (a as any).lastNostrEventCreatedAt * 1000
      : ((a as any).updatedAt || a.createdAt || 0);
    const bLatest = (b as any).lastNostrEventCreatedAt 
      ? (b as any).lastNostrEventCreatedAt * 1000
      : ((b as any).updatedAt || b.createdAt || 0);
    
    if (aLatest !== bLatest) {
      return bLatest - aLatest; // Newest first
    }
    
    // If same date, sort by name (alphabetical)
    const nameA = (a.name || a.repo || a.slug || "").toLowerCase();
    const nameB = (b.name || b.repo || b.slug || "").toLowerCase();
    return nameA.localeCompare(nameB);
  });
  
  // Deduplicate repos
  const dedupeMap = new Map<string, any>();
  sorted.forEach((r: any) => {
    const entity = (r.entity || '').trim();
    const repo = (r.repo || r.slug || r.name || '').trim();
    const normalizedRepo = repo.toLowerCase().replace(/[_-]/g, '');
    const key = `${entity}/${normalizedRepo}`.toLowerCase();
    const existing = dedupeMap.get(key);
    
    if (!existing) {
      dedupeMap.set(key, r);
    } else {
      const status = getRepoStatus(r);
      const existingStatus = getRepoStatus(existing);
      
      if ((status === "local" && (existingStatus === "live" || existingStatus === "live_with_edits")) ||
          (existingStatus === "local" && (status === "live" || status === "live_with_edits"))) {
        const localVersion = status === "local" ? r : existing;
        const nostrVersion = status === "local" ? existing : r;
        
        const merged = {
          ...nostrVersion,
          logoUrl: localVersion.logoUrl || nostrVersion.logoUrl,
          hasUnpushedEdits: localVersion.hasUnpushedEdits || nostrVersion.hasUnpushedEdits,
          lastModifiedAt: Math.max(localVersion.lastModifiedAt || 0, nostrVersion.lastModifiedAt || 0),
          nostrEventId: nostrVersion.nostrEventId || localVersion.nostrEventId,
          lastNostrEventId: nostrVersion.lastNostrEventId || localVersion.lastNostrEventId,
          status: (localVersion.hasUnpushedEdits || (localVersion.lastModifiedAt && nostrVersion.lastNostrEventCreatedAt && localVersion.lastModifiedAt > nostrVersion.lastNostrEventCreatedAt * 1000)) 
            ? "live_with_edits" 
            : (nostrVersion.status || "live"),
        };
        
        dedupeMap.set(key, merged);
      } else {
        if ((r.createdAt || 0) > (existing.createdAt || 0)) {
          dedupeMap.set(key, r);
        }
      }
    }
  });
  
  const deduplicatedRepos = Array.from(dedupeMap.values());
  
  return (
    <div className="space-y-2">
      {deduplicatedRepos.map((r: any, index: number) => {
        const entity = r.entity!;
        const repoForUrl = r.repo || r.slug || "unnamed-repo";
        const displayName = r.name || repoForUrl;
        
        const ownerPubkey = getRepoOwnerPubkey(r, entity);
        
        let repoHref: string;
        if (ownerPubkey) {
          try {
            const npub = nip19.npubEncode(ownerPubkey);
            repoHref = `/${npub}/${repoForUrl}`;
          } catch (error) {
            repoHref = `/${entity}/${repoForUrl}`;
          }
        } else {
          repoHref = `/${entity}/${repoForUrl}`;
        }
        
        const ownerMeta = ownerPubkey ? ownerMetadata[ownerPubkey] : undefined;
        const entityDisplay = ownerMeta?.name || ownerMeta?.display_name || (entity.startsWith("npub") ? entity.slice(0, 12) + "..." : entity);
        
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
                  e.preventDefault();
                  e.stopPropagation();
                  setClickedRepo(repoKey);
                  window.location.href = repoHref;
                }}
              >
                <div>
                  {iconUrl ? (
                    <img 
                      src={iconUrl} 
                      alt="repo" 
                      className="h-6 w-6 rounded-sm object-contain flex-shrink-0"
                      onError={(e) => {
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
                </div>
                <div className="flex flex-col gap-1 min-w-0 flex-1">
                  {/* Header row: repo name on its own line on mobile so it never gets squeezed out by badges */}
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2 sm:flex-wrap">
                    <div className="font-semibold text-cyan-400 min-w-0 flex-1 flex items-center gap-2">
                      {isNavigating && (
                        <Loader2 className="h-4 w-4 animate-spin text-purple-400 flex-shrink-0" />
                      )}
                      <span className="truncate">{displayName}</span>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                    {/* CRITICAL: Status badge - suppressHydrationWarning because status calculation depends on client-side state */}
                    {(() => {
                      const style = getStatusBadgeStyle(status);
                      return (
                        <span 
                            className={`text-xs px-2 py-0.5 rounded ${style.bg} ${style.text} flex-shrink-0`}
                          suppressHydrationWarning
                        >
                          {style.label}
                        </span>
                      );
                    })()}
                    {/* CRITICAL: Always render badge to prevent hydration mismatches */}
                    {/* suppressHydrationWarning because publicRead might differ between server and client */}
                    <div suppressHydrationWarning>
                      <Badge 
                        variant="outline" 
                          className="text-xs flex items-center gap-1 flex-shrink-0"
                      >
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
                    </div>
                  </div>
                  {r.description && r.description.trim() ? (
                    <div className="text-sm opacity-70 line-clamp-2">
                      {r.description}
                    </div>
                  ) : r.sourceUrl ? (
                    <div className="text-sm opacity-70 line-clamp-2">
                      Imported from {r.sourceUrl}
                    </div>
                  ) : null}
                </div>
              </div>
              <div className="flex items-center gap-2 sm:ml-4 flex-shrink-0 flex-wrap">
                {/* CRITICAL: Always render button container to prevent hydration mismatches */}
                {/* Hide button when conditions aren't met, but keep DOM structure consistent */}
                {/* suppressHydrationWarning because button visibility depends on client-side state (pubkey, isOwner) */}
                <div 
                  className={isLocal && pubkey && isOwner(pubkey, r.contributors, r.ownerPubkey) ? "" : "hidden"}
                  suppressHydrationWarning
                >
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isPushing}
                    className="text-xs whitespace-nowrap"
                    onClick={async (e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      
                      if (!pubkey || !publish || !subscribe || !defaultRelays) {
                        alert("Please log in to push repositories");
                        return;
                      }
                      
                      try {
                        const hasNip07 = typeof window !== "undefined" && window.nostr;
                        let privateKey: string | undefined;
                        
                        if (!hasNip07) {
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
                          privateKey,
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
                          window.dispatchEvent(new Event("storage"));
                          
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
                        alert(`❌ Failed to push repository: ${error?.message || error?.toString() || "Unknown error"}`);
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
                </div>
                <div className="opacity-70 text-sm whitespace-nowrap">
                  {(r as any).lastNostrEventCreatedAt ? (
                    <>
                      Last push: {formatDateTime24h((r as any).lastNostrEventCreatedAt * 1000)}
                    </>
                  ) : (r as any).lastPushAttempt ? (
                    <>
                      Push attempted: {formatDateTime24h((r as any).lastPushAttempt)}
                    </>
                  ) : (r as any).lastModifiedAt ? (
                    <>
                      Modified: {formatDateTime24h((r as any).lastModifiedAt)}
                    </>
                  ) : (
                    <>
                      Created: {formatDateTime24h(r.createdAt)}
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

