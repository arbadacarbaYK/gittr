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
  GitPullRequest,
  MessageSquare,
  Search,
} from "lucide-react";
import { formatDateTime24h, formatDate24h, formatTime24h } from "@/lib/utils/date-format";

interface IPullRequestData {
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
  status?: "open" | "closed" | "merged";
  createdAt?: number;
  linkedIssueId?: string;
  linkedIssueBountyAmount?: number;
  linkedIssueBountyStatus?: "pending" | "paid" | "released";
  reviewApprovals?: number;
  reviewChangeRequests?: number;
  requiredApprovals?: number;
}

export default function PullsPage({}) {
  const { pubkey: currentUserPubkey } = useNostrContext();
  const [prType, setPrType] = useState<
    "created" | "assigned" | "mentioned"
  >("created");

  const [search, setSearch] = useState<string>("");
  const [allPRs, setAllPRs] = useState<IPullRequestData[]>([]);
  const [prStatus, setPrStatus] = useState<"open" | "closed">("open");

  // Load PRs from repos owned by the logged-in user only
  useEffect(() => {
    try {
      const allPRsData: IPullRequestData[] = [];
      
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
      
      // Load PRs from each repo owned by user
      userRepos.forEach((repo: any) => {
        // Support multiple repo formats
        const entity = repo.entity || repo.slug?.split("/")[0] || repo.ownerPubkey?.slice(0, 8);
        const repoName = repo.repo || repo.slug?.split("/")[1] || repo.name || repo.slug;
        if (!entity || !repoName) {
          console.warn("[PullsPage] Skipping repo without entity/repo:", repo);
          return;
        }
        
        // Try both possible key formats
        const prKey1 = `gittr_prs__${entity}__${repoName}`;
        const prKey2 = `gittr_prs__${repo.slug || entity}_${repoName}`;
        let repoPRs = JSON.parse(localStorage.getItem(prKey1) || "[]") as any[];
        if (repoPRs.length === 0) {
          repoPRs = JSON.parse(localStorage.getItem(prKey2) || "[]") as any[];
        }
        
        console.log(`[PullsPage] Loading PRs from ${entity}/${repoName}:`, repoPRs.length);
        
        repoPRs.forEach((pr: any, idx: number) => {
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
          
          // Determine status - merged PRs count as closed
          const status = pr.status === "merged" ? "closed" : (pr.status || "open");
          
          // Get linked issue bounty info if PR is linked to an issue
          let linkedIssueBountyAmount: number | undefined;
          let linkedIssueBountyStatus: "pending" | "paid" | "released" | undefined;
          
          if (pr.linkedIssueId || pr.issueId || pr.linkedIssue) {
            try {
              const issueKey1 = `gittr_issues__${entity}__${repoName}`;
              const issueKey2 = `gittr_issues__${repo.slug || entity}_${repoName}`;
              let repoIssues = JSON.parse(localStorage.getItem(issueKey1) || "[]") as any[];
              if (repoIssues.length === 0) {
                repoIssues = JSON.parse(localStorage.getItem(issueKey2) || "[]") as any[];
              }
              const linkedIssue = repoIssues.find((i: any) => 
                i.id === (pr.linkedIssueId || pr.issueId || pr.linkedIssue) || 
                i.number === (pr.linkedIssueId || pr.issueId || pr.linkedIssue)
              );
              
              if (linkedIssue && (linkedIssue.bountyAmount || linkedIssue.bountyStatus)) {
                linkedIssueBountyAmount = linkedIssue.bountyAmount;
                linkedIssueBountyStatus = linkedIssue.bountyStatus;
              }
            } catch {}
          }

          // Get review counts
          let reviewApprovals = 0;
          let reviewChangeRequests = 0;
          let requiredApprovals = 1;
          try {
            const reviewKey = `gittr_pr_reviews__${entity}__${repoName}__${pr.id || idx}`;
            const reviews = JSON.parse(localStorage.getItem(reviewKey) || "[]");
            reviewApprovals = reviews.filter((r: any) => r.state === "APPROVED").length;
            reviewChangeRequests = reviews.filter((r: any) => r.state === "CHANGES_REQUESTED").length;
            requiredApprovals = repo.requiredApprovals || 1;
          } catch {}
          
          allPRsData.push({
            id: pr.id || `${entity}_${repoName}_${idx}`,
            entity: entity,
            repo: repoName,
            title: pr.title || `PR ${idx + 1}`,
            number: String(idx + 1),
            date: pr.createdAt ? formatDateTime24h(pr.createdAt) : formatDateTime24h(Date.now()),
            author: pr.author || "unknown",
            tags: [],
            taskTotal: null,
            taskCompleted: null,
            linkedPR: 0,
            assignees: pr.assignees || [],
            comments: 0,
            status: status,
            createdAt: pr.createdAt || Date.now(),
            linkedIssueId: pr.linkedIssueId || pr.issueId,
            linkedIssueBountyAmount,
            linkedIssueBountyStatus,
            reviewApprovals,
            reviewChangeRequests,
            requiredApprovals,
          });
        });
      });
      
      // Sort by createdAt (newest first)
      allPRsData.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      
      console.log("[PullsPage] Total PRs loaded:", allPRsData.length);
      console.log("[PullsPage] Current user pubkey:", currentUserPubkey);
      console.log("[PullsPage] PRs (first 3):", allPRsData.slice(0, 3).map(p => ({ id: p.id, title: p.title, author: p.author })));
      
      setAllPRs(allPRsData);
    } catch (error) {
      console.error("Failed to load PRs:", error);
      setAllPRs([]);
    }
  }, [currentUserPubkey]); // Reload when user changes

  // Get all unique author pubkeys (only full 64-char pubkeys for metadata lookup)
  const authorPubkeys = useMemo(() => {
    return Array.from(new Set(
      allPRs
        .map(p => p.author)
        .filter(Boolean)
        .filter(author => /^[a-f0-9]{64}$/i.test(author)) // Only full 64-char pubkeys
    ));
  }, [allPRs]);

  // Fetch Nostr metadata for all authors
  const authorMetadata = useContributorMetadata(authorPubkeys);

  const handleSearch = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) =>
      setSearch(e.currentTarget.value),
    []
  );

  const handlePRStatusOpen = useCallback(() => setPrStatus("open"), []);
  const handlePRStatusClosed = useCallback(
    () => setPrStatus("closed"),
    []
  );

  const handlePRTypeCreated = useCallback(() => setPrType("created"), []);
  const handlePRTypeAssigned = useCallback(
    () => setPrType("assigned"),
    []
  );
  const handlePRTypeMentioned = useCallback(
    () => setPrType("mentioned"),
    []
  );

  // Filter and sort PRs based on search, status, and type
  const filteredPRs = useMemo(() => {
    let filtered = [...allPRs];
    
    // Filter by status
    filtered = filtered.filter(pr => {
      const status = pr.status || "open";
      return prStatus === "open" ? status === "open" : (status === "closed" || status === "merged");
    });
    
    // Filter by type (created/assigned/mentioned)
    if (currentUserPubkey) {
      if (prType === "created") {
        // Match by full pubkey or by prefix (8-char entity display)
        filtered = filtered.filter(pr => {
          const authorPubkey = pr.author || "";
          const userPubkey = currentUserPubkey || "";
          // Direct match
          if (authorPubkey === userPubkey) return true;
          // Match if either starts with the other's 8-char prefix
          if (authorPubkey.toLowerCase().startsWith(userPubkey.slice(0, 8).toLowerCase())) return true;
          if (userPubkey.toLowerCase().startsWith(authorPubkey.slice(0, 8).toLowerCase())) return true;
          return false;
        });
      } else if (prType === "assigned") {
        filtered = filtered.filter(pr => {
          const assignees = pr.assignees || [];
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
      } else if (prType === "mentioned") {
        // TODO: Implement mention detection from PR content/description
        // For now, just show all if mentioned filter is selected
      }
    }
    
    // Filter by search query
    if (search.trim()) {
      const query = search.toLowerCase();
      filtered = filtered.filter(pr => {
        // Get entity display name - never use shortened pubkey
        let entityDisplay = pr.entity || "";
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
          pr.title.toLowerCase().includes(query) ||
          `${entityDisplay}/${pr.repo || ""}`.toLowerCase().includes(query) ||
          (pr.author || "").toLowerCase().includes(query) ||
          (pr.tags || []).some(tag => tag.toLowerCase().includes(query))
        );
      });
    }
    
    // Sort by createdAt (newest first)
    filtered.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    
    return filtered;
  }, [allPRs, prStatus, prType, search, currentUserPubkey]);

  const openCount = useMemo(() => allPRs.filter(pr => (pr.status || "open") === "open").length, [allPRs]);
  const closedCount = useMemo(() => allPRs.filter(pr => (pr.status || "open") !== "open").length, [allPRs]);

  return (
    <section className="sm:px-8 py-6 max-w-6xl m-auto">
      <div className="md:flex justify-between gap-4 px-4 sm:px-0">
        <div className="isolate inline-flex rounded-md text-sm lg:text-base shadow-sm w-full mb-4 lg:mb-0">
          <button
            type="button"
            className={clsx(
              "relative w-full rounded-l-md py-1.5 font-semibold text-zinc-300 ring-1 ring-inset ring-gray focus:z-10",
              {
                "bg-purple-600 text-zinc-50": prType === `created`,
              }
            )}
            onClick={handlePRTypeCreated}
          >
            Created
          </button>
          <button
            type="button"
            className={clsx(
              "relative -ml-px w-full py-1.5 font-semibold text-zinc-300 ring-1 ring-inset ring-gray focus:z-10",
              {
                "bg-purple-600 text-zinc-50": prType === `assigned`,
              }
            )}
            onClick={handlePRTypeAssigned}
          >
            Assigned
          </button>
          <button
            type="button"
            className={clsx(
              "relative -ml-px w-full py-1.5 font-semibold rounded-r-md md:rounded-none text-zinc-300 ring-1 ring-inset ring-gray focus:z-10",
              {
                "bg-purple-600 text-zinc-50": prType === `mentioned`,
              }
            )}
            onClick={handlePRTypeMentioned}
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
            placeholder="Search pull requests..."
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
                    "text-zinc-50": prStatus === `open`,
                  })}
                  onClick={handlePRStatusOpen}
                >
                  <GitPullRequest className="h-5 w-5 mr-2 mt-0.5" /> {openCount} Open
                </button>
                <button
                  className={clsx("flex text-zinc-400 hover:text-zinc-200", {
                    "text-zinc-50": prStatus === `closed`,
                  })}
                  onClick={handlePRStatusClosed}
                >
                  <GitMerge className="h-5 w-5 mr-2 mt-0.5" /> {closedCount} Closed
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
              {filteredPRs.length === 0 ? (
                <li className="p-4 text-center text-zinc-400">
                  {allPRs.length === 0 
                    ? "No pull requests yet. Create a pull request in a repository to get started."
                    : search.trim()
                    ? "No pull requests match your search."
                    : prStatus === "open"
                    ? "No open pull requests."
                    : "No closed pull requests."}
                </li>
              ) : (
                filteredPRs.map((item) => (
                  <li
                    key={`${item.id} ${item.entity}`}
                    className="text-gray-400 grid grid-cols-8 p-2 text-sm hover:bg-[#171B21]"
                  >
                    <div className="col-span-8 sm:col-span-6">
                      <div className="sm:flex items-center text-lg font-medium">
                        <span className="flex">
                          {prStatus === "open" ? (
                            <GitPullRequest className="h-5 w-5 mr-2 mt-1 text-green-600" />
                          ) : (
                            <GitMerge className="h-5 w-5 mr-2 mt-1 text-purple-600" />
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
                          href={`/${item.entity}/${item.repo}/pulls/${item.id}`}
                        >
                          {item.title}
                        </Link>
                        {/* Review Status Badge */}
                        {item.status === "open" && (item.reviewApprovals || item.reviewChangeRequests || item.requiredApprovals) && (
                          <span className={`ml-2 px-2 py-0.5 rounded text-xs font-medium flex items-center gap-1 ${
                            (item.reviewChangeRequests ?? 0) > 0
                              ? "bg-red-900/40 text-red-400"
                              : (item.reviewApprovals ?? 0) >= (item.requiredApprovals || 1)
                              ? "bg-green-900/40 text-green-400"
                              : "bg-yellow-900/40 text-yellow-400"
                          }`}>
                            {(item.reviewChangeRequests ?? 0) > 0 ? (
                              <>⚠️ {item.reviewChangeRequests} change {(item.reviewChangeRequests ?? 0) === 1 ? "request" : "requests"}</>
                            ) : (item.reviewApprovals ?? 0) > 0 ? (
                              <>✓ {item.reviewApprovals}/{item.requiredApprovals || 1} approved</>
                            ) : (
                              <>⏳ {item.requiredApprovals || 1} approval{(item.requiredApprovals || 1) === 1 ? "" : "s"} required</>
                            )}
                          </span>
                        )}
                        {/* Bounty Badge - Show if linked issue has bounty */}
                        {item.linkedIssueBountyAmount && (
                          <span className="ml-2 px-2 py-0.5 bg-yellow-900/40 text-yellow-400 rounded text-xs font-medium flex items-center gap-1">
                            💰 {item.linkedIssueBountyAmount} sats
                            {item.linkedIssueBountyStatus === "paid" && (
                              <span className="text-green-400">●</span>
                            )}
                            {item.linkedIssueBountyStatus === "released" && (
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
                          <Avatar className="h-4 w-4 ring-1 ring-gray-500">
                            {(() => {
                              const meta = authorMetadata[item.author];
                              const picture = meta?.picture;
                              return picture && picture.startsWith("http") ? (
                                <AvatarImage src={picture} />
                              ) : null;
                            })()}
                            <AvatarFallback className="bg-gray-700 text-white text-[10px]">
                              {(() => {
                                const meta = authorMetadata[item.author];
                                const name = meta?.display_name || meta?.name || item.author.slice(0, 8);
                                return name.slice(0, 2).toUpperCase();
                              })()}
                            </AvatarFallback>
                          </Avatar>
                          <span>
                            {(() => {
                              const meta = authorMetadata[item.author];
                              return meta?.display_name || meta?.name || item.author.slice(0, 8) + "...";
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
                ))
              )}
            </ul>
          </div>
        </div>
      </main>
    </section>
  );
}
