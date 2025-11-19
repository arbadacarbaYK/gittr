"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import Link from "next/link";
import { Search, Coins, CircleDot, GitPullRequest, TrendingUp, Clock, DollarSign, Filter, ArrowUpDown, CheckCircle2, Tag, AlertCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useContributorMetadata } from "@/lib/nostr/useContributorMetadata";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { formatDateTime24h, formatDate24h, formatTime24h } from "@/lib/utils/date-format";

interface BountyIssue {
  id: string;
  title: string;
  entity: string;
  repo: string;
  number: string;
  bountyAmount: number;
  bountyStatus: "pending" | "paid" | "released" | "offline";
  author: string;
  status: "open" | "closed";
  createdAt: number;
  labels?: string[];
  linkedPR?: string;
  linkedPRTitle?: string;
  linkedPRAuthor?: string;
}

type SortOption = "amount" | "date" | "repo";

export default function BountyHuntPage() {
  const [search, setSearch] = useState("");
  const [bountyIssues, setBountyIssues] = useState<BountyIssue[]>([]);
  const [filterStatus, setFilterStatus] = useState<"all" | "pending" | "paid" | "released" | "offline">("all");
  const [sortBy, setSortBy] = useState<SortOption>("amount");

  const loadBountyIssues = useCallback(() => {
    // Load all issues from all repos and filter for ones with bounties
    try {
      const repos = JSON.parse(localStorage.getItem("gittr_repos") || "[]");
      const allIssues: BountyIssue[] = [];

      repos.forEach((repo: any) => {
        const entity = repo.entity || repo.slug?.split("/")[0];
        const repoName = repo.repo || repo.slug?.split("/")[1] || repo.slug;
        if (!entity || !repoName) return;

        const issues = JSON.parse(
          localStorage.getItem(`gittr_issues__${entity}__${repoName}`) || "[]"
        );

        // Load linked PRs for this repo
        const prKey = `gittr_prs__${entity}__${repoName}`;
        const repoPRs = JSON.parse(localStorage.getItem(prKey) || "[]") as any[];
        
        issues.forEach((issue: any) => {
          if (issue.bountyAmount || issue.bountyStatus) {
            // Find PR linked to this issue
            const linkedPR = repoPRs.find((pr: any) => 
              pr.linkedIssueId === issue.id || 
              pr.issueId === issue.id ||
              pr.linkedIssue === issue.id
            );
            
            allIssues.push({
              id: issue.id || issue.number,
              title: issue.title,
              entity,
              repo: repoName,
              number: issue.number || issue.id,
              bountyAmount: issue.bountyAmount || 0,
              bountyStatus: issue.bountyStatus || "pending",
              author: issue.author || "unknown",
              status: issue.status || "open",
              createdAt: issue.createdAt || Date.now(),
              labels: issue.labels || [],
              linkedPR: linkedPR ? (linkedPR.id || linkedPR.number) : undefined,
              linkedPRTitle: linkedPR?.title,
              linkedPRAuthor: linkedPR?.author,
            });
          }
        });
      });

      // Initial sort - will be re-sorted based on sortBy state
      // Sort by bounty amount (highest first), then by status (paid > pending > released)
      allIssues.sort((a, b) => {
        const statusOrder: Record<string, number> = { paid: 0, pending: 1, released: 2, offline: 3 };
        if (a.bountyAmount !== b.bountyAmount) {
          return b.bountyAmount - a.bountyAmount;
        }
        return (statusOrder[a.bountyStatus] || 999) - (statusOrder[b.bountyStatus] || 999);
      });

      setBountyIssues(allIssues);
    } catch (error) {
      console.error("Failed to load bounty issues:", error);
    }
  }, []);

  useEffect(() => {
    // Load on mount
    loadBountyIssues();

    // Listen for new issues and updates
    const handleIssueCreated = () => {
      loadBountyIssues();
    };
    const handleIssueUpdated = () => {
      loadBountyIssues();
    };
    const handleStorageChange = (e: StorageEvent) => {
      // Refresh if issues or repos changed
      if (e.key?.startsWith("gittr_issues__") || e.key === "gittr_repos") {
        loadBountyIssues();
      }
    };

    window.addEventListener("gittr:issue-created", handleIssueCreated);
    window.addEventListener("gittr:issue-updated", handleIssueUpdated);
    window.addEventListener("storage", handleStorageChange);

    return () => {
      window.removeEventListener("gittr:issue-created", handleIssueCreated);
      window.removeEventListener("gittr:issue-updated", handleIssueUpdated);
      window.removeEventListener("storage", handleStorageChange);
    };
  }, [loadBountyIssues]);

  // Get all unique author pubkeys (including linked PR authors, only full 64-char pubkeys for metadata lookup)
  const authorPubkeys = useMemo(() => {
    const pubkeys = new Set<string>();
    bountyIssues.forEach(issue => {
      if (issue.author && /^[a-f0-9]{64}$/i.test(issue.author)) pubkeys.add(issue.author);
      if (issue.linkedPRAuthor && /^[a-f0-9]{64}$/i.test(issue.linkedPRAuthor)) pubkeys.add(issue.linkedPRAuthor);
    });
    return Array.from(pubkeys);
  }, [bountyIssues]);

  // Fetch Nostr metadata for all authors
  const authorMetadata = useContributorMetadata(authorPubkeys);

  const filteredAndSortedIssues = useMemo(() => {
    let filtered = [...bountyIssues];

    // Filter by status
    if (filterStatus !== "all") {
      filtered = filtered.filter(issue => issue.bountyStatus === filterStatus);
    }

    // Filter by search query
    if (search.trim()) {
      const query = search.toLowerCase();
      filtered = filtered.filter(issue => {
        return (
          issue.title.toLowerCase().includes(query) ||
          `${issue.entity}/${issue.repo}`.toLowerCase().includes(query) ||
          issue.author.toLowerCase().includes(query) ||
          issue.number.toLowerCase().includes(query) ||
          issue.labels?.some(label => label.toLowerCase().includes(query))
        );
      });
    }

    // Sort
    filtered.sort((a, b) => {
      if (sortBy === "amount") {
        // Highest amount first, then by status
        const statusOrder: Record<string, number> = { paid: 0, pending: 1, released: 2, offline: 3 };
        if (a.bountyAmount !== b.bountyAmount) {
          return b.bountyAmount - a.bountyAmount;
        }
        return (statusOrder[a.bountyStatus] || 999) - (statusOrder[b.bountyStatus] || 999);
      } else if (sortBy === "date") {
        // Newest first
        return b.createdAt - a.createdAt;
      } else if (sortBy === "repo") {
        // Alphabetical by repo
        const aRepo = `${a.entity}/${a.repo}`;
        const bRepo = `${b.entity}/${b.repo}`;
        return aRepo.localeCompare(bRepo);
      }
      return 0;
    });

    return filtered;
  }, [bountyIssues, filterStatus, search, sortBy]);

  const totalBounties = useMemo(() => {
    return filteredAndSortedIssues.reduce((sum, issue) => sum + issue.bountyAmount, 0);
  }, [filteredAndSortedIssues]);

  const statusCounts = useMemo(() => {
    return {
      pending: bountyIssues.filter(i => i.bountyStatus === "pending").length,
      paid: bountyIssues.filter(i => i.bountyStatus === "paid").length,
      released: bountyIssues.filter(i => i.bountyStatus === "released").length,
      offline: bountyIssues.filter(i => i.bountyStatus === "offline").length,
    };
  }, [bountyIssues]);

  return (
    <div className="container mx-auto max-w-[95%] xl:max-w-[90%] 2xl:max-w-[85%] p-6">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2 flex items-center gap-2">
          <Coins className="h-8 w-8 text-yellow-500" />
          Bounty Hunt
        </h1>
        <p className="text-gray-400">
          Find and claim bounties on open issues. Earn sats for solving problems!
        </p>
      </div>

      <div className="mb-6 grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="border border-[#383B42] rounded p-4 bg-[#171B21]">
          <div className="text-sm text-gray-400 mb-1">Total Available</div>
          <div className="text-2xl font-bold text-green-400">{totalBounties.toLocaleString()} sats</div>
        </div>
        <div className="border border-[#383B42] rounded p-4 bg-[#171B21]">
          <div className="text-sm text-gray-400 mb-1">Pending Payment</div>
          <div className="text-2xl font-bold text-yellow-400">
            {bountyIssues.filter(i => i.bountyStatus === "pending").reduce((sum, i) => sum + i.bountyAmount, 0).toLocaleString()} sats
          </div>
        </div>
        <div className="border border-[#383B42] rounded p-4 bg-[#171B21]">
          <div className="text-sm text-gray-400 mb-1">Available Bounties</div>
          <div className="text-2xl font-bold text-purple-400">{statusCounts.paid}</div>
        </div>
        <div className="border border-[#383B42] rounded p-4 bg-[#171B21]">
          <div className="text-sm text-gray-400 mb-1">Total Bounties</div>
          <div className="text-2xl font-bold">{bountyIssues.length}</div>
        </div>
      </div>

      <div className="mb-4 space-y-4">
        {/* Search and Sort Row */}
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                className="pl-10 bg-[#171B21] border-[#383B42]"
                type="text"
                placeholder="Search bounties by title, repo, author, or tags..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-gray-400" />
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortOption)}
              className="px-3 py-2 bg-[#171B21] border border-[#383B42] rounded text-white text-sm"
            >
              <option value="amount">Sort by Amount</option>
              <option value="date">Sort by Date</option>
              <option value="repo">Sort by Repo</option>
            </select>
          </div>
        </div>
        
        {/* Filter Buttons */}
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setFilterStatus("all")}
            className={`px-4 py-2 rounded-md border transition-all ${
              filterStatus === "all"
                ? "bg-purple-600 border-purple-500 text-white"
                : "bg-[#171B21] border-[#383B42] text-gray-300 hover:bg-white/5 hover:border-purple-600/50"
            }`}
          >
            All ({bountyIssues.length})
          </button>
          <button
            onClick={() => setFilterStatus("paid")}
            className={`px-4 py-2 rounded-md border transition-all ${
              filterStatus === "paid"
                ? "bg-green-600/80 border-green-500 text-white"
                : "bg-[#171B21] border-[#383B42] text-gray-300 hover:bg-white/5 hover:border-green-600/50"
            }`}
          >
            <Coins className="inline h-4 w-4 mr-1" />
            Available ({statusCounts.paid})
          </button>
          <button
            onClick={() => setFilterStatus("pending")}
            className={`px-4 py-2 rounded-md border transition-all ${
              filterStatus === "pending"
                ? "bg-yellow-600/80 border-yellow-500 text-white"
                : "bg-[#171B21] border-[#383B42] text-gray-300 hover:bg-white/5 hover:border-yellow-600/50"
            }`}
          >
            <Clock className="inline h-4 w-4 mr-1" />
            Pending ({statusCounts.pending})
          </button>
          <button
            onClick={() => setFilterStatus("released")}
            className={`px-4 py-2 rounded-md border transition-all ${
              filterStatus === "released"
                ? "bg-purple-600/80 border-purple-500 text-white"
                : "bg-[#171B21] border-[#383B42] text-gray-300 hover:bg-white/5 hover:border-purple-600/50"
            }`}
          >
            <CheckCircle2 className="inline h-4 w-4 mr-1" />
            Claimed ({statusCounts.released})
          </button>
          {statusCounts.offline > 0 && (
            <button
              onClick={() => setFilterStatus("offline")}
              className={`px-4 py-2 rounded-md border transition-all ${
                filterStatus === "offline"
                  ? "bg-gray-600/80 border-gray-500 text-white"
                  : "bg-[#171B21] border-[#383B42] text-gray-300 hover:bg-white/5 hover:border-gray-600/50"
              }`}
            >
              <AlertCircle className="inline h-4 w-4 mr-1" />
              Offline ({statusCounts.offline})
            </button>
          )}
        </div>
      </div>

      {/* Bounty Cards Grid */}
      {filteredAndSortedIssues.length === 0 ? (
        <div className="border border-[#383B42] rounded p-12 text-center">
          <Coins className="h-16 w-16 mx-auto mb-4 text-gray-500" />
          <h3 className="text-xl font-semibold mb-2 text-white">
            {search.trim() ? "No bounties match your search" : "No bounties found"}
          </h3>
          <p className="text-gray-400">
            {search.trim()
              ? "Try adjusting your search terms or filters"
              : "Bounties will appear here when added to issues. Start by adding a bounty to an issue!"}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
          {filteredAndSortedIssues.map((issue) => {
            const isHighValue = issue.bountyAmount >= 10000; // Highlight 10k+ sats
            const isAvailable = issue.bountyStatus === "paid";
            
            return (
              <Link
                key={`${issue.entity}/${issue.repo}/${issue.id}`}
                href={`/${issue.entity}/${issue.repo}/issues/${issue.number}`}
                className={`block border rounded-lg p-5 transition-all ${
                  isHighValue && isAvailable
                    ? "border-yellow-500/50 bg-yellow-900/10 hover:bg-yellow-900/20 hover:border-yellow-500 shadow-lg shadow-yellow-900/20"
                    : "border-[#383B42] bg-[#171B21] hover:bg-white/5 hover:border-purple-600/50"
                }`}
              >
                {/* Header with repo info and status */}
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <CircleDot
                        className={`h-4 w-4 ${
                          issue.status === "open" ? "text-green-500" : "text-purple-500"
                        }`}
                      />
                      <Link
                        href={`/${issue.entity}/${issue.repo}`}
                        className="text-purple-400 hover:text-purple-300 font-medium text-sm"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {issue.entity}/{issue.repo}
                      </Link>
                      <span className="text-gray-500 text-sm">#{issue.number}</span>
                    </div>
                  </div>
                  <Badge
                    className={
                      issue.bountyStatus === "paid"
                        ? "bg-green-900/40 text-green-400 border-green-700"
                        : issue.bountyStatus === "pending"
                        ? "bg-yellow-900/40 text-yellow-400 border-yellow-700"
                        : issue.bountyStatus === "offline"
                        ? "bg-gray-900/40 text-gray-400 border-gray-700"
                        : "bg-purple-900/40 text-purple-400 border-purple-700"
                    }
                  >
                    {issue.bountyStatus === "paid"
                      ? "Available"
                      : issue.bountyStatus === "pending"
                      ? "Pending"
                      : issue.bountyStatus === "offline"
                      ? "Offline"
                      : "Claimed"}
                  </Badge>
                </div>

                {/* Title */}
                <h3 className="text-lg font-bold text-white mb-3 line-clamp-2 hover:text-purple-400">
                  {issue.title}
                </h3>

                {/* Labels */}
                {issue.labels && issue.labels.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-3">
                    {issue.labels.slice(0, 3).map((label, idx) => (
                      <Badge key={idx} variant="outline" className="text-xs border-purple-700 text-purple-400">
                        <Tag className="h-3 w-3 mr-1" />
                        {label}
                      </Badge>
                    ))}
                    {issue.labels.length > 3 && (
                      <Badge variant="outline" className="text-xs border-gray-700 text-gray-400">
                        +{issue.labels.length - 3}
                      </Badge>
                    )}
                  </div>
                )}

                {/* Linked PR (if exists) */}
                {issue.linkedPR && (
                  <div className="mb-3 p-2 bg-purple-900/20 border border-purple-700/50 rounded text-sm">
                    <div className="flex items-center gap-2 text-purple-400">
                      <GitPullRequest className="h-4 w-4" />
                      <Link
                        href={`/${issue.entity}/${issue.repo}/pulls/${issue.linkedPR}`}
                        className="hover:underline font-medium"
                        onClick={(e) => e.stopPropagation()}
                      >
                        PR #{issue.linkedPR}
                      </Link>
                      {issue.linkedPRTitle && (
                        <span className="text-gray-400">- {issue.linkedPRTitle}</span>
                      )}
                    </div>
                    {issue.linkedPRAuthor && (
                      <div className="text-xs text-gray-500 mt-1 flex items-center gap-1">
                        By{" "}
                        <Link href={`/${issue.linkedPRAuthor}`} className="hover:text-purple-400 flex items-center gap-1">
                          <Avatar className="h-3 w-3">
                            {(() => {
                              const meta = authorMetadata[issue.linkedPRAuthor];
                              const picture = meta?.picture;
                              return picture && picture.startsWith("http") ? (
                                <AvatarImage src={picture} />
                              ) : null;
                            })()}
                            <AvatarFallback className="bg-purple-600 text-white text-[8px]">
                              {(() => {
                                const meta = authorMetadata[issue.linkedPRAuthor];
                                const name = meta?.display_name || meta?.name || issue.linkedPRAuthor.slice(0, 8);
                                return name.slice(0, 2).toUpperCase();
                              })()}
                            </AvatarFallback>
                          </Avatar>
                          <span>
                            {(() => {
                              const meta = authorMetadata[issue.linkedPRAuthor];
                              return meta?.display_name || meta?.name || issue.linkedPRAuthor.slice(0, 8) + "...";
                            })()}
                          </span>
                        </Link>
                      </div>
                    )}
                  </div>
                )}

                {/* Footer with amount and metadata */}
                <div className="flex items-center justify-between pt-3 border-t border-[#383B42]">
                  <div className="flex items-center gap-3">
                    <div className={`text-2xl font-bold ${
                      isHighValue ? "text-yellow-400" : "text-green-400"
                    }`}>
                      💰 {issue.bountyAmount.toLocaleString()}
                    </div>
                    <span className="text-xs text-gray-500">sats</span>
                  </div>
                  <div className="text-xs text-gray-400 text-right">
                    <div>{formatDate24h(issue.createdAt)}</div>
                    <div className="text-gray-500 flex items-center gap-1 justify-end">
                      <Link href={`/${issue.author}`} className="hover:text-purple-400 flex items-center gap-1">
                        <Avatar className="h-3 w-3">
                          {(() => {
                            const meta = authorMetadata[issue.author];
                            const picture = meta?.picture;
                            return picture && picture.startsWith("http") ? (
                              <AvatarImage src={picture} />
                            ) : null;
                          })()}
                          <AvatarFallback className="bg-purple-600 text-white text-[8px]">
                            {(() => {
                              const meta = authorMetadata[issue.author];
                              const name = meta?.display_name || meta?.name || issue.author.slice(0, 8);
                              return name.slice(0, 2).toUpperCase();
                            })()}
                          </AvatarFallback>
                        </Avatar>
                        <span>
                          {(() => {
                            const meta = authorMetadata[issue.author];
                            return meta?.display_name || meta?.name || issue.author.slice(0, 8) + "...";
                          })()}
                        </span>
                      </Link>
                    </div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

