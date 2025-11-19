"use client";

import { useMemo } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import Link from "next/link";
import { useContributorMetadata } from "@/lib/nostr/useContributorMetadata";
import { nip19 } from "nostr-tools";
import { Tooltip } from "@/components/ui/tooltip";
import { sanitizeContributors } from "@/lib/utils/contributors";

export type ContributorRole = "owner" | "maintainer" | "contributor";

export interface Contributor {
  pubkey?: string;
  name?: string;
  picture?: string;
  weight?: number; // For zap splits (0-100), independent of role
  role?: ContributorRole; // Permission level: owner (can merge + settings), maintainer (can merge), contributor (can approve only)
  githubLogin?: string;
}

interface ContributorsProps {
  contributors?: Contributor[];
}

export function Contributors({ contributors = [] }: ContributorsProps) {
  const sanitizedContributors = useMemo(
    () => sanitizeContributors(contributors, { keepNameOnly: true }),
    [contributors]
  );

  // Get all pubkeys from contributors FIRST
  // Only include full pubkeys (64 chars) - metadata needs full pubkey, not 8-char prefix
  const pubkeys = useMemo(() => {
    return sanitizedContributors
      .map((c) => c.pubkey)
      .filter((p): p is string =>
        !!p &&
        typeof p === "string" &&
        p.length === 64 && // Only full pubkeys
        /^[0-9a-f]{64}$/i.test(p) // Must be valid hex
      );
  }, [sanitizedContributors]);

  // Fetch Nostr metadata for all contributors with pubkeys
  const nostrMetadata = useContributorMetadata(pubkeys);
  
  // Show ALL contributors, even those without Nostr pubkeys
  // Contributors without pubkeys will be shown with their GitHub/GitLab/Codeberg avatar and login
  // If no contributors at all, show empty state
  if (sanitizedContributors.length === 0) {
    return (
      <div className="text-gray-400 text-sm">No contributors yet</div>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      {sanitizedContributors.map((contributor, idx) => {
        // DEBUG: Log contributor data to diagnose pubkey issues (only once per render, not per contributor)
        if (idx === 0) {
          const uniquePubkeys = new Set(sanitizedContributors.map(c => c.pubkey).filter(Boolean));
          if (uniquePubkeys.size === 1 && sanitizedContributors.length > 1) {
            console.error("❌ [Contributors] ALL contributors have the SAME pubkey! This is wrong:", Array.from(uniquePubkeys)[0]);
            // Only log full details if there's a problem
            console.table(sanitizedContributors.map((c, i) => ({
              idx: i,
              pubkey: c.pubkey ? `${c.pubkey.slice(0, 8)}...${c.pubkey.slice(-4)}` : "none",
              githubLogin: c.githubLogin || "none",
              name: c.name || "none",
              role: c.role || "none",
            })));
          }
        }
        
        // Get Nostr metadata if pubkey exists
        const nostrData = contributor.pubkey ? nostrMetadata[contributor.pubkey] : null;
        
        // Prefer Nostr profile picture if it exists, then GitHub/GitLab/Codeberg picture, then none
        // Check for truthy string (not empty string) to ensure we have a real picture URL
        const picture = (nostrData?.picture && nostrData.picture.trim().length > 0) 
          ? nostrData.picture 
          : (contributor.picture && contributor.picture.trim().length > 0)
            ? contributor.picture
            : undefined;
        
        // Prefer Nostr display name or name, then contributor name, then GitHub login, then fallback
        // Don't use pubkey prefix as name - it creates confusing initials like "NP" from npub
        const name = nostrData?.display_name || nostrData?.name || contributor.name || 
          contributor.githubLogin || null; // null = no real name, use platform default
        
        // Only generate initials from actual names, not from npub/pubkey prefixes or fallback names
        // If name looks like an npub (starts with "npub"), is a fallback pattern, or too long, don't generate initials
        const isNpubLike = name && (name.startsWith("npub") || name.length > 20);
        const isFallbackName = name && (name.startsWith("Contributor ") || name.match(/^[0-9a-f]{8,}$/i)); // pubkey prefix or fallback pattern
        const shouldUseInitials = name && !isNpubLike && !isFallbackName;
        const words = shouldUseInitials ? name.trim().split(/\s+/) : [];
        const firstWord = words[0] || "";
        const lastWord = words[words.length - 1] || "";
        const initials = shouldUseInitials && words.length > 1 && firstWord && lastWord
          ? ((firstWord[0] || "") + (lastWord[0] || "")).toUpperCase().substring(0, 2)
          : shouldUseInitials && name && name.length > 0
            ? name.substring(0, 2).toUpperCase()
            : null; // null = use platform default logo
        
        // Link to Nostr profile if pubkey exists, otherwise to GitHub if githubLogin exists
        // Only use pubkey if it's a valid 64-char hex string
        let href = "#";
        if (contributor.pubkey && contributor.pubkey.length === 64 && /^[0-9a-f]{64}$/i.test(contributor.pubkey)) {
          // Use npub format for profile links (required for profile pages)
          try {
            const npub = nip19.npubEncode(contributor.pubkey);
            href = `/${npub}`;
          } catch (e) {
            // Fallback to pubkey if encoding fails
            href = `/${contributor.pubkey}`;
          }
        } else if (contributor.githubLogin) {
          href = `https://github.com/${contributor.githubLogin}`;
        }
        
        // DEBUG: Only log link generation if there's a problem (invalid pubkey or missing data)
        if (!contributor.pubkey && !contributor.githubLogin) {
          console.warn("⚠️ [Contributors] Contributor missing pubkey and GitHub login", contributor);
        } else if (contributor.pubkey && (!contributor.pubkey.length || contributor.pubkey.length !== 64 || !/^[0-9a-f]{64}$/i.test(contributor.pubkey))) {
          console.warn("⚠️ [Contributors] Invalid pubkey detected", {
            pubkey: contributor.pubkey ? `${contributor.pubkey.slice(0, 16)}...` : "none",
            length: contributor.pubkey?.length || 0,
            isValid: false,
          });
        }
        
        const isExternalLink = href.startsWith("http");
        
        // Generate npub and prepare tooltip with full pubkey for verification
        const npub = contributor.pubkey && contributor.pubkey.length === 64 ? (() => {
          try {
            return nip19.npubEncode(contributor.pubkey);
          } catch {
            return null;
          }
        })() : null;
        
        // Build tooltip with name, role, npub, and full pubkey for verification
        const displayNameForTooltip = name || (contributor.pubkey ? `User ${contributor.pubkey.slice(0, 8)}` : `Contributor ${idx + 1}`);
        const tooltipParts = [displayNameForTooltip];
        if (contributor.role) {
          tooltipParts.push(`Role: ${contributor.role}`);
        }
        if (npub) {
          tooltipParts.push(`npub: ${npub}`);
        }
        if (contributor.pubkey && contributor.pubkey.length === 64) {
          tooltipParts.push(`pubkey: ${contributor.pubkey}`);
        }
        const tooltip = tooltipParts.join('\n');
        
        return (
          <Tooltip key={contributor.pubkey || `contributor-${idx}`} content={tooltip}>
          <Link
            href={href}
              className="inline-block relative z-10"
            target={isExternalLink ? "_blank" : undefined}
            rel={isExternalLink ? "noopener noreferrer" : undefined}
          >
            <Avatar className={`h-8 w-8 shrink-0 overflow-hidden ${
              contributor.role === "owner" || (contributor.role === undefined && (contributor.weight ?? 0) === 100)
                ? "ring-2 ring-purple-500"
                : contributor.role === "maintainer" || (contributor.role === undefined && (contributor.weight ?? 0) >= 50 && (contributor.weight ?? 0) < 100)
                ? "ring-2 ring-blue-500"
                : "ring-1 ring-gray-500"
            }`}>
              {picture && (
                <AvatarImage 
                  src={picture} 
                  alt={displayNameForTooltip}
                  className="max-w-8 max-h-8 object-cover"
                  style={{ maxWidth: '2rem', maxHeight: '2rem' }}
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                  }}
                />
              )}
              {/* CRITICAL: Show platform default logo when no picture and no valid initials */}
              {!picture && initials ? (
                <AvatarFallback className="bg-gray-700 text-white text-[10px] font-semibold">
                  {initials}
                </AvatarFallback>
              ) : !picture ? (
                <AvatarFallback className="bg-transparent">
                  <img 
                    src="/logo.svg" 
                    alt="platform default"
                    className="h-full w-full object-contain p-1"
                    onError={(e) => {
                      e.currentTarget.style.display = 'none';
                    }}
                  />
                </AvatarFallback>
              ) : null}
            </Avatar>
          </Link>
          </Tooltip>
        );
      })}
    </div>
  );
}
