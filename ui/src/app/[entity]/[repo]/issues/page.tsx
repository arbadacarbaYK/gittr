"use client";

import { getRepoStorageKey } from "@/lib/utils/entity-normalizer";
import { findRepoByEntityAndName } from "@/lib/utils/repo-finder";
import { getRepoOwnerPubkey, getEntityDisplayName, resolveEntityToPubkey } from "@/lib/utils/entity-resolver";

import * as React from "react";
import { useCallback, useEffect, useState, useMemo, use } from "react";

import FilterBar from "@/components/filter-bar";
import { Button } from "@/components/ui/button";
import { useContributorMetadata } from "@/lib/nostr/useContributorMetadata";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { nip19 } from "nostr-tools";
import { useNostrContext } from "@/lib/nostr/NostrContext";
import { KIND_ISSUE, KIND_STATUS_OPEN, KIND_STATUS_CLOSED } from "@/lib/nostr/events";

import { clsx } from "clsx";
import {
  Check,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  GitPullRequest,
  MessageSquare,
  Tag,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
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
  createdAt?: number;
}

export default function RepoIssuesPage({ params }: { params: Promise<{ entity: string; repo: string }> }) {
  const resolvedParams = use(params);
  const [mounted, setMounted] = useState(false);
  const [issueStatus, setIssueStatus] = useState<"open" | "closed">("open");

  const [search, setSearch] = useState<string>(`is:open is:issue`);

  const [issues, setIssues] = useState<IIssueData[]>([]);
  const { subscribe, defaultRelays } = useNostrContext();

  useEffect(() => {
    setMounted(true);
  }, []);

  const pathname = usePathname() || "";

  const loadIssues = useCallback(() => {
    try {
      const key = getRepoStorageKey("gittr_issues", resolvedParams.entity, resolvedParams.repo);
      const list = JSON.parse(localStorage.getItem(key) || "[]");
      // Filter by status and map correctly
      const filtered = list.filter((it: any) => {
        const status = it.status || "open";
        return status === issueStatus;
      });
      const mapped: IIssueData[] = filtered.map((it: any, idx: number) => ({
        id: it.id || String(idx),
        entity: it.entity || resolvedParams.entity,
        repo: it.repo || resolvedParams.repo,
        title: it.title || `Issue ${idx+1}`,
        number: it.number || String(idx + 1), // Use actual number from saved issue
        date: it.createdAt ? formatDateTime24h(it.createdAt) : "",
        author: it.author || "you",
        tags: it.labels || [],
        taskTotal: null,
        taskCompleted: null,
        linkedPR: 0,
        assignees: it.assignees || [],
        comments: 0,
        createdAt: it.createdAt || Date.now(),
      }));
      // Sort by createdAt (newest first)
      mapped.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      setIssues(mapped);
    } catch {
      setIssues([]);
    }
  }, [resolvedParams.entity, resolvedParams.repo, issueStatus]);

  useEffect(() => {
    loadIssues();
    
    // Listen for new issue creation
    const handleIssueCreated = () => {
      loadIssues();
    };
    window.addEventListener("gittr:issue-created", handleIssueCreated);
    
    return () => {
      window.removeEventListener("gittr:issue-created", handleIssueCreated);
    };
  }, [loadIssues]);

  // Subscribe to Issues from Nostr relays for this repo
  useEffect(() => {
    if (!subscribe || !defaultRelays || defaultRelays.length === 0 || !resolvedParams.entity || !resolvedParams.repo) return;

    // Resolve full pubkey from entity (could be npub, prefix, or full pubkey)
    const resolveEntityPubkey = async () => {
      // First try to resolve entity to pubkey (handles npub decoding)
      const resolved = resolveEntityToPubkey(resolvedParams.entity);
      if (resolved) {
        return resolved;
      }
      // Otherwise, try to find the repo and get ownerPubkey
      const repos = JSON.parse(localStorage.getItem("gittr_repos") || "[]");
      const repo = findRepoByEntityAndName(repos, resolvedParams.entity, resolvedParams.repo);
      if (repo?.ownerPubkey && /^[0-9a-f]{64}$/i.test(repo.ownerPubkey)) {
        return repo.ownerPubkey;
      }
      // Last resort: return null if we can't resolve
      return null;
    };

    let cancelled = false;
    (async () => {
      const entityPubkey = await resolveEntityPubkey();
      if (cancelled) return;

      // NIP-34: Use "#a" tag filter for discovery: "30617:<owner-pubkey>:<repo-id>"
      // Also include old "#repo" tag for backward compatibility
      const filters: any[] = [
        {
          kinds: [KIND_ISSUE],
          "#repo": [resolvedParams.entity, resolvedParams.repo], // Old format
        },
      ];
      
      // Add NIP-34 "a" tag filter if we have owner pubkey
      if (entityPubkey && /^[0-9a-f]{64}$/i.test(entityPubkey)) {
        filters.push({
          kinds: [KIND_ISSUE],
          "#a": [`30617:${entityPubkey}:${resolvedParams.repo}`], // NIP-34 format
        });
      }
      
      const unsub = subscribe(
        filters,
        defaultRelays,
        (event, isAfterEose, relayURL) => {
          if (event.kind === KIND_ISSUE) {
            try {
              // NIP-34: Parse from tags, not JSON content
              const aTag = event.tags.find((t: string[]) => t[0] === "a");
              const subjectTag = event.tags.find((t: string[]) => t[0] === "subject");
              const pTag = event.tags.find((t: string[]) => t[0] === "p" && !t[2]); // Repository owner (no marker)
              
              // Verify this issue belongs to the current repo via "a" tag
              // Format: "30617:<owner-pubkey>:<repo-id>"
              if (aTag && aTag[1]) {
                const aParts = aTag[1].split(":");
                if (aParts.length >= 3 && aParts[0] === "30617") {
                  const repoOwnerPubkey = aParts[1];
                  const repoId = aParts[2];
                  
                  // Check if this matches our repo
                  if (repoId !== resolvedParams.repo) {
                    return; // Not for this repo
                  }
                  
                  // Also check if owner matches (entity or entityPubkey)
                  if (repoOwnerPubkey && repoOwnerPubkey !== entityPubkey && 
                      !resolvedParams.entity.includes(repoOwnerPubkey.slice(0, 8)) &&
                      repoOwnerPubkey !== entityPubkey) {
                    // Might still be valid if entity resolves to this pubkey
                    // Continue processing
                  }
                } else {
                  // Old format - try to parse from "repo" tag
                  const repoTag = event.tags.find((t: string[]) => t[0] === "repo");
                  if (!repoTag || (repoTag[1] !== resolvedParams.entity && repoTag[1] !== entityPubkey) || repoTag[2] !== resolvedParams.repo) {
                    return;
                  }
                }
              } else {
                // Fallback: Old format with "repo" tag
                const repoTag = event.tags.find((t: string[]) => t[0] === "repo");
                if (!repoTag || (repoTag[1] !== resolvedParams.entity && repoTag[1] !== entityPubkey) || repoTag[2] !== resolvedParams.repo) {
                  return;
                }
              }

              const key = getRepoStorageKey("gittr_issues", resolvedParams.entity, resolvedParams.repo);
              const existingIssues = JSON.parse(localStorage.getItem(key) || "[]");
              
              // Check if issue already exists
              const existingIndex = existingIssues.findIndex((i: any) => i.id === event.id);
              
              // NIP-34: Extract from tags
              // Title from "subject" tag (NIP-34) or JSON content (old format)
              let title = subjectTag ? subjectTag[1] : "";
              let description = event.content || ""; // NIP-34: content is markdown
              let bountyData: any = {};
              
              // Try to parse old JSON format for backward compatibility
              if (!title && event.content) {
                try {
                  const oldData = JSON.parse(event.content);
                  title = oldData.title || "";
                  description = oldData.description || "";
                  bountyData = {
                    bountyAmount: oldData.bountyAmount,
                    bountyInvoice: oldData.bountyInvoice,
                    bountyStatus: oldData.bountyStatus || (oldData.bountyAmount ? "pending" : undefined),
                    bountyWithdrawId: oldData.bountyWithdrawId,
                    bountyLnurl: oldData.bountyLnurl,
                    bountyWithdrawUrl: oldData.bountyWithdrawUrl,
                  };
                } catch {
                  // Not JSON, use as-is (NIP-34 markdown)
                }
              }
              
              // Extract labels from "t" tags (NIP-34) or "label" tags (old format)
              const labels = event.tags
                .filter((t: string[]) => t[0] === "t" || t[0] === "label")
                .map((t: string[]) => t[1]);
              
              // Extract assignees from "p" tags with "assignee" marker (custom) or all "p" tags (old format)
              const assignees = event.tags
                .filter((t: string[]) => t[0] === "p" && (t[2] === "assignee" || !t[2]))
                .map((t: string[]) => t[1])
                .filter((p: string | undefined): p is string => !!p && p !== pTag?.[1]); // Exclude repo owner
              
              // Status: Default to "open" - will be updated by status events (kinds 1630-1632)
              // NIP-34: Status comes from separate status events, not tags
              const status = "open"; // Default, will be updated by status event subscription

              const issue = {
                id: event.id,
                entity: resolvedParams.entity,
                repo: resolvedParams.repo,
                title: title || "Untitled Issue",
                description: description,
                status: status,
                author: event.pubkey,
                labels: labels,
                assignees: assignees,
                createdAt: event.created_at * 1000,
                number: String(existingIssues.length + 1), // Auto-number
                ...bountyData,
              };

              if (existingIndex >= 0) {
                existingIssues[existingIndex] = { ...existingIssues[existingIndex], ...issue };
              } else {
                existingIssues.push(issue);
              }

              // Store issue event ID for status event subscription
              const issueToUpdate = existingIndex >= 0 ? existingIssues[existingIndex] : existingIssues[existingIssues.length - 1];
              if (!issueToUpdate.nostrEventId) {
                issueToUpdate.nostrEventId = event.id;
              }
              localStorage.setItem(key, JSON.stringify(existingIssues));
              loadIssues(); // Reload to update UI
            } catch (error: any) {
              console.error("Error processing issue event from Nostr:", error);
            }
          }
        }
      );

      // Subscribe to status events (NIP-34 kinds 1630-1632) for all issues in this repo
      const issuesKey = getRepoStorageKey("gittr_issues", resolvedParams.entity, resolvedParams.repo);
      const allIssues = JSON.parse(localStorage.getItem(issuesKey) || "[]");
      const issueEventIds = allIssues.map((issue: any) => issue.nostrEventId || issue.id).filter(Boolean);
      
      if (issueEventIds.length > 0) {
        const statusFilters: any[] = [
          {
            kinds: [KIND_STATUS_OPEN, KIND_STATUS_CLOSED],
            "#e": issueEventIds,
            "#k": ["1621"], // Only issue status events (not PR status events)
          },
        ];
        
        const statusUnsub = subscribe(
          statusFilters,
          defaultRelays,
          (event, isAfterEose, relayURL) => {
            if (cancelled) return;
            
            // Find the root issue event ID from the "e" tag with "root" marker
            const rootTag = event.tags.find((t: string[]) => t[0] === "e" && t[3] === "root");
            if (!rootTag || !rootTag[1]) return;
            
            const issueEventId = rootTag[1];
            const issues = JSON.parse(localStorage.getItem(issuesKey) || "[]");
            const issueIndex = issues.findIndex((i: any) => (i.nostrEventId || i.id) === issueEventId);
            
            if (issueIndex >= 0) {
              // Update issue status based on status event kind
              let newStatus: "open" | "closed" = "open";
              if (event.kind === KIND_STATUS_CLOSED) {
                newStatus = "closed";
              } else if (event.kind === KIND_STATUS_OPEN) {
                newStatus = "open";
              }
              
              // Only update if this status event is newer than the current one
              const currentIssue = issues[issueIndex];
              const currentStatusEventTime = currentIssue.lastStatusEventTime || 0;
              if (event.created_at * 1000 > currentStatusEventTime) {
                issues[issueIndex] = {
                  ...currentIssue,
                  status: newStatus,
                  lastStatusEventTime: event.created_at * 1000,
                  lastStatusEventId: event.id,
                };
                localStorage.setItem(issuesKey, JSON.stringify(issues));
                loadIssues(); // Reload to update UI
              }
            }
          }
        );
        
        return () => {
          cancelled = true;
          if (unsub) unsub();
          if (statusUnsub) statusUnsub();
        };
      } else {
        return () => {
          cancelled = true;
          if (unsub) unsub();
        };
      }
    })();
  }, [subscribe, defaultRelays, resolvedParams.entity, resolvedParams.repo, loadIssues]);

  const handleIssueStatusOpen = useCallback(() => setIssueStatus("open"), []);
  const handleIssueStatusClosed = useCallback(
    () => setIssueStatus("closed"),
    []
  );

  const handleSearch = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) =>
      setSearch(e.currentTarget.value),
    []
  );

  // Get all unique author pubkeys (only full 64-char pubkeys for metadata lookup)
  const authorPubkeys = useMemo(() => {
    return Array.from(new Set(
      issues
        .map(i => i.author)
        .filter(Boolean)
        .filter(author => /^[a-f0-9]{64}$/i.test(author)) // Only full 64-char pubkeys
    ));
  }, [issues]);

  // Fetch Nostr metadata for all authors
  const authorMetadata = useContributorMetadata(authorPubkeys);

  // Helper to get entity display name (username instead of npub)
  const getEntityDisplayNameForRepo = useCallback((entity: string, repo: string) => {
    try {
      const repos = JSON.parse(localStorage.getItem("gittr_repos") || "[]");
      const foundRepo = findRepoByEntityAndName(repos, entity, repo);
      const ownerPubkey = foundRepo ? getRepoOwnerPubkey(foundRepo, entity) : null;
      
      // Get display name using the same logic as other pages
      if (ownerPubkey) {
        const displayName = getEntityDisplayName(ownerPubkey, authorMetadata, entity);
        return displayName;
      }
    } catch {
      // Fallback to entity if lookup fails
    }
    
    // Fallback: use entity as-is (might be npub already, or 8-char prefix)
    return entity.startsWith('npub') ? entity.slice(0, 16) + '...' : entity;
  }, [authorMetadata]);

  // Helper to generate repo URL (keep entity as-is for routing, but display username)
  const getRepoUrl = useCallback((entity: string, repo: string) => {
    // URLs should use entity as-is (npub or pubkey) for routing
    // The display will show username instead
    return `/${entity}/${repo}`;
  }, []);

  return (
    <section className="mt-4">
      <div className="flex flex-col md:flex-row justify-between gap-4">
        <div className="flex w-full order-last mb-4 md:mb-0 md:order-none">
          <FilterBar search={search} handleSearch={handleSearch} />
        </div>

        <div className="flex gap-4 justify-between">
          <div className="flex text-sm">
            <button
              type="button"
              className="flex h-8 items-center border !border-lightgray hover:bg-dark rounded-l-md px-4 text-zinc-200 font-semibold"
            >
              <Tag className="h-4 w-4 mr-2" /> Labels
            </button>
            <button
              type="button"
              className="flex h-8 items-center border-l-0 border !border-lightgray hover:bg-dark rounded-r-md px-4 text-zinc-200 font-semibold"
            >
              <Tag className="h-4 w-4 mr-2" /> Milestones
            </button>
          </div>

          <Button
            variant={"success"}
            type="button"
            className="whitespace-nowrap h-8"
          >
            <Link className="text-white w-full" href={`${pathname}/new`}>
              New issue
            </Link>
          </Button>
        </div>
      </div>

      <main>
        <div className="mt-4">
          <div className="flex flex-col w-full rounded-md rounded-bl-none rounded-br-none border bg-dark py-2 px-4 !border-lightgray dark:text-zinc-100">
            <div className="order-last md:flex w-full flex-col text-md py-2 items-start justify-between lg:flex-row lg:items-center">
              <div className="flex items-center lg:flex-row space-x-4 font-medium">
                <button
                  className={clsx("flex text-zinc-400 hover:text-zinc-200", {
                    "text-zinc-50": issueStatus === `open`,
                  })}
                  onClick={handleIssueStatusOpen}
                >
                  <CircleDot className="h-5 w-5 mr-2 mt-0.5" /> {mounted ? issues.length : 0} Open
                </button>
                <button
                  className={clsx("flex text-zinc-400 hover:text-zinc-200", {
                    "text-zinc-50": issueStatus === `closed`,
                  })}
                  onClick={handleIssueStatusClosed}
                >
                  <Check className="h-5 w-5 mr-2 mt-0.5" /> {mounted ? (() => {
                    try {
                      const key = getRepoStorageKey("gittr_issues", resolvedParams.entity, resolvedParams.repo);
                      const list = JSON.parse(localStorage.getItem(key) || "[]");
                      return list.filter((it: any) => (it.status || "open") === "closed").length;
                    } catch {
                      return 0;
                    }
                  })() : 0} Closed
                </button>
              </div>
              <div className="mt-2 flex text-gray-400 lg:mt-0 space-x-6">
                <span className="flex text-zinc-400 hover:text-zinc-200 cursor-pointer">
                  Author <ChevronDown className="h-4 w-4 ml-1 mt-1.5" />
                </span>
                <span className="flex text-zinc-400 hover:text-zinc-200 cursor-pointer">
                  Label <ChevronDown className="h-4 w-4 ml-1 mt-1.5" />
                </span>
                <span className="hidden md:flex text-zinc-400 hover:text-zinc-200 cursor-pointer">
                  ToDo <ChevronDown className="h-4 w-4 ml-1 mt-1.5" />
                </span>
                <span className="hidden md:flex text-zinc-400 hover:text-zinc-200 cursor-pointer">
                  Milestones <ChevronDown className="h-4 w-4 ml-1 mt-1.5" />
                </span>
                <span className="flex text-zinc-400 hover:text-zinc-200 cursor-pointer">
                  Assignee <ChevronDown className="h-4 w-4 ml-1 mt-1.5" />
                </span>
                <span className="flex text-zinc-400 hover:text-zinc-200 cursor-pointer">
                  Sort <ChevronDown className="h-4 w-4 ml-1 mt-1.5" />
                </span>
              </div>
            </div>
          </div>
          <div className="overflow-hidden rounded-md rounded-tr-none rounded-tl-none border border-t-0 dark:border-lightgray">
            <ul className="divide-y dark:divide-lightgray">
              {issues.map((item) => (
                <li
                  key={`${item.id} ${item.entity}`}
                  className="text-gray-400 grid grid-cols-8 p-2 text-sm hover:bg-dark"
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
                          href={getRepoUrl(item.entity, item.repo)}
                        >
                          {getEntityDisplayNameForRepo(item.entity, item.repo)}/{item.repo}
                        </Link>
                      </span>

                      <Link
                        className="text-zinc-200 hover:text-purple-500 pl-7 sm:pl-3"
                        href={`${getRepoUrl(item.entity, item.repo)}/issues/${item.number}`}
                      >
                        {item.title}
                      </Link>
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
                          <GitPullRequest className="h-5 w-5 mr-2" />
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
              ))}
            </ul>
          </div>
        </div>
      </main>
    </section>
  );
}
