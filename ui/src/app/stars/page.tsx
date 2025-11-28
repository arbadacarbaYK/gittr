"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import Link from "next/link";
import useSession from "@/lib/nostr/useSession";
import { Button } from "@/components/ui/button";
import { Star } from "lucide-react";
import { useContributorMetadata } from "@/lib/nostr/useContributorMetadata";
import { nip19 } from "nostr-tools";

type StarredRepo = {
  slug: string;
  entity?: string;
  repo?: string;
  name: string;
  sourceUrl?: string;
  createdAt?: number;
  entityDisplayName?: string;
  logoUrl?: string;
};

export default function StarsPage() {
  const { isLoggedIn } = useSession();
  const [starredRepos, setStarredRepos] = useState<StarredRepo[]>([]);
  const [allRepos, setAllRepos] = useState<any[]>([]);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!isLoggedIn) return;
    
    try {
      // Get starred repo IDs
      const starred = JSON.parse(localStorage.getItem("gittr_starred_repos") || "[]") as string[];
      
      // Get all repos to find matching ones
      const repos = JSON.parse(localStorage.getItem("gittr_repos") || "[]") as any[];
      setAllRepos(repos);
      
      // Load list of locally-deleted repos
      const deletedRepos = JSON.parse(localStorage.getItem("gittr_deleted_repos") || "[]") as Array<{entity: string; repo: string; deletedAt: number}>;
      const deletedReposSet = new Set(deletedRepos.map(d => `${d.entity}/${d.repo}`.toLowerCase()));
      
      // Helper function to check if a repo is deleted
      const isRepoDeleted = (r: any): boolean => {
        const repo = r.repo || r.slug || "";
        const entity = r.entity || "";
        
        // Check direct match by entity/repo
        const repoKey = `${entity}/${repo}`.toLowerCase();
        if (deletedReposSet.has(repoKey)) return true;
        
        // Check if marked as deleted/archived on Nostr
        if (r.deleted === true || r.archived === true) return true;
        
        return false;
      };
      
      // Match starred IDs with repos, filtering out deleted ones
      const matched: StarredRepo[] = [];
      starred.forEach(starredId => {
        const repo = repos.find((r: any) => {
          const repoId = r.entity && r.repo ? `${r.entity}/${r.repo}` : r.slug || "";
          return repoId === starredId || r.slug === starredId;
        });
        
        // Skip if repo is deleted
        if (repo && isRepoDeleted(repo)) {
          return; // Skip deleted repos
        }
        
        if (repo) {
          matched.push({
            slug: repo.slug || starredId,
            entity: repo.entity,
            repo: repo.repo,
            name: repo.name || repo.repo || starredId,
            sourceUrl: repo.sourceUrl,
            createdAt: repo.createdAt,
            entityDisplayName: repo.entityDisplayName,
            logoUrl: repo.logoUrl,
          });
        } else {
          // If repo not found, check if it's in deleted list before creating minimal entry
          const [entity, repoName] = starredId.split("/");
          const repoKey = `${entity}/${repoName || starredId}`.toLowerCase();
          if (!deletedReposSet.has(repoKey)) {
            matched.push({
              slug: starredId,
              entity,
              repo: repoName || starredId,
              name: repoName || starredId,
            });
          }
        }
      });
      
      setStarredRepos(matched);
    } catch (error) {
      console.error("Failed to load starred repos:", error);
      setStarredRepos([]);
    }
  }, [isLoggedIn]);

  // Get owner metadata for avatars - resolve to full pubkeys
  const ownerPubkeys = useMemo(() => {
    if (typeof window === "undefined") return [];
    const pubkeys = new Set<string>();
    for (const repo of starredRepos) {
      if (!repo.entity || repo.entity === "user") continue;
      // Try to resolve to full pubkey
      try {
        const repos = JSON.parse(localStorage.getItem("gittr_repos") || "[]");
        const matchingRepo = repos.find((r: any) => 
          r.slug === repo.slug || 
          (r.entity === repo.entity && (r.repo === repo.repo || r.slug === repo.slug))
        );
        if (matchingRepo?.ownerPubkey && /^[0-9a-f]{64}$/i.test(matchingRepo.ownerPubkey)) {
          pubkeys.add(matchingRepo.ownerPubkey);
        } else if (/^[0-9a-f]{64}$/i.test(repo.entity)) {
          pubkeys.add(repo.entity);
        } else if (repo.entity.startsWith("npub")) {
          try {
            const decoded = nip19.decode(repo.entity);
            if (decoded.type === "npub") {
              pubkeys.add(decoded.data as string);
            }
          } catch {}
        }
      } catch {}
    }
    return Array.from(pubkeys);
  }, [starredRepos]);
  
  const ownerMetadata = useContributorMetadata(ownerPubkeys);

  // Resolve repo icon - use full pubkey for metadata lookup
  const getRepoIcon = (repo: StarredRepo): string | null => {
    if (repo.logoUrl) return repo.logoUrl;
    if (typeof window === "undefined") return null;
    
    // Find matching repo to get ownerPubkey
    try {
      const repos = JSON.parse(localStorage.getItem("gittr_repos") || "[]");
      const matchingRepo = repos.find((r: any) => 
        r.slug === repo.slug || 
        (r.entity === repo.entity && (r.repo === repo.repo || r.slug === repo.slug))
      );
      
      if (matchingRepo?.ownerPubkey && /^[0-9a-f]{64}$/i.test(matchingRepo.ownerPubkey)) {
        // Normalize to lowercase for metadata lookup
        const normalizedKey = matchingRepo.ownerPubkey.toLowerCase();
        const meta = ownerMetadata[normalizedKey] || ownerMetadata[matchingRepo.ownerPubkey];
        if (meta?.picture) return meta.picture;
      }
      
      // Also check for logo files in repo
      if (matchingRepo?.files && Array.isArray(matchingRepo.files)) {
        const logoFiles = matchingRepo.files
          .map((f: any) => f.path)
          .filter((p: string) => {
            const fileName = p.split("/").pop() || "";
            const baseName = fileName.replace(/\.[^.]+$/, "").toLowerCase();
            const extension = fileName.split(".").pop()?.toLowerCase() || "";
            const imageExts = ["png", "jpg", "jpeg", "gif", "webp", "svg", "ico"];
            return baseName.includes("logo") && !baseName.includes("logo-alby") && !baseName.includes("alby-logo") && imageExts.includes(extension);
          });
        if (logoFiles.length > 0 && matchingRepo.sourceUrl) {
          try {
            const url = new URL(matchingRepo.sourceUrl);
            if (url.hostname === "github.com") {
              const parts = url.pathname.split("/").filter(Boolean);
              if (parts.length >= 2 && parts[0] && parts[1]) {
                const owner = parts[0];
                const repoName = parts[1].replace(/\.git$/, "");
                const branch = matchingRepo.defaultBranch || "main";
                return `https://raw.githubusercontent.com/${owner}/${repoName}/${encodeURIComponent(branch)}/${logoFiles[0]}`;
              }
            }
          } catch {}
        }
      }
    } catch {}
    
    // Fallback: try entity directly
    if (repo.entity && /^[0-9a-f]{64}$/i.test(repo.entity)) {
      // Normalize to lowercase for metadata lookup
      const normalizedKey = repo.entity.toLowerCase();
      const meta = ownerMetadata[normalizedKey] || ownerMetadata[repo.entity];
      if (meta?.picture) return meta.picture;
    }
    
    return null;
  };

  if (!mounted) {
    return (
      <div className="container mx-auto max-w-[95%] xl:max-w-[90%] 2xl:max-w-[85%] p-6">
        <h1 className="text-2xl font-bold mb-4">Your Stars</h1>
        <p className="text-gray-400">Loading...</p>
      </div>
    );
  }

  if (!isLoggedIn) {
    return (
      <div className="container mx-auto max-w-[95%] xl:max-w-[90%] 2xl:max-w-[85%] p-6">
        <h1 className="text-2xl font-bold mb-4">Your Stars</h1>
        <p className="text-gray-400">Please sign in to view your starred repositories.</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-[95%] xl:max-w-[90%] 2xl:max-w-[85%] p-6">
      <h1 className="text-2xl font-bold mb-4 flex items-center gap-2">
        <Star className="h-6 w-6 text-yellow-500 fill-yellow-500" />
        Your Stars
      </h1>
      
      {starredRepos.length === 0 ? (
        <div className="border border-[#383B42] rounded p-8 text-center">
          <Star className="h-12 w-12 text-gray-600 mx-auto mb-4" />
          <p className="text-gray-400 mb-2">You haven't starred any repositories yet.</p>
          <Link href="/explore">
            <Button variant="outline" className="mt-4">
              Explore Repositories
            </Button>
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {starredRepos.map((repo) => {
            const entity = repo.entity || "";
            const repoSlug = repo.repo || repo.slug || "";
            const href = entity && repoSlug ? `/${entity}/${repoSlug}` : "#";
            const iconUrl = getRepoIcon(repo);
            
            return (
              <Link key={repo.slug} href={href} className="border border-[#383B42] rounded p-4 hover:bg-white/5 transition-colors">
                <div className="flex items-center gap-3">
                  {iconUrl ? (
                    <img
                      src={iconUrl}
                      alt="repo"
                      className="h-6 w-6 rounded-sm object-contain flex-shrink-0"
                      onError={(e) => {
                        e.currentTarget.style.display = 'none';
                      }}
                    />
                  ) : (
                    <span className="inline-block h-6 w-6 rounded-sm bg-[#22262C] flex-shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold truncate">{repo.name}</div>
                    <div className="text-sm text-gray-400 truncate">
                      {repo.entityDisplayName || entity || "Unknown"} / {repoSlug}
                    </div>
                  </div>
                  <Star className="h-4 w-4 text-yellow-500 fill-yellow-500 flex-shrink-0" />
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

