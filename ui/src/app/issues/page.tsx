"use client";

import * as React from "react";
import { useCallback, useEffect, useState, useMemo } from "react";
import Link from "next/link";
import useSession from "@/lib/nostr/useSession";
import { useNostrContext } from "@/lib/nostr/NostrContext";
import { useContributorMetadata } from "@/lib/nostr/useContributorMetadata";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { nip19 } from "nostr-tools";

import { clsx } from "clsx";
import {
  Check,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  GitMerge,
  MessageSquare,
  Search,
} from "lucide-react";
import { formatDateTime24h, formatDate24h, formatTime24h } from "@/lib/utils/date-format";

interface IIssueData {
  id: string;
  entity: string;
  repo: string;
  title: string;
  number: string;
  date: string;
  author: string;
  tags: string[];
  taskTotal: number | null;
  taskCompleted: number | null;
  linkedPR: number;
  assignees: string[];
  comments: number;
  status?: "open" | "closed";
  createdAt?: number;
  bountyAmount?: number;
  bountyStatus?: "pending" | "paid" | "released";
}

export default function IssuesPage({}) {
  const { pubkey: currentUserPubkey } = useNostrContext();
  const [issueType, setIssueType] = useState<
    "created" | "assigned" | "mentioned"
  >("created");

  const [search, setSearch] = useState<string>("");
  const [allIssues, setAllIssues] = useState<IIssueData[]>([]);
  const [issueStatus, setIssueStatus] = useState<"open" | "closed">("open");

  // Load issues from repos owned by the logged-in user only
  useEffect(() => {
    try {
      const allIssuesData: IIssueData[] = [];
      
      // Get all repos from localStorage
      const repos = JSON.parse(localStorage.getItem("gittr_repos") || "[]") as any[];
      
      // Filter to only repos owned by the logged-in user
      const userRepos = repos.filter((repo: any) => {
        if (!currentUserPubkey) return false;
        // Check if user owns this repo
        const ownerPubkey = repo.ownerPubkey || 
          (repo.contributors?.find((c: any) => c.weight === 100)?.pubkey) ||
          (repo.entity && /^[0-9a-f]{64}$/i.test(repo.entity) ? repo.entity : null);
        if (!ownerPubkey) return false;
        // Match by full pubkey or 8-char prefix
        return ownerPubkey === currentUserPubkey || 
          (ownerPubkey.length === 64 && ownerPubkey.toLowerCase().startsWith(currentUserPubkey.slice(0, 8).toLowerCase())) ||
          (currentUserPubkey.length === 64 && currentUserPubkey.toLowerCase().startsWith(ownerPubkey.slice(0, 8).toLowerCase())) ||
          (repo.entity && repo.entity === currentUserPubkey.slice(0, 8).toLowerCase());
      });
      
      // Load issues from each repo owned by user
      userRepos.forEach((repo: any) => {
        // Support multiple repo formats
        const entity = repo.entity || repo.slug?.split("/")[0] || repo.ownerPubkey?.slice(0, 8);
        const repoName = repo.repo || repo.slug?.split("/")[1] || repo.name || repo.slug;
        if (!entity || !repoName) {
          console.warn("[IssuesPage] Skipping repo without entity/repo:", repo);
          return;
        }
        
        // Try both possible key formats
        const issueKey1 = `gittr_issues__${entity}__${repoName}`;
        const issueKey2 = `gittr_issues__${repo.slug || entity}_${repoName}`;
        let repoIssues = JSON.parse(localStorage.getItem(issueKey1) || "[]") as any[];
        if (repoIssues.length === 0) {
          repoIssues = JSON.parse(localStorage.getItem(issueKey2) || "[]") as any[];
        }
        
        console.log(`[IssuesPage] Loading issues from ${entity}/${repoName}:`, repoIssues.length);
        
        repoIssues.forEach((issue: any, idx: number) => {
          // Get entity display name - never use shortened pubkey
          let entityDisplay = repo.entityDisplayName;
          if (!entityDisplay && entity) {
            // If entity is npub, use it (truncated)
            if (entity.startsWith("npub")) {
              entityDisplay = entity.substring(0, 16) + "...";
            } else if (/^[0-9a-f]{64}$/i.test(entity)) {
              // If full pubkey, convert to npub
              try {
                entityDisplay = nip19.npubEncode(entity).substring(0, 16) + "...";
              } catch {
                entityDisplay = entity.substring(0, 16) + "...";
              }
            } else {
              entityDisplay = entity;
            }
          }
          
          allIssuesData.push({
            id: issue.id || `${entity}_${repoName}_${idx}`,
            entity: entity,
            repo: repoName,
            title: issue.title || `Issue ${idx + 1}`,
            number: issue.number || String(idx + 1),
            date: issue.createdAt ? formatDateTime24h(issue.createdAt) : formatDateTime24h(Date.now()),
            author: issue.author || "unknown",
            tags: issue.labels || [],
            taskTotal: null,
            taskCompleted: null,
            linkedPR: 0,
            assignees: issue.assignees || [],
            comments: 0,
            status: issue.status || "open",
            createdAt: issue.createdAt || Date.now(),
            bountyAmount: issue.bountyAmount,
            bountyStatus: issue.bountyStatus,
          });
        });
      });
      
      // Sort by createdAt (newest first)
      allIssuesData.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      
      console.log("[IssuesPage] Total issues loaded:", allIssuesData.length);
      console.log("[IssuesPage] Current user pubkey:", currentUserPubkey);
      console.log("[IssuesPage] Issues (first 3):", allIssuesData.slice(0, 3).map(i => ({ id: i.id, title: i.title, author: i.author })));
      
      setAllIssues(allIssuesData);
    } catch (error) {
      console.error("Failed to load issues:", error);
      setAllIssues([]);
    }
  }, [currentUserPubkey]); // Reload when user changes

  // Get all unique author pubkeys (only full 64-char pubkeys for metadata lookup)
  const authorPubkeys = useMemo(() => {
    return Array.from(new Set(
      allIssues
        .map(i => i.author)
        .filter(Boolean)
        .filter(author => /^[a-f0-9]{64}$/i.test(author)) // Only full 64-char pubkeys
    ));
  }, [allIssues]);

  // Fetch Nostr metadata for all authors
  const authorMetadata = useContributorMetadata(authorPubkeys);

  const handleSearch = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) =>
      setSearch(e.currentTarget.value),
    []
  );

  const handleIssueStatusOpen = useCallback(() => setIssueStatus("open"), []);
  const handleIssueStatusClosed = useCallback(
    () => setIssueStatus("closed"),
    []
  );

  const handleIssueTypeCreated = useCallback(() => setIssueType("created"), []);
  const handleIssueTypeAssigned = useCallback(
    () => setIssueType("assigned"),
    []
  );
  const handleIssueTypeMentioned = useCallback(
    () => setIssueType("mentioned"),
    []
  );

  // Filter and sort issues based on search, status, and type
  const filteredIssues = useMemo(() => {
    let filtered = [...allIssues];
    
    // Filter by status
    filtered = filtered.filter(issue => {
      const status = issue.status || "open";
      return issueStatus === "open" ? status === "open" : status === "closed";
    });
    
    // Filter by type (created/assigned/mentioned)
    if (currentUserPubkey) {
      if (issueType === "created") {
        // Match by full pubkey or by prefix (8-char entity display)
        filtered = filtered.filter(issue => {
          const authorPubkey = issue.author || "";
          const userPubkey = currentUserPubkey || "";
          // Direct match
          if (authorPubkey === userPubkey) return true;
          // Match if either starts with the other's 8-char prefix
          if (authorPubkey.toLowerCase().startsWith(userPubkey.slice(0, 8).toLowerCase())) return true;
          if (userPubkey.toLowerCase().startsWith(authorPubkey.slice(0, 8).toLowerCase())) return true;
          return false;
        });
      } else if (issueType === "assigned") {
        filtered = filtered.filter(issue => {
          const assignees = issue.assignees || [];
          return assignees.some((a: string) => {
            if (!a || !currentUserPubkey) return false;
            // Direct match
            if (a === currentUserPubkey) return true;
            // Prefix match
            if (a.toLowerCase().startsWith(currentUserPubkey.slice(0, 8).toLowerCase())) return true;
            if (currentUserPubkey.toLowerCase().startsWith(a.slice(0, 8).toLowerCase())) return true;
            return false;
          });
        });
      } else if (issueType === "mentioned") {
        // TODO: Implement mention detection from issue content/description
        // For now, just show all if mentioned filter is selected
      }
    }
    
    // Filter by search query
    if (search.trim()) {
      const query = search.toLowerCase();
      filtered = filtered.filter(issue => {
        // Get entity display name - never use shortened pubkey
        let entityDisplay = issue.entity || "";
        if (entityDisplay && !entityDisplay.startsWith("npub") && /^[0-9a-f]{64}$/i.test(entityDisplay)) {
          try {
            entityDisplay = nip19.npubEncode(entityDisplay).substring(0, 16) + "...";
          } catch {
            entityDisplay = entityDisplay.substring(0, 16) + "...";
          }
        } else if (entityDisplay && entityDisplay.startsWith("npub")) {
          entityDisplay = entityDisplay.substring(0, 16) + "...";
        }
        return (
          issue.title.toLowerCase().includes(query) ||
          `${entityDisplay}/${issue.repo || ""}`.toLowerCase().includes(query) ||
          (issue.author || "").toLowerCase().includes(query) ||
          (issue.tags || []).some(tag => tag.toLowerCase().includes(query))
        );
      });
    }
    
    // Sort by createdAt (newest first)
    filtered.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    
    return filtered;
  }, [allIssues, issueStatus, issueType, search, currentUserPubkey]);

  const openCount = useMemo(() => allIssues.filter(i => (i.status || "open") === "open").length, [allIssues]);
  const closedCount = useMemo(() => allIssues.filter(i => (i.status || "open") === "closed").length, [allIssues]);

  return (
    <section className="sm:px-8 py-6 max-w-6xl m-auto">
      <div className="md:flex justify-between gap-4 px-4 sm:px-0">
        <div className="isolate inline-flex rounded-md text-sm lg:text-base shadow-sm w-full mb-4 lg:mb-0">
          <button
            type="button"
            className={clsx(
              "relative w-full rounded-l-md py-1.5 font-semibold text-zinc-300 ring-1 ring-inset ring-gray focus:z-10",
              {
                "bg-purple-600 text-zinc-50": issueType === `created`,
              }
            )}
            onClick={handleIssueTypeCreated}
          >
            Created
          </button>
          <button
            type="button"
            className={clsx(
              "relative -ml-px w-full py-1.5 font-semibold text-zinc-300 ring-1 ring-inset ring-gray focus:z-10",
              {
                "bg-purple-600 text-zinc-50": issueType === `assigned`,
              }
            )}
            onClick={handleIssueTypeAssigned}
          >
            Assigned
          </button>
          <button
            type="button"
            className={clsx(
              "relative -ml-px w-full py-1.5 font-semibold rounded-r-md md:rounded-none text-zinc-300 ring-1 ring-inset ring-gray focus:z-10",
              {
                "bg-purple-600 text-zinc-50": issueType === `mentioned`,
              }
            )}
            onClick={handleIssueTypeMentioned}
          >
            Mentioned
          </button>
        </div>

        <label className="relative w-full text-zinc-400">
          <span className="sr-only">Search</span>
          <span className="absolute  lg:inset-y-0 lg:left-0 flex items-center px-2">
            <Search className="h-8 w-4" />
          </span>
          <input
            className="block bg-[#0E1116] w-full rounded-md py-1 pl-9 pr-3 focus:outline-none focus:border-purple-500 focus:ring-purple-500 focus:ring-1 text-sm md:text-base"
            type="text"
            placeholder="Search issues..."
            value={search}
            onChange={handleSearch}
          />
        </label>
      </div>

      <main>
        <div className="mt-4">
          <div className="flex w-full rounded-md rounded-bl-none rounded-br-none border bg-[#171B21] py-2 px-4 dark:border-lightgray dark:text-zinc-100">
            <div className="md:flex w-full flex-col text-md py-2 items-start justify-between lg:flex-row lg:items-center">
              <div className="flex items-center lg:flex-row space-x-4 font-medium">
                <button
                  className={clsx("flex text-zinc-400 hover:text-zinc-200", {
                    "text-zinc-50": issueStatus === `open`,
                  })}
                  onClick={handleIssueStatusOpen}
                >
                  <CircleDot className="h-5 w-5 mr-2 mt-0.5" /> {openCount} Open
                </button>
                <button
                  className={clsx("flex text-zinc-400 hover:text-zinc-200", {
                    "text-zinc-50": issueStatus === `closed`,
                  })}
                  onClick={handleIssueStatusClosed}
                >
                  <Check className="h-5 w-5 mr-2 mt-0.5" /> {closedCount} Closed
                </button>
              </div>
              <div className="mt-2 flex text-gray-400 lg:mt-0 space-x-6">
                <span className="flex text-zinc-400 hover:text-zinc-200 cursor-pointer">
                  Visibility <ChevronDown className="h-4 w-4 ml-1 mt-1.5" />
                </span>
                <span className="flex text-zinc-400 hover:text-zinc-200 cursor-pointer">
                  Organization <ChevronDown className="h-4 w-4 ml-1 mt-1.5" />
                </span>
                <span className="flex text-zinc-400 hover:text-zinc-200 cursor-pointer">
                  Sort <ChevronDown className="h-4 w-4 ml-1 mt-1.5" />
                </span>
              </div>
            </div>
          </div>
          <div className="overflow-hidden rounded-md rounded-tr-none rounded-tl-none border border-t-0 dark:border-lightgray">
            <ul className="divide-y dark:divide-lightgray">
              {filteredIssues.length === 0 ? (
                <li className="p-4 text-center text-zinc-400">
                  {allIssues.length === 0 
                    ? "No issues yet. Create an issue in a repository to get started."
                    : search.trim()
                    ? "No issues match your search."
                    : issueStatus === "open"
                    ? "No open issues."
                    : "No closed issues."}
                </li>
              ) : (
              filteredIssues.map((item) => (
                <li
                  key={`${item.id} ${item.entity}`}
                  className="text-gray-400 grid grid-cols-8 p-2 text-sm hover:bg-[#171B21]"
                >
                  <div className="col-span-8 sm:col-span-6">
                    <div className="sm:flex items-center text-lg font-medium">
                      <span className="flex">
                        {issueStatus === "open" ? (
                          <CircleDot className="h-5 w-5 mr-2 mt-1 text-green-600" />
                        ) : (
                          <CheckCircle2 className="h-5 w-5 mr-2 mt-1 text-purple-600" />
                        )}
                        <Link
                          className="text-zinc-400 hover:text-purple-500"
                          href={`/${item.entity}/${item.repo}`}
                        >
                          {item.entity}/{item.repo}
                        </Link>
                      </span>

                      <Link
                        className="text-zinc-200 hover:text-purple-500 pl-7 sm:pl-3"
                        href={`/${item.entity}/${item.repo}/issues/${item.id}`}
                      >
                        {item.title}
                      </Link>
                      {/* Bounty Badge */}
                      {(item.bountyAmount || item.bountyStatus) && (
                        <span className="ml-2 px-2 py-0.5 bg-yellow-900/40 text-yellow-400 rounded text-xs font-medium flex items-center gap-1">
                          💰 {item.bountyAmount || 0} sats
                          {item.bountyStatus === "paid" && (
                            <span className="text-green-400">●</span>
                          )}
                          {item.bountyStatus === "released" && (
                            <span className="text-purple-400">✓</span>
                          )}
                        </span>
                      )}
                    </div>
                    <div className="ml-7 text-zinc-400 flex items-center gap-2">
                      #{item.number} opened {item.date} by{" "}
                      <Link 
                        className="hover:text-purple-500 flex items-center gap-1 group" 
                        href={`/${item.author}`}
                        title={(() => {
                          if (item.author && item.author.length === 64) {
                            try {
                              const npub = nip19.npubEncode(item.author);
                              return `npub: ${npub}`;
                            } catch {
                              return `pubkey: ${item.author}`;
                            }
                          }
                          return `pubkey: ${item.author}`;
                        })()}
                      >
                        <Avatar className="h-4 w-4">
                          {(() => {
                            const meta = authorMetadata[item.author];
                            const picture = meta?.picture;
                            return picture && picture.startsWith("http") ? (
                              <AvatarImage src={picture} />
                            ) : null;
                          })()}
                          <AvatarFallback className="bg-purple-600 text-white text-[10px]">
                            {(() => {
                              const meta = authorMetadata[item.author];
                              let name = meta?.display_name || meta?.name;
                              if (!name && item.author) {
                                if (item.author.startsWith("npub")) {
                                  name = item.author.substring(0, 16) + "...";
                                } else if (/^[0-9a-f]{64}$/i.test(item.author)) {
                                  try {
                                    name = nip19.npubEncode(item.author).substring(0, 16) + "...";
                                  } catch {
                                    name = item.author.substring(0, 16) + "...";
                                  }
                                } else {
                                  name = item.author;
                                }
                              }
                              return (name || "??").slice(0, 2).toUpperCase();
                            })()}
                          </AvatarFallback>
                        </Avatar>
                        <span>
                          {(() => {
                            const meta = authorMetadata[item.author];
                            if (meta?.display_name || meta?.name) {
                              return meta.display_name || meta.name;
                            }
                            if (item.author) {
                              if (item.author.startsWith("npub")) {
                                return item.author.substring(0, 16) + "...";
                              } else if (/^[0-9a-f]{64}$/i.test(item.author)) {
                                try {
                                  return nip19.npubEncode(item.author).substring(0, 16) + "...";
                                } catch {
                                  return item.author.substring(0, 16) + "...";
                                }
                              }
                              return item.author;
                            }
                            return "Unknown";
                          })()}
                        </span>
                        {item.author && item.author.length === 64 && (() => {
                          try {
                            const npub = nip19.npubEncode(item.author);
                            return (
                              <span className="text-xs text-gray-500 opacity-0 group-hover:opacity-100 transition-opacity font-mono ml-1">
                                ({npub.slice(0, 16)}...)
                              </span>
                            );
                          } catch {
                            return null;
                          }
                        })()}
                      </Link>
                    </div>
                  </div>

                  <div className="hidden sm:flex col-span-2 text-zinc-400 justify-between pt-2 text-right pr-3 no-wrap">
                    <span className="ml-2 flex hover:text-purple-500 cursor-pointer font-medium">
                      {item.linkedPR ? (
                        <>
                          <GitMerge className="h-5 w-5 mr-2" />
                          {item.linkedPR}
                        </>
                      ) : null}
                    </span>
                    <span className="ml-2 "></span>
                    <span className="ml-2 flex hover:text-purple-500 cursor-pointer font-medium">
                      {item.comments ? (
                        <>
                          <MessageSquare className="h-5 w-5 mr-2" />
                          {item.comments}
                        </>
                      ) : null}
                    </span>
                  </div>
                </li>
              )))}
            </ul>
          </div>
        </div>
      </main>
    </section>
  );
}
