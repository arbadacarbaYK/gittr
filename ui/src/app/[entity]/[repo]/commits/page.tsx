"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GitBranch, GitCommit, History, Search } from "lucide-react";
import { useNostrContext } from "@/lib/nostr/NostrContext";
import { getRepoStorageKey } from "@/lib/utils/entity-normalizer";
import { useContributorMetadata } from "@/lib/nostr/useContributorMetadata";
import { getEntityDisplayName } from "@/lib/utils/entity-resolver";
import { formatDateTime24h, formatDate24h, formatTime24h } from "@/lib/utils/date-format";

interface Commit {
  id: string; // commit hash or ID
  message: string;
  author: string; // pubkey
  authorName?: string;
  authorPicture?: string;
  timestamp: number;
  branch?: string;
  parentIds?: string[]; // For commit graph
  filesChanged?: number;
  insertions?: number;
  deletions?: number;
  changedFiles?: Array<{ path: string; status: string }>; // Files changed in this commit
  prId?: string; // Related PR ID if commit is from a merged PR
}

export default function CommitsPage({ params }: { params: { entity: string; repo: string } }) {
  const searchParams = useSearchParams();
  const branch = searchParams?.get("branch") || "main";
  const fileFilter = searchParams?.get("file") || null;
  const [commits, setCommits] = useState<Commit[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const { defaultRelays } = useNostrContext();
  
  // Get all unique author pubkeys from commits (only full 64-char pubkeys for metadata lookup)
  const authorPubkeys = useMemo(() => {
    return Array.from(new Set(
      commits
        .map(c => c.author)
        .filter(Boolean)
        .filter(author => /^[a-f0-9]{64}$/i.test(author)) // Only full 64-char pubkeys
    ));
  }, [commits]);
  
  // Fetch Nostr metadata for all commit authors
  const authorMetadata = useContributorMetadata(authorPubkeys);

  const loadCommits = useCallback(() => {
    try {
      // Load commits from localStorage
      const commitsKey = getRepoStorageKey("gittr_commits", params.entity, params.repo);
      const allCommits = JSON.parse(localStorage.getItem(commitsKey) || "[]") as Commit[];
      
      // Filter by branch if specified
      let branchCommits = allCommits.filter(c => !c.branch || c.branch === branch);
      
      // Filter by file if specified (show commits that touched this file)
      if (fileFilter) {
        branchCommits = branchCommits.filter(c => 
          c.changedFiles?.some(f => f.path === fileFilter) ||
          (c as any).prId && (() => {
            try {
              const prsKey = getRepoStorageKey("gittr_prs", params.entity, params.repo);
              const prs = JSON.parse(localStorage.getItem(prsKey) || "[]");
              const pr = prs.find((p: any) => p.id === (c as any).prId);
              return pr?.path === fileFilter;
            } catch { return false; }
          })()
        );
      }
      
      // Sort by timestamp (newest first)
      branchCommits.sort((a, b) => b.timestamp - a.timestamp);
      
      setCommits(branchCommits);
      setLoading(false);
    } catch (error) {
      console.error("Failed to load commits:", error);
      setLoading(false);
    }
  }, [params.entity, params.repo, branch, fileFilter]);

  useEffect(() => {
    loadCommits();
  }, [loadCommits]);

  // Listen for new commits
  useEffect(() => {
    const commitsKey = getRepoStorageKey("gittr_commits", params.entity, params.repo);
    
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === commitsKey) {
        loadCommits();
      }
    };
    
    const handleCommitCreated = () => {
      loadCommits();
    };
    
    window.addEventListener("storage", handleStorageChange);
    window.addEventListener("gittr:commit-created", handleCommitCreated);
    
    return () => {
      window.removeEventListener("storage", handleStorageChange);
      window.removeEventListener("gittr:commit-created", handleCommitCreated);
    };
  }, [params.entity, params.repo, loadCommits]);

  const filteredCommits = useMemo(() => {
    if (!searchQuery.trim()) return commits;
    const query = searchQuery.toLowerCase();
    return commits.filter(c => 
      c.message.toLowerCase().includes(query) ||
      c.author.toLowerCase().includes(query) ||
      c.id.toLowerCase().includes(query)
    );
  }, [commits, searchQuery]);

  if (loading) {
    return <div className="container mx-auto max-w-[95%] xl:max-w-[90%] 2xl:max-w-[85%] p-6">Loading commits...</div>;
  }

  return (
    <div className="container mx-auto max-w-[95%] xl:max-w-[90%] 2xl:max-w-[85%] p-6">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <History className="h-6 w-6" />
            Commits
            {fileFilter && (
              <span className="text-base font-normal text-gray-400 ml-2">
                for <code className="px-2 py-1 bg-gray-800 rounded text-sm">{fileFilter}</code>
              </span>
            )}
          </h1>
          <div className="flex items-center gap-2">
            <GitBranch className="h-4 w-4 text-gray-400" />
            <span className="text-sm text-gray-400">{branch}</span>
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            type="text"
            placeholder="Search commits by message, author, or hash..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 bg-gray-800 border-gray-700"
          />
        </div>
      </div>

      {/* Commits List */}
      {filteredCommits.length === 0 ? (
        <div className="border border-gray-700 rounded p-8 text-center">
          <GitCommit className="h-12 w-12 mx-auto mb-4 text-gray-600" />
          <p className="text-gray-400 mb-2">No commits found</p>
          <p className="text-sm text-gray-500">
            {commits.length === 0 
              ? "Commits will appear here when you merge pull requests or make changes."
              : "No commits match your search."}
          </p>
        </div>
      ) : (
        <div className="border border-gray-700 rounded">
          <ul className="divide-y divide-gray-700">
            {filteredCommits.map((commit, index) => {
              const isFirst = index === 0;
              const isLast = index === filteredCommits.length - 1;
              
              return (
                <li key={commit.id} className="p-4 hover:bg-gray-800/50 transition-colors">
                  <div className="flex gap-4">
                    {/* Commit Graph Line */}
                    <div className="flex flex-col items-center w-8">
                      {!isFirst && (
                        <div className="w-0.5 h-4 bg-gray-600 flex-grow" />
                      )}
                      <div className="w-3 h-3 rounded-full bg-purple-600 border-2 border-gray-900" />
                      {!isLast && (
                        <div className="w-0.5 flex-grow bg-gray-600" />
                      )}
                    </div>

                    {/* Commit Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-4 mb-2">
                        <div className="flex-1 min-w-0">
                          <Link
                            href={`/${params.entity}/${params.repo}/commits/${commit.id}`}
                            className="text-lg font-semibold text-purple-400 hover:text-purple-300 hover:underline block truncate"
                          >
                            {commit.message}
                          </Link>
                          <div className="flex items-center gap-2 mt-1 text-sm text-gray-400">
                            <Link
                              href={`/${commit.author}`}
                              className="hover:text-purple-400 flex items-center gap-2"
                            >
                              <Avatar className="h-5 w-5 shrink-0 overflow-hidden">
                                {(() => {
                                  // Priority: commit.authorPicture > Nostr metadata picture
                                  const meta = authorMetadata[commit.author];
                                  const picture = commit.authorPicture && commit.authorPicture.startsWith("http")
                                    ? commit.authorPicture
                                    : (meta?.picture && meta.picture.startsWith("http"))
                                      ? meta.picture
                                      : null;
                                  return picture ? (
                                  <AvatarImage 
                                      src={picture} 
                                    className="object-cover max-w-full max-h-full"
                                    style={{ maxWidth: '100%', maxHeight: '100%' }}
                                  />
                                  ) : null;
                                })()}
                                <AvatarFallback className="bg-purple-600 text-white text-[10px]">
                                  {(() => {
                                    const name = getEntityDisplayName(commit.author, authorMetadata, commit.author.slice(0, 8));
                                    return name.slice(0, 2).toUpperCase();
                                  })()}
                                </AvatarFallback>
                              </Avatar>
                              <span>
                                {(() => {
                                  const meta = authorMetadata[commit.author];
                                  return getEntityDisplayName(commit.author, authorMetadata, commit.author.slice(0, 8));
                                })()}...
                              </span>
                            </Link>
                            <span>•</span>
                            <span>{formatDateTime24h(commit.timestamp)}</span>
                            {commit.branch && (
                              <>
                                <span>•</span>
                                <Badge variant="outline" className="text-xs">
                                  {commit.branch}
                                </Badge>
                              </>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 text-sm text-gray-400">
                          {commit.filesChanged !== undefined && (
                            <span>{commit.filesChanged} file{commit.filesChanged !== 1 ? "s" : ""}</span>
                          )}
                          {commit.insertions !== undefined && commit.insertions > 0 && (
                            <span className="text-green-400">+{commit.insertions}</span>
                          )}
                          {commit.deletions !== undefined && commit.deletions > 0 && (
                            <span className="text-red-400">-{commit.deletions}</span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/${params.entity}/${params.repo}/commits/${commit.id}`}
                          className="text-xs font-mono text-gray-500 hover:text-gray-400"
                        >
                          {commit.id.slice(0, 7)}
                        </Link>
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Stats */}
      {filteredCommits.length > 0 && (
        <div className="mt-4 text-sm text-gray-400">
          Showing {filteredCommits.length} of {commits.length} commit{commits.length !== 1 ? "s" : ""}
        </div>
      )}
    </div>
  );
}

