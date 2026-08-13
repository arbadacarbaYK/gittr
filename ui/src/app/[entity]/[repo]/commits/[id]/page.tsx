"use client";

import { use, useEffect, useState } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FileDiffViewer } from "@/components/ui/file-diff-viewer";
import { parseGitHubRepoSpec } from "@/lib/nostr/nip82-repository-links";
import { type StoredRepo, loadStoredRepos } from "@/lib/repos/storage";
import { resolveGithubUpstreamForTabs } from "@/lib/repos/upstream-precedence";
import { formatDateTime24h } from "@/lib/utils/date-format";
import { getRepoStorageKey } from "@/lib/utils/entity-normalizer";
import { findRepoByEntityAndName } from "@/lib/utils/repo-finder";

import { Calendar, FileDiff, GitBranch, GitCommit, User } from "lucide-react";
import Link from "next/link";

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
  changedFiles?: Array<{
    path: string;
    status: "added" | "modified" | "deleted";
  }>;
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

function mapGithubFileStatus(
  status: string | undefined
): "added" | "modified" | "deleted" {
  const s = (status || "").toLowerCase();
  if (s === "added" || s === "copied") return "added";
  if (s === "removed") return "deleted";
  return "modified";
}

async function fetchGithubCommitFiles(
  entity: string,
  repo: string,
  sha: string
): Promise<FileDiff[]> {
  const rec =
    findRepoByEntityAndName<StoredRepo>(loadStoredRepos(), entity, repo) ??
    null;
  const sourceUrl = resolveGithubUpstreamForTabs(entity, repo, rec);
  const spec = sourceUrl ? parseGitHubRepoSpec(sourceUrl) : null;
  if (!spec) return [];

  const endpoint = `/repos/${spec.owner}/${
    spec.repo
  }/commits/${encodeURIComponent(sha)}`;
  const res = await fetch(
    `/api/github/proxy?endpoint=${encodeURIComponent(endpoint)}`
  );
  if (!res.ok) return [];
  const data = (await res.json()) as {
    files?: Array<{
      filename?: string;
      status?: string;
      additions?: number;
      deletions?: number;
      patch?: string;
    }>;
  };
  return (data.files || [])
    .filter((f) => f.filename)
    .map((f) => ({
      path: f.filename!,
      status: mapGithubFileStatus(f.status),
      additions: f.additions,
      deletions: f.deletions,
      after: f.patch,
    }));
}

export default function CommitDetailPage({
  params,
}: {
  params: Promise<{ entity: string; repo: string; id: string }>;
}) {
  const resolvedParams = use(params);
  const [commit, setCommit] = useState<Commit | null>(null);
  const [loading, setLoading] = useState(true);
  const [fileDiffs, setFileDiffs] = useState<FileDiff[]>([]);
  const [loadingDiffs, setLoadingDiffs] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      try {
        const commitsKey = getRepoStorageKey(
          "gittr_commits",
          resolvedParams.entity,
          resolvedParams.repo
        );
        const commits = JSON.parse(
          localStorage.getItem(commitsKey) || "[]"
        ) as Commit[];
        let commitData =
          commits.find(
            (c) =>
              c.id === resolvedParams.id || c.id.startsWith(resolvedParams.id)
          ) || null;

        if (!commitData) {
          commitData = {
            id: resolvedParams.id,
            message: resolvedParams.id,
            author: "",
            timestamp: 0,
          };
        }

        if (!cancelled) setCommit(commitData);

        let diffs: FileDiff[] = [];

        if (commitData.changedFiles && commitData.changedFiles.length > 0) {
          diffs = commitData.changedFiles.map((file: any) => {
            let before: string | undefined;
            let after: string | undefined;

            if (commitData.prId) {
              try {
                const prsKey = getRepoStorageKey(
                  "gittr_prs",
                  resolvedParams.entity,
                  resolvedParams.repo
                );
                const prs = JSON.parse(localStorage.getItem(prsKey) || "[]");
                const pr = prs.find((p: any) => p.id === commitData.prId);
                if (pr) {
                  if (pr.changedFiles && pr.changedFiles.length > 0) {
                    const fileChange = pr.changedFiles.find(
                      (f: any) => f.path === file.path
                    );
                    if (fileChange) {
                      before = fileChange.before;
                      after = fileChange.after;
                    }
                  } else if (pr.path === file.path) {
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
          try {
            const prsKey = getRepoStorageKey(
              "gittr_prs",
              resolvedParams.entity,
              resolvedParams.repo
            );
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
                diffs = [
                  {
                    path: pr.path,
                    status: "modified" as const,
                    before: pr.before,
                    after: pr.after,
                  },
                ];
              }
            }
          } catch {}
        }

        if (!cancelled) {
          setFileDiffs(diffs);
          setLoading(false);
        }

        // Soft-fetch file list from GitHub when list/cache had no diffs
        if (diffs.length === 0) {
          if (!cancelled) setLoadingDiffs(true);
          try {
            const ghDiffs = await fetchGithubCommitFiles(
              resolvedParams.entity,
              resolvedParams.repo,
              resolvedParams.id
            );
            if (!cancelled && ghDiffs.length > 0) {
              setFileDiffs(ghDiffs);
              setCommit((prev) =>
                prev
                  ? {
                      ...prev,
                      filesChanged: ghDiffs.length,
                      changedFiles: ghDiffs.map((d) => ({
                        path: d.path,
                        status: d.status,
                      })),
                    }
                  : prev
              );
            }
          } catch (e) {
            console.warn("[Commit] GitHub file list fetch failed:", e);
          } finally {
            if (!cancelled) setLoadingDiffs(false);
          }
        }
      } catch (error) {
        console.error("Failed to load commit:", error);
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [resolvedParams.entity, resolvedParams.repo, resolvedParams.id]);

  if (loading) {
    return (
      <div className="container mx-auto max-w-[95%] xl:max-w-[90%] 2xl:max-w-[85%] p-6">
        Loading commit...
      </div>
    );
  }

  if (!commit) {
    return (
      <div className="container mx-auto max-w-[95%] xl:max-w-[90%] 2xl:max-w-[85%] p-6">
        <p className="text-gray-400">Commit not found</p>
        <Link
          href={`/${resolvedParams.entity}/${resolvedParams.repo}/commits`}
          className="text-purple-500 hover:underline"
        >
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
        <Link
          href={`/${resolvedParams.entity}/${resolvedParams.repo}`}
          className="hover:text-purple-400"
        >
          {resolvedParams.entity}/{resolvedParams.repo}
        </Link>
        {" / "}
        <Link
          href={`/${resolvedParams.entity}/${resolvedParams.repo}/commits`}
          className="hover:text-purple-400"
        >
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
              <div className="text-gray-300 whitespace-pre-wrap mb-4">
                {body}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-4 text-sm text-gray-400">
              <div className="flex items-center gap-2">
                <User className="h-4 w-4" />
                <Link
                  href={`/${commit.author}`}
                  className="hover:text-purple-400 flex items-center gap-2"
                >
                  <Avatar className="h-5 w-5 shrink-0 overflow-hidden">
                    {commit.authorPicture &&
                    commit.authorPicture.startsWith("http") ? (
                      <AvatarImage
                        src={commit.authorPicture}
                        className="object-cover max-w-full max-h-full"
                        style={{ maxWidth: "100%", maxHeight: "100%" }}
                      />
                    ) : null}
                    <AvatarFallback className="bg-purple-600 text-white text-[10px]">
                      {commit.authorName?.slice(0, 2).toUpperCase() ||
                        commit.author.slice(0, 2)}
                    </AvatarFallback>
                  </Avatar>
                  <span>
                    {commit.authorName || commit.author.slice(0, 8)}...
                  </span>
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
                  {commit.filesChanged || fileDiffs.length || 0} file
                  {(commit.filesChanged || fileDiffs.length || 0) !== 1
                    ? "s"
                    : ""}{" "}
                  changed
                  {commit.insertions !== undefined && commit.insertions > 0 && (
                    <span className="ml-2 text-green-400">
                      +{commit.insertions}
                    </span>
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
            <code className="px-2 py-1 bg-gray-800 rounded text-purple-400">
              {commit.id}
            </code>
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
            <div key={idx} className="space-y-1">
              {diff.additions !== undefined && diff.deletions !== undefined && (
                <div className="flex justify-end text-sm text-gray-400 px-1">
                  <span className="text-green-400">+{diff.additions}</span>{" "}
                  <span className="text-red-400">-{diff.deletions}</span>
                </div>
              )}
              <FileDiffViewer
                path={diff.path}
                status={diff.status}
                before={diff.before}
                after={diff.after}
              />
            </div>
          ))}
        </div>
      )}
      {fileDiffs.length === 0 && (
        <div className="border border-gray-700 rounded p-8 text-center text-gray-400">
          {loadingDiffs
            ? "Loading file changes from GitHub…"
            : "No file changes available for this commit."}
        </div>
      )}
    </div>
  );
}
