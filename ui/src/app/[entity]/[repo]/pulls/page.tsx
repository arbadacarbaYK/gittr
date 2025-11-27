"use client";

import * as React from "react";
import { useCallback, useEffect, useState, useMemo } from "react";

import FilterBar from "@/components/filter-bar";
import { Button } from "@/components/ui/button";
import { useContributorMetadata } from "@/lib/nostr/useContributorMetadata";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { nip19 } from "nostr-tools";
import { useNostrContext } from "@/lib/nostr/NostrContext";
import { KIND_PULL_REQUEST } from "@/lib/nostr/events";
import { getRepoStorageKey } from "@/lib/utils/entity-normalizer";
import { findRepoByEntityAndName } from "@/lib/utils/repo-finder";
import { getRepoOwnerPubkey, getEntityDisplayName } from "@/lib/utils/entity-resolver";
import { loadStoredRepos, type StoredRepo } from "@/lib/repos/storage";

import { clsx } from "clsx";
import {
  Check,
  ChevronDown,
  CircleDot,
  GitMerge,
  GitPullRequest,
  MessageSquare,
  Tag,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { formatDateTime24h, formatDate24h, formatTime24h } from "@/lib/utils/date-format";

interface IPullsData {
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
  status?: "open" | "merged" | "closed";
  createdAt?: number;
}

export default function RepoPullsPage({ params }: { params: { entity: string; repo: string } }) {
  const [mounted, setMounted] = useState(false);
  const [issueStatus, setIssueStatus] = useState<"open" | "closed">("open");
  const [search, setSearch] = useState<string>(`is:open is:pr`);
  const [issues, setIssues] = useState<IPullsData[]>([]);
  const [allPRs, setAllPRs] = useState<IPullsData[]>([]); // Store all PRs for counting
  const { subscribe, defaultRelays } = useNostrContext();
  const pathname = usePathname() || "";

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted || !params?.entity || !params?.repo) {
      setIssues([]);
      setAllPRs([]);
      return;
    }
    
    try {
      const key = getRepoStorageKey("gittr_prs", params.entity, params.repo);
      const list = JSON.parse(localStorage.getItem(key) || "[]");
      
      // Filter PRs by status
      const filtered = list.filter((pr: any) => {
        const prStatus = pr.status || "open";
        if (issueStatus === "open") {
          return prStatus === "open";
        } else {
          // "closed" includes both "closed" and "merged" PRs
          return prStatus === "closed" || prStatus === "merged";
        }
      });
      
      const mapped: IPullsData[] = filtered.map((pr: any, idx: number) => ({
        id: pr.id || String(idx),
        entity: params.entity,
        repo: params.repo,
        title: pr.title || `PR ${idx+1}`,
        number: pr.number || String(idx + 1), // Use PR's number field if available
        date: pr.createdAt ? formatDateTime24h(pr.createdAt) : "",
        author: pr.author || "you",
        tags: [],
        taskTotal: null,
        taskCompleted: null,
        linkedPR: 0,
        assignees: [],
        comments: 0,
        status: pr.status || "open", // Include actual PR status
        createdAt: pr.createdAt || Date.now(),
      }));
      // Sort by createdAt (newest first)
      mapped.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      
      // Also store all PRs for counting closed/merged
      const allMapped: IPullsData[] = list.map((pr: any, idx: number) => ({
        id: pr.id || String(idx),
        entity: params.entity,
        repo: params.repo,
        title: pr.title || `PR ${idx+1}`,
        number: pr.number || String(idx + 1),
        date: pr.createdAt ? formatDateTime24h(pr.createdAt) : "",
        author: pr.author || "you",
        tags: [],
        taskTotal: null,
        taskCompleted: null,
        linkedPR: 0,
        assignees: [],
        comments: 0,
        status: pr.status || "open",
        createdAt: pr.createdAt || Date.now(),
      }));
      
      setAllPRs(allMapped);
      setIssues(mapped);
    } catch (error) {
      console.error("Error loading PRs:", error);
      setIssues([]);
      setAllPRs([]);
    }
  }, [params?.entity, params?.repo, issueStatus]);

  // Fetch PRs from GitHub API when tab is clicked (if repo has sourceUrl)
  useEffect(() => {
    if (!mounted || !params?.entity || !params?.repo) return;
    
    const fetchFromGitHub = async () => {
      try {
        const repos = loadStoredRepos();
        const repo = findRepoByEntityAndName(repos, params.entity, params.repo);
        if (!repo?.sourceUrl) return; // Only fetch for GitHub/GitLab/Codeberg repos
        
        // Parse sourceUrl to get owner/repo
        let owner: string | null = null;
        let repoName: string | null = null;
        try {
          const url = new URL(repo.sourceUrl);
          const pathParts = url.pathname.replace(/\.git$/, "").split("/").filter(Boolean);
          if (pathParts.length >= 2 && pathParts[0] && pathParts[1]) {
            owner = pathParts[0];
            repoName = pathParts[1];
          }
        } catch {
          return; // Invalid URL
        }
        
        if (!owner || !repoName) return;
        
        // Check if this is GitHub
        const isGitHub = repo.sourceUrl.includes("github.com");
        if (!isGitHub) return; // Only fetch from GitHub for now
        
        // Fetch PRs from GitHub API
        const proxyUrl = `/api/github/proxy?endpoint=${encodeURIComponent(`/repos/${owner}/${repoName}/pulls?state=all&per_page=100&sort=updated`)}`;
        
        const response = await fetch(proxyUrl);
        if (response.ok) {
          const list: any[] = await response.json();
          const prs = list.map((pr: any) => ({
            id: `pr-${pr.number}`,
            entity: params.entity,
            repo: params.repo,
            title: pr.title || "",
            number: String(pr.number || ""),
            status: pr.merged_at ? "merged" : (pr.state === "closed" ? "closed" : "open"),
            author: pr.user?.login || "",
            labels: pr.labels?.map((l: any) => l.name || l) || [],
            assignees: [],
            createdAt: pr.created_at ? new Date(pr.created_at).getTime() : Date.now(),
            body: pr.body || "",
            html_url: pr.html_url || "",
            merged_at: pr.merged_at || null,
            head: pr.head?.ref || null,
            base: pr.base?.ref || null,
          }));
          
          // Merge with existing Nostr PRs (preserve Nostr-only PRs)
          const key = getRepoStorageKey("gittr_prs", params.entity, params.repo);
          const existingPRs = JSON.parse(localStorage.getItem(key) || "[]");
          
          // Create a map of GitHub PRs by their number (for matching)
          const githubPRsMap = new Map(prs.map((pr: any) => [pr.number, pr]));
          
          // Find Nostr-only PRs (those not in GitHub by number)
          const nostrOnlyPRs = existingPRs.filter((existing: any) => {
            // If it has a number that matches GitHub, it's from GitHub (or was synced)
            // Nostr-only PRs typically have event.id as their id, not pr-{number}
            const isNostrOnly = !existing.number || !githubPRsMap.has(existing.number);
            // Also check if it's a Nostr event ID format (64-char hex)
            const isNostrEventId = existing.id && /^[0-9a-f]{64}$/i.test(existing.id);
            return isNostrOnly || isNostrEventId;
          });
          
          // Merge: GitHub PRs (source of truth) + Nostr-only PRs
          const mergedPRs = [...prs, ...nostrOnlyPRs];
          
          // Save merged list
          localStorage.setItem(key, JSON.stringify(mergedPRs));
          console.log(`✅ [PRs] Merged ${prs.length} GitHub PRs + ${nostrOnlyPRs.length} Nostr-only PRs = ${mergedPRs.length} total`);
          
          // Reload PRs by triggering the existing useEffect
          const filtered = prs.filter((pr: any) => {
            const prStatus = pr.status || "open";
            if (issueStatus === "open") {
              return prStatus === "open";
            } else {
              return prStatus === "closed" || prStatus === "merged";
            }
          });
          
          const mapped: IPullsData[] = filtered.map((pr: any, idx: number) => ({
            id: pr.id || String(idx),
            entity: params.entity,
            repo: params.repo,
            title: pr.title || `PR ${idx+1}`,
            number: pr.number || String(idx + 1),
            date: pr.createdAt ? formatDateTime24h(pr.createdAt) : "",
            author: pr.author || "you",
            tags: [],
            taskTotal: null,
            taskCompleted: null,
            linkedPR: 0,
            assignees: [],
            comments: 0,
            status: pr.status || "open",
            createdAt: pr.createdAt || Date.now(),
          }));
          mapped.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
          
          const allMapped: IPullsData[] = prs.map((pr: any, idx: number) => ({
            id: pr.id || String(idx),
            entity: params.entity,
            repo: params.repo,
            title: pr.title || `PR ${idx+1}`,
            number: pr.number || String(idx + 1),
            date: pr.createdAt ? formatDateTime24h(pr.createdAt) : "",
            author: pr.author || "you",
            tags: [],
            taskTotal: null,
            taskCompleted: null,
            linkedPR: 0,
            assignees: [],
            comments: 0,
            status: pr.status || "open",
            createdAt: pr.createdAt || Date.now(),
          }));
          
          setAllPRs(allMapped);
          setIssues(mapped);
        }
      } catch (error) {
        console.error("Failed to fetch PRs from GitHub:", error);
      }
    };
    
    fetchFromGitHub();
  }, [mounted, params.entity, params.repo, issueStatus]);

  // Subscribe to PRs from Nostr relays (kind 9804) - handles PRs from any Nostr client (gittr, gitworkshop.dev, etc.)
  useEffect(() => {
    if (!subscribe || !defaultRelays || defaultRelays.length === 0 || !params?.entity || !params?.repo) return;

    // Resolve full pubkey from entity (could be prefix or full pubkey)
    const resolveEntityPubkey = async () => {
      // If entity is already a full 64-char pubkey, use it
      if (params.entity && /^[0-9a-f]{64}$/i.test(params.entity)) {
        return params.entity;
      }
      // Otherwise, try to find the repo and get ownerPubkey
      const repos = JSON.parse(localStorage.getItem("gittr_repos") || "[]");
      const repo = findRepoByEntityAndName(repos, params.entity, params.repo);
      return repo?.ownerPubkey || params.entity;
    };

    let cancelled = false;
    (async () => {
      const entityPubkey = await resolveEntityPubkey();
      if (cancelled) return;

      const unsub = subscribe(
        [
          {
            kinds: [KIND_PULL_REQUEST],
            "#repo": [params.entity, params.repo], // Filter by repo tag
          },
        ],
        defaultRelays,
        (event, isAfterEose, relayURL) => {
          if (event.kind === KIND_PULL_REQUEST) {
            try {
              const prData = JSON.parse(event.content);
              const repoTag = event.tags.find((t: string[]) => t[0] === "repo");
              
              // Verify this PR belongs to the current repo
              if (!repoTag || (repoTag[1] !== params.entity && repoTag[1] !== entityPubkey) || repoTag[2] !== params.repo) {
                return;
              }

              const key = getRepoStorageKey("gittr_prs", params.entity, params.repo);
              const existingPRs = JSON.parse(localStorage.getItem(key) || "[]");
              
              // Check if PR already exists (by event.id for Nostr PRs)
              const existingIndex = existingPRs.findIndex((pr: any) => pr.id === event.id);
              
              // CRITICAL: Don't overwrite GitHub PRs - find next available number
              // GitHub PRs have id format "pr-{number}", Nostr PRs use event.id
              // Find next available number (avoid conflicts with GitHub PRs)
              const maxNumber = existingPRs.reduce((max: number, pr: any) => {
                const num = parseInt(pr.number || "0", 10);
                return num > max ? num : max;
              }, 0);
              const nextNumber = maxNumber + 1;
              
              // Extract branch info, linked issue from tags
              const branchTag = event.tags.find((t: string[]) => t[0] === "branch");
              const linkedIssueTag = event.tags.find((t: string[]) => t[0] === "e" && t[3] === "linked");
              const statusTag = event.tags.find((t: string[]) => t[0] === "status");
              const status = statusTag ? statusTag[1] : (prData.status || "open");

              const pr = {
                id: event.id, // Use Nostr event ID (64-char hex) to identify Nostr-only PRs
                entity: params.entity,
                repo: params.repo,
                title: prData.title || "",
                body: prData.description || "",
                status: status,
                author: event.pubkey,
                contributors: [event.pubkey],
                baseBranch: branchTag ? branchTag[1] : "main",
                headBranch: branchTag ? branchTag[2] : undefined,
                changedFiles: prData.changedFiles || [],
                createdAt: event.created_at * 1000,
                number: String(nextNumber), // Use next available number
                linkedIssue: linkedIssueTag ? linkedIssueTag[1] : undefined,
              };

              if (existingIndex >= 0) {
                existingPRs[existingIndex] = { ...existingPRs[existingIndex], ...pr };
              } else {
                existingPRs.push(pr);
              }

              localStorage.setItem(key, JSON.stringify(existingPRs));
              
              // Trigger reload by updating state
              const filtered = existingPRs.filter((pr: any) => {
                const prStatus = pr.status || "open";
                if (issueStatus === "open") {
                  return prStatus === "open";
                } else {
                  return prStatus === "closed" || prStatus === "merged";
                }
              });
              
              const mapped: IPullsData[] = filtered.map((pr: any, idx: number) => ({
                id: pr.id || String(idx),
                entity: params.entity,
                repo: params.repo,
                title: pr.title || `PR ${idx+1}`,
                number: pr.number || String(idx + 1),
                date: pr.createdAt ? formatDateTime24h(pr.createdAt) : "",
                author: pr.author || "you",
                tags: [],
                taskTotal: null,
                taskCompleted: null,
                linkedPR: 0,
                assignees: [],
                comments: 0,
                status: pr.status || "open",
                createdAt: pr.createdAt || Date.now(),
              }));
              mapped.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
              
              const allMapped: IPullsData[] = existingPRs.map((pr: any, idx: number) => ({
                id: pr.id || String(idx),
                entity: params.entity,
                repo: params.repo,
                title: pr.title || `PR ${idx+1}`,
                number: pr.number || String(idx + 1),
                date: pr.createdAt ? formatDateTime24h(pr.createdAt) : "",
                author: pr.author || "you",
                tags: [],
                taskTotal: null,
                taskCompleted: null,
                linkedPR: 0,
                assignees: [],
                comments: 0,
                status: pr.status || "open",
                createdAt: pr.createdAt || Date.now(),
              }));
              
              setAllPRs(allMapped);
              setIssues(mapped);
            } catch (error: any) {
              console.error("Error processing PR event from Nostr:", error);
            }
          }
        }
      );

      return () => {
        cancelled = true;
        if (unsub) unsub();
      };
    })();
  }, [subscribe, defaultRelays, params?.entity, params?.repo, issueStatus]);

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
        .map(p => p.author)
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
              New pull request
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
                  <Check className="h-5 w-5 mr-2 mt-0.5" /> {mounted ? allPRs.filter(pr => pr.status === "closed" || pr.status === "merged").length : 0} Closed
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
                  Projects <ChevronDown className="h-4 w-4 ml-1 mt-1.5" />
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
              {issues.map((item, idx) => (
                <li
                  key={`${item.id}-${idx}`}
                  className="text-gray-400 grid grid-cols-8 p-2 text-sm hover:bg-dark"
                >
                  <div className="col-span-8 sm:col-span-6">
                    <div className="sm:flex items-center text-lg font-medium">
                      <span className="flex">
                        {item.status === "merged" ? (
                          <GitMerge className="h-5 w-5 mr-2 mt-1 text-purple-600" />
                        ) : item.status === "open" ? (
                          <GitPullRequest className="h-5 w-5 mr-2 mt-1 text-green-600" />
                        ) : (
                          <X className="h-5 w-5 mr-2 mt-1 text-gray-600" />
                        )}
                        <Link
                          className="text-zinc-400 hover:text-purple-500"
                          href={`/${item.entity}/${item.repo}`}
                        >
                          {getEntityDisplayNameForRepo(item.entity, item.repo)}/{item.repo}
                        </Link>
                      </span>

                      <Link
                        className="text-zinc-200 hover:text-purple-500 pl-7 sm:pl-3"
                        href={`/${item.entity}/${item.repo}/pulls/${item.id}`}
                      >
                        {item.title}
                      </Link>
                    </div>
                    <div className="ml-7 text-zinc-400 flex items-center gap-2">
                      #{item.number} {item.status === "merged" ? `merged` : item.status === "closed" ? `closed` : `opened`} {item.date} by{" "}
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
