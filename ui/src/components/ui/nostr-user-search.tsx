"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { nip19 } from "nostr-tools";
import { useNostrContext } from "@/lib/nostr/NostrContext";
import { useContributorMetadata } from "@/lib/nostr/useContributorMetadata";
import { cn } from "@/lib/utils";

export interface NostrUser {
  pubkey: string;
  npub: string;
  name?: string;
  display_name?: string;
  picture?: string;
}

interface NostrUserSearchProps {
  value: string;
  onChange: (value: string) => void;
  onSelect?: (user: NostrUser) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  maxResults?: number;
}

/**
 * Nostr User Search Component
 * 
 * Searches for Nostr users by:
 * - Name/display_name (from cached metadata)
 * - npub (full or partial)
 * - pubkey (full or partial)
 * 
 * CRITICAL: Uses debounced search to avoid blocking input.
 * The input value is updated immediately, but search is debounced.
 */
export function NostrUserSearch({
  value,
  onChange,
  onSelect,
  placeholder = "Search by name, npub, or pubkey...",
  className,
  disabled = false,
  maxResults = 10,
}: NostrUserSearchProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [showResults, setShowResults] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const { defaultRelays, subscribe } = useNostrContext();

  // Debounced search query - this prevents blocking input
  // The input value updates immediately, but we only search after user stops typing
  const [debouncedQuery, setDebouncedQuery] = useState("");

  // Update debounced query after user stops typing (300ms delay)
  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    searchTimeoutRef.current = setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, 300);

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [searchQuery]);

  // Load all cached metadata from localStorage
  const cachedMetadata = useMemo(() => {
    if (typeof window === 'undefined') return {} as Record<string, any>;
    try {
      const cached = localStorage.getItem("gittr_metadata_cache");
      if (cached) {
        const parsed = JSON.parse(cached);
        return parsed as Record<string, any>;
      }
    } catch {}
    return {} as Record<string, any>;
  }, []);

  // Get all pubkeys from cached metadata
  const allCachedPubkeys = useMemo(() => {
    return Object.keys(cachedMetadata).filter(
      (p) => p && p.length === 64 && /^[0-9a-f]{64}$/i.test(p)
    );
  }, [cachedMetadata]);

  // Fetch metadata for all cached pubkeys (to get fresh data)
  const cachedMetadataMap = useContributorMetadata(allCachedPubkeys);

  // Search users from:
  // 1. Cached metadata (localStorage)
  // 2. Repo contributors (from localStorage repos)
  // 3. Users from activities
  const searchResults = useMemo(() => {
    if (!debouncedQuery || debouncedQuery.trim().length < 1) {
      return [];
    }

    const query = debouncedQuery.trim().toLowerCase();
    const results: NostrUser[] = [];
    const seenPubkeys = new Set<string>();

    // Helper to add user if not already seen
    const addUser = (pubkey: string, metadata?: any) => {
      if (seenPubkeys.has(pubkey.toLowerCase())) return;
      seenPubkeys.add(pubkey.toLowerCase());

      try {
        const npub = nip19.npubEncode(pubkey);
        const name = metadata?.display_name || metadata?.name;
        const picture = metadata?.picture;

        // Check if matches query
        const matchesName = name && name.toLowerCase().includes(query);
        const matchesNpub = npub.toLowerCase().includes(query);
        const matchesPubkey = pubkey.toLowerCase().includes(query);

        if (matchesName || matchesNpub || matchesPubkey) {
          results.push({
            pubkey,
            npub,
            name: metadata?.name,
            display_name: metadata?.display_name,
            picture,
          });
        }
      } catch {
        // Invalid pubkey, skip
      }
    };

    // 1. Search cached metadata
    for (const [pubkey, metadata] of Object.entries(cachedMetadataMap)) {
      if (pubkey && pubkey.length === 64 && /^[0-9a-f]{64}$/i.test(pubkey)) {
        addUser(pubkey, metadata);
      }
    }

    // 2. Search repo contributors
    if (typeof window === 'undefined') return results;
    try {
      const repos = JSON.parse(localStorage.getItem("gittr_repos") || "[]");
      for (const repo of repos) {
        if (repo.contributors && Array.isArray(repo.contributors)) {
          for (const contrib of repo.contributors) {
            if (contrib.pubkey && /^[0-9a-f]{64}$/i.test(contrib.pubkey)) {
              const meta = cachedMetadataMap[contrib.pubkey.toLowerCase()] || contrib;
              addUser(contrib.pubkey, meta);
            }
          }
        }
      }
    } catch {}

    // 3. Search users from activities
    try {
      if (typeof window === 'undefined') return results;
      const activities = JSON.parse(localStorage.getItem("gittr_activities") || "[]");
      for (const activity of activities) {
        if (activity.user && /^[0-9a-f]{64}$/i.test(activity.user)) {
          const meta = cachedMetadataMap[activity.user.toLowerCase()];
          addUser(activity.user, meta);
        }
      }
    } catch {}

    // 4. If query looks like an npub or pubkey, try to decode and add
    if (query.startsWith("npub") || /^[0-9a-f]{8,64}$/i.test(query)) {
      try {
        if (query.startsWith("npub")) {
          const decoded = nip19.decode(query);
          if (decoded.type === "npub") {
            const pubkey = decoded.data as string;
            const meta = cachedMetadataMap[pubkey.toLowerCase()];
            addUser(pubkey, meta);
          }
        } else if (query.length === 64 && /^[0-9a-f]{64}$/i.test(query)) {
          // Full pubkey
          const meta = cachedMetadataMap[query.toLowerCase()];
          addUser(query, meta);
        } else if (query.length >= 8) {
          // Partial pubkey - search for matching pubkeys
          for (const pubkey of allCachedPubkeys) {
            if (pubkey.toLowerCase().startsWith(query)) {
              const meta = cachedMetadataMap[pubkey.toLowerCase()];
              addUser(pubkey, meta);
            }
          }
        }
      } catch {
        // Invalid format, skip
      }
    }

    // Sort by relevance: exact matches first, then name matches, then npub/pubkey matches
    return results
      .sort((a, b) => {
        const aName = (a.display_name || a.name || "").toLowerCase();
        const bName = (b.display_name || b.name || "").toLowerCase();
        const aNpub = a.npub.toLowerCase();
        const bNpub = b.npub.toLowerCase();

        // Exact name match
        if (aName === query && bName !== query) return -1;
        if (bName === query && aName !== query) return 1;

        // Starts with query
        if (aName.startsWith(query) && !bName.startsWith(query)) return -1;
        if (bName.startsWith(query) && !aName.startsWith(query)) return 1;

        // Name contains query
        if (aName.includes(query) && !bName.includes(query)) return -1;
        if (bName.includes(query) && !aName.includes(query)) return 1;

        // npub/pubkey match
        if (aNpub.includes(query) && !bNpub.includes(query)) return -1;
        if (bNpub.includes(query) && !aNpub.includes(query)) return 1;

        return 0;
      })
      .slice(0, maxResults);
  }, [debouncedQuery, cachedMetadataMap, allCachedPubkeys, maxResults]);

  // Show results when query changes and has results
  useEffect(() => {
    setShowResults(debouncedQuery.trim().length > 0 && searchResults.length > 0);
    setSelectedIndex(0);
  }, [debouncedQuery, searchResults.length]);

  // Handle input change - CRITICAL: Update immediately, don't block
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setSearchQuery(newValue);
    onChange(newValue); // Update parent immediately
    // Don't force showResults here - let debounced query handle it
  }, [onChange]);

  // Handle user selection
  const handleSelectUser = useCallback((user: NostrUser) => {
    onChange(user.npub); // Set npub as value
    setSearchQuery(user.npub);
    setShowResults(false);
    if (onSelect) {
      onSelect(user);
    }
    // Keep focus on input
    setTimeout(() => {
      inputRef.current?.focus();
    }, 0);
  }, [onChange, onSelect]);

  // Keyboard navigation
  useEffect(() => {
    if (!showResults) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) =>
          prev < searchResults.length - 1 ? prev + 1 : prev
        );
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const selected = searchResults[selectedIndex];
        if (selected) {
          handleSelectUser(selected);
        }
      } else if (e.key === "Escape") {
        setShowResults(false);
      }
    };

    const input = inputRef.current;
    if (input) {
      input.addEventListener("keydown", handleKeyDown);
      return () => {
        input.removeEventListener("keydown", handleKeyDown);
      };
    }
  }, [showResults, searchResults, selectedIndex, handleSelectUser]);

  // Scroll selected into view
  useEffect(() => {
    if (resultsRef.current && searchResults.length > 0) {
      const selectedElement = resultsRef.current.children[selectedIndex] as HTMLElement;
      if (selectedElement) {
        selectedElement.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    }
  }, [selectedIndex, searchResults.length]);

  // Focus input when component mounts or becomes visible
  useEffect(() => {
    if (!disabled) {
      inputRef.current?.focus();
    }
  }, [disabled]);

  return (
    <div className={cn("relative", className)}>
      <Input
        ref={inputRef}
        type="text"
        value={searchQuery}
        onChange={handleInputChange}
        placeholder={placeholder}
        disabled={disabled}
        className="w-full"
        onFocus={() => {
          if (debouncedQuery.trim().length > 0 && searchResults.length > 0) {
            setShowResults(true);
          }
        }}
        onBlur={(e) => {
          // Don't close if clicking on results
          const relatedTarget = e.relatedTarget as HTMLElement;
          if (relatedTarget?.closest('[data-user-result]')) {
            return;
          }
          // Delay closing to allow click events to fire
          setTimeout(() => {
            setShowResults(false);
          }, 200);
        }}
      />

      {/* Results dropdown */}
      {showResults && searchResults.length > 0 && (
        <div
          ref={resultsRef}
          className="absolute z-50 w-full mt-1 bg-[#171B21] border border-[#383B42] rounded-lg shadow-xl max-h-60 overflow-y-auto"
          data-user-result
        >
          {searchResults.map((user, index) => {
            const displayName = user.display_name || user.name || user.npub.slice(0, 16) + "...";
            const isSelected = index === selectedIndex;

            return (
              <div
                key={user.pubkey}
                data-user-result
                className={cn(
                  "flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-white/5",
                  isSelected && "bg-purple-900/30 border-l-2 border-purple-500"
                )}
                onClick={() => handleSelectUser(user)}
                onMouseEnter={() => setSelectedIndex(index)}
              >
                <Avatar className="h-8 w-8 flex-shrink-0">
                  {user.picture && user.picture.startsWith("http") ? (
                    <AvatarImage src={user.picture} />
                  ) : null}
                  <AvatarFallback className="bg-gray-700 text-white text-xs">
                    {displayName.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <div className="text-white font-medium truncate">
                    {displayName}
                  </div>
                  <div className="text-xs text-gray-500 font-mono truncate">
                    {user.npub.slice(0, 20)}...
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

