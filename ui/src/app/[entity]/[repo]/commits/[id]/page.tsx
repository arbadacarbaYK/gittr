"use client";

import { getRepoStorageKey } from "@/lib/utils/entity-normalizer";

import { useEffect, useState, use } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GitCommit, GitBranch, Calendar, User, FileDiff } from "lucide-react";
import { formatDateTime24h, formatDate24h, formatTime24h } from "@/lib/utils/date-format";

interface Commit {
  id: string;
  message: string;
  author: string;
  authorName?: string;
  authorPicture?: string;
  timestamp: number;
  branch?: string;
  parentIds?: string[];
  filesChanged?: number;
  insertions?: number;
  deletions?: number;
  changedFiles?: Array<{ path: string; status: "added" | "modified" | "deleted" }>;
  prId?: string;
}

interface FileDiff {
  path: string;
  status: "added" | "modified" | "deleted";
  additions?: number;
  deletions?: number;
  before?: string;
  after?: string;
}

export default function CommitDetailPage({ params }: { params: Promise<{ entity: string; repo: string; id: string }> }) {
  const resolvedParams = use(params);
  const [commit, setCommit] = useState<Commit | null>(null);
  const [loading, setLoading] = useState(true);
  const [fileDiffs, setFileDiffs] = useState<FileDiff[]>([]);

  useEffect(() => {
    try {
      const commitsKey = getRepoStorageKey("gittr_commits", resolvedParams.entity, resolvedParams.repo);
      const commits = JSON.parse(localStorage.getItem(commitsKey) || "[]") as Commit[];
      const commitData = commits.find(c => c.id === resolvedParams.id || c.id.startsWith(resolvedParams.id));
      
      if (commitData) {
        setCommit(commitData);
        
        // Load file diffs - try changedFiles first, then PR if available
        let diffs: FileDiff[] = [];
        
        if (commitData.changedFiles && commitData.changedFiles.length > 0) {
          // Commit has changedFiles directly (from merge)
          diffs = commitData.changedFiles.map((file: any) => {
            // Try to load before/after from PR if available
            let before: string | undefined;
            let after: string | undefined;
            
            if (commitData.prId) {
              try {
                const prsKey = getRepoStorageKey("gittr_prs", resolvedParams.entity, resolvedParams.repo);
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                const prs = JSON.parse(localStorage.getItem(prsKey) || "[]");
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any
                const pr = prs.find((p: any) => p.id === commitData.prId);
                if (pr) {
                  // Support both multi-file (changedFiles) and legacy single-file (path/before/after)
                  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
                  if (pr.changedFiles && pr.changedFiles.length > 0) {
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any
                    const fileChange = pr.changedFiles.find((f: any) => f.path === file.path);
                    if (fileChange) {
                      before = fileChange.before;
                      after = fileChange.after;
                    }
                  } else if (pr.path === file.path) {
                    // Legacy single-file PR
                    before = pr.before;
                    after = pr.after;
                  }
                }
              } catch {}
            }
            
            return {
              path: file.path,
              status: file.status as "added" | "modified" | "deleted",
              before,
              after,
            };
          });
        } else if (commitData.prId) {
          // Commit doesn't have changedFiles, but has prId - load from PR
          try {
            const prsKey = getRepoStorageKey("gittr_prs", resolvedParams.entity, resolvedParams.repo);
            const prs = JSON.parse(localStorage.getItem(prsKey) || "[]");
            const pr = prs.find((p: any) => p.id === commitData.prId);
            if (pr) {
              if (pr.changedFiles && pr.changedFiles.length > 0) {
                diffs = pr.changedFiles.map((f: any) => ({
                  path: f.path,
                  status: f.status as "added" | "modified" | "deleted",
                  before: f.before,
                  after: f.after,
                }));
              } else if (pr.path) {
                // Legacy single-file PR
                diffs = [{
                  path: pr.path,
                  status: "modified" as const,
                  before: pr.before,
                  after: pr.after,
                }];
              }
            }
          } catch {}
        }
        
        setFileDiffs(diffs);
      }
    } catch (error) {
      console.error("Failed to load commit:", error);
    } finally {
      setLoading(false);
    }
  }, [resolvedParams.entity, resolvedParams.repo, resolvedParams.id]);

  if (loading) {
    return <div className="container mx-auto max-w-[95%] xl:max-w-[90%] 2xl:max-w-[85%] p-6">Loading commit...</div>;
  }

  if (!commit) {
    return (
      <div className="container mx-auto max-w-[95%] xl:max-w-[90%] 2xl:max-w-[85%] p-6">
        <p className="text-gray-400">Commit not found</p>
        <Link href={`/${resolvedParams.entity}/${resolvedParams.repo}/commits`} className="text-purple-500 hover:underline">
          Back to commits
        </Link>
      </div>
    );
  }

  // Split commit message into title and body
  const messageLines = commit.message.split("\n");
  const title = messageLines[0];
  const body = messageLines.slice(1).join("\n").trim();

  return (
    <div className="container mx-auto max-w-[95%] xl:max-w-[90%] 2xl:max-w-[85%] p-6">
      {/* Breadcrumbs */}
      <nav className="mb-4 text-sm text-gray-400">
        <Link href={`/${resolvedParams.entity}/${resolvedParams.repo}`} className="hover:text-purple-400">
          {resolvedParams.entity}/{resolvedParams.repo}
        </Link>
        {" / "}
        <Link href={`/${resolvedParams.entity}/${resolvedParams.repo}/commits`} className="hover:text-purple-400">
          Commits
        </Link>
        {" / "}
        <span className="font-mono">{commit.id.slice(0, 7)}</span>
      </nav>

      {/* Commit Header */}
      <div className="border border-gray-700 rounded p-6 mb-6">
        <div className="flex items-start gap-4 mb-4">
          <div className="w-10 h-10 rounded-full bg-purple-600 flex items-center justify-center">
            <GitCommit className="h-5 w-5 text-white" />
          </div>
          <div className="flex-1">
            <h1 className="text-2xl font-bold mb-2">{title}</h1>
            {body && (
              <div className="text-gray-300 whitespace-pre-wrap mb-4">{body}</div>
            )}
            
            <div className="flex flex-wrap items-center gap-4 text-sm text-gray-400">
              <div className="flex items-center gap-2">
                <User className="h-4 w-4" />
                <Link href={`/${commit.author}`} className="hover:text-purple-400 flex items-center gap-2">
                  <Avatar className="h-5 w-5 shrink-0 overflow-hidden">
                    {commit.authorPicture && commit.authorPicture.startsWith("http") ? (
                      <AvatarImage 
                        src={commit.authorPicture} 
                        className="object-cover max-w-full max-h-full"
                        style={{ maxWidth: '100%', maxHeight: '100%' }}
                      />
                    ) : null}
                    <AvatarFallback className="bg-purple-600 text-white text-[10px]">
                      {commit.authorName?.slice(0, 2).toUpperCase() || commit.author.slice(0, 2)}
                    </AvatarFallback>
                  </Avatar>
                  <span>{commit.authorName || commit.author.slice(0, 8)}...</span>
                </Link>
              </div>
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                <span>{formatDateTime24h(commit.timestamp)}</span>
              </div>
              {commit.branch && (
                <div className="flex items-center gap-2">
                  <GitBranch className="h-4 w-4" />
                  <Badge variant="outline">{commit.branch}</Badge>
                </div>
              )}
              <div className="flex items-center gap-2">
                <FileDiff className="h-4 w-4" />
                <span>
                  {commit.filesChanged || 0} file{(commit.filesChanged || 0) !== 1 ? "s" : ""} changed
                  {commit.insertions !== undefined && commit.insertions > 0 && (
                    <span className="ml-2 text-green-400">+{commit.insertions}</span>
                  )}
                  {commit.deletions !== undefined && commit.deletions > 0 && (
                    <span className="text-red-400">-{commit.deletions}</span>
                  )}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-4 pt-4 border-t border-gray-700">
          <div className="flex items-center gap-2 text-sm">
            <span className="font-mono text-gray-400">Commit:</span>
            <code className="px-2 py-1 bg-gray-800 rounded text-purple-400">{commit.id}</code>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                navigator.clipboard.writeText(commit.id);
              }}
            >
              Copy
            </Button>
          </div>
        </div>
      </div>

      {/* File Changes */}
      {fileDiffs.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold">Files changed</h2>
          {fileDiffs.map((diff, idx) => (
            <div key={idx} className="border border-gray-700 rounded">
              <div className="p-4 bg-gray-800 border-b border-gray-700">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Badge
                      className={
                        diff.status === "added"
                          ? "bg-green-600"
                          : diff.status === "deleted"
                          ? "bg-red-600"
                          : "bg-yellow-600"
                      }
                    >
                      {diff.status}
                    </Badge>
                    <Link
                      href={`/${resolvedParams.entity}/${resolvedParams.repo}?file=${diff.path}`}
                      className="text-purple-400 hover:text-purple-300 font-mono text-sm"
                    >
                      {diff.path}
                    </Link>
                  </div>
                  {diff.additions !== undefined && diff.deletions !== undefined && (
                    <div className="text-sm text-gray-400">
                      <span className="text-green-400">+{diff.additions}</span>
                      {" "}
                      <span className="text-red-400">-{diff.deletions}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Diff Content */}
              {(diff.before || diff.after) && (
                <div className="grid grid-cols-2 gap-0">
                  {diff.before && (
                    <div>
                      <div className="p-2 bg-[#0E1116] border-r border-gray-700 text-xs text-gray-400 font-semibold">
                        Before
                      </div>
                      <pre className="bg-[#0E1116] p-4 overflow-auto text-sm font-mono whitespace-pre-wrap text-gray-300 border-r border-gray-700 max-h-[40vh]">
                        {diff.before}
                      </pre>
                    </div>
                  )}
                  {diff.after && (
                    <div>
                      <div className="p-2 bg-[#0E1116] text-xs text-gray-400 font-semibold">
                        After
                      </div>
                      <pre className="bg-[#0E1116] p-4 overflow-auto text-sm font-mono whitespace-pre-wrap text-gray-100 max-h-[40vh]">
                        {diff.after}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {fileDiffs.length === 0 && (
        <div className="border border-gray-700 rounded p-8 text-center text-gray-400">
          No file changes available for this commit.
        </div>
      )}
    </div>
  );
}

