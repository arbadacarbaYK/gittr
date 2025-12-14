"use client";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useRouter } from "next/navigation";
import { useCallback, useRef } from "react";
import { nip19 } from "nostr-tools";
import { getRepoOwnerPubkey } from "@/lib/utils/entity-resolver";

export default function SearchBar({ className }: { className?: string }) {
  const router = useRouter();
  const ref = useRef<HTMLInputElement>(null);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const q = ref.current?.value?.trim() || "";
    if (!q) return;
    if (typeof window === 'undefined') return;
    try {
      const repos = JSON.parse(localStorage.getItem("gittr_repos") || "[]");
      const normalized = q.toLowerCase();
      
      // Check if query looks like a username (no slashes, could be entity/pubkey prefix)
      // BUT: First check if it matches topics - if so, treat as topic search, not username
      const isUsernameQuery = !q.includes("/") && !q.includes(" ");
      
      if (isUsernameQuery) {
        // Check if query matches any repo topics (treat as topic search, not username)
        const topicMatches = repos.filter((r: any) => {
          const topics = (r.topics || []).map((t: string) => t.toLowerCase());
          return topics.some((topic: string) => topic.includes(normalized) || normalized.includes(topic));
        });
        
        // If query matches topics, treat as topic search and go to explore
        if (topicMatches.length > 0) {
          window.location.href = `/explore?q=${encodeURIComponent(q)}`;
          return;
        }
        
        // Find all repos for this user/entity
        const userRepos = repos.filter((r: any) => {
          const entity = r.entity || "";
          const entityDisplayName = r.entityDisplayName || "";
          // Match by entity pubkey prefix, entityDisplayName, or if it's a short pubkey-like string
          return (
            (entity && entity.toLowerCase().includes(normalized)) ||
            (entityDisplayName && entityDisplayName.toLowerCase().includes(normalized)) ||
            (entity && normalized.length >= 4 && entity.toLowerCase().startsWith(normalized))
          );
        }).filter((r: any) => r.entity && r.entity !== "user");
        
        if (userRepos.length > 0) {
          // Navigate to explore with filter for this user's repos
          const firstRepo = userRepos[0];
          // Resolve full owner pubkey and convert to npub format (not shortened pubkey)
          const ownerPubkey = getRepoOwnerPubkey(firstRepo, firstRepo.entity);
          let entityForUrl = firstRepo.entity;
          
          if (ownerPubkey && /^[0-9a-f]{64}$/i.test(ownerPubkey)) {
            try {
              entityForUrl = nip19.npubEncode(ownerPubkey);
            } catch (error) {
              console.error('⚠️ [Search] Failed to encode npub:', { ownerPubkey, error });
              // Fallback to entity as-is if encoding fails
            }
          }
          
          // CRITICAL: Don't navigate directly to single repo - always show explore with filter
          // This prevents "hopping to random repo" when searching for topics/tags
            window.location.href = `/explore?user=${encodeURIComponent(entityForUrl)}&q=${encodeURIComponent(q)}`;
          return;
        }
      }
      
      // Always show results on explore page - never jump directly to a repo
      // This ensures users see all matching results (e.g., "gittr" and "gittr-helper-tools")
      // even if there's an exact match, so they can choose which one they want
      window.location.href = `/explore?q=${encodeURIComponent(q)}`;
    } catch (error) {
      console.error("Search error:", error);
      window.location.href = `/explore?q=${encodeURIComponent(ref.current?.value || "")}`;
    }
  }, [router]);

  return (
    <Input
      ref={ref}
      className={cn(
        "w-full bg-[#0E1116] transition-all ease-in-out",
        className
      )}
      type="text"
      placeholder="Search or jump to…"
      onKeyDown={handleKeyDown}
    />
  );
}
