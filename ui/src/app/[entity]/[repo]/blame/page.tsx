"use client";

import { getRepoStorageKey, normalizeEntityForStorage } from "@/lib/utils/entity-normalizer";
import { findRepoByEntityAndName } from "@/lib/utils/repo-finder";

import React from "react";
import { useEffect, useState, use } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { GitCommit, File as FileIcon } from "lucide-react";
import { formatDate24h } from "@/lib/utils/date-format";

interface BlameLine {
  lineNumber: number;
  content: string;
  commitId: string;
  commitMessage: string;
  author: string;
  authorName?: string;
  authorPicture?: string;
  timestamp: number;
}

export default function BlamePage({ params }: { params: Promise<{ entity: string; repo: string }> }) {
  const resolvedParams = use(params);
  const searchParams = useSearchParams();
  const filePath = searchParams?.get("file") || null;
  const [blameLines, setBlameLines] = useState<BlameLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [fileContent, setFileContent] = useState<string>("");

  useEffect(() => {
    if (!filePath) {
      setLoading(false);
      return;
    }

    const loadFileContent = async () => {
      try {
        // Load file content - same logic as main page
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const overrides: Record<string, string> = JSON.parse(localStorage.getItem(`gittr_overrides__${normalizeEntityForStorage(resolvedParams.entity)}__${resolvedParams.repo}`) || "{}");
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any
        const repos: any[] = JSON.parse(localStorage.getItem("gittr_repos") || "[]");
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const repo = findRepoByEntityAndName(repos, resolvedParams.entity, resolvedParams.repo);
        
        let content: string = overrides[filePath] || "";
        
        // If not in overrides, try to fetch from GitHub API
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        if (!content && repo?.sourceUrl && repo?.files) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any
          const file = repo.files.find((f: any) => f.path === filePath);
          if (file) {
            try {
              // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
              const githubMatch = repo.sourceUrl.match(/github\.com\/([^\/]+)\/([^\/]+)/);
              if (githubMatch) {
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                const [, owner, repoName] = githubMatch;
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
                const branch = repo.defaultBranch || "main";
                // eslint-disable-next-line @typescript-eslint/restrict-template-expressions, @typescript-eslint/no-unsafe-assignment
                const response = await fetch(
                  `https://api.github.com/repos/${String(owner)}/${String(repoName)}/contents/${encodeURIComponent(filePath)}?ref=${String(branch)}`,
                  { 
                    headers: { 
                      Accept: "application/vnd.github.v3.raw",
                    } 
                  }
                );
                if (response.ok) {
                  content = await response.text();
                } else {
                  content = "(Unable to load file content)";
                }
              }
            } catch (error) {
              console.error("Failed to fetch file from GitHub:", error);
              content = "(Error loading file content)";
            }
          }
        }
        
        // If still no content, check if file exists in repo files list
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        if (!content && repo?.files) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any
          const file = repo.files.find((f: any) => f.path === filePath);
          if (!file) {
            content = "(File not found)";
          } else {
            content = "(File content not available)";
          }
        }
        
        setFileContent(content || "");

      // Load commits that touched this file
      const commitsKey = getRepoStorageKey("gittr_commits", resolvedParams.entity, resolvedParams.repo);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const allCommits = JSON.parse(localStorage.getItem(commitsKey) || "[]");
      
      // Find commits that modified this file
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any
      const fileCommits = allCommits.filter((c: any) => 
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return
        c.changedFiles?.some((f: any) => f.path === filePath) ||
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        (c.prId && (() => {
          try {
            const prsKey = getRepoStorageKey("gittr_prs", resolvedParams.entity, resolvedParams.repo);
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            const prs = JSON.parse(localStorage.getItem(prsKey) || "[]");
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any
            const pr = prs.find((p: any) => p.id === c.prId);
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return
            return pr?.path === filePath;
          } catch { return false; }
        })())
      );
      
      // Sort by timestamp (newest first)
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any
      fileCommits.sort((a: any, b: any) => b.timestamp - a.timestamp);
      
      // For now, assign the most recent commit to all lines
      // In a real implementation, you'd track line-by-line attribution
      const fileLines = content && content !== "(File content loading...)" && content !== "(Unable to load file content)" && content !== "(Error loading file content)" && content !== "(File content not available)" && content !== "(File not found)"
        ? content.split("\n")
        : [];
      const lines = fileLines.map((line: string, idx: number) => {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
        const mostRecentCommit = fileCommits[0];
        return {
          lineNumber: idx + 1,
          content: line,
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
          commitId: mostRecentCommit?.id || "unknown",
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
          commitMessage: mostRecentCommit?.message?.split("\n")[0] || "Unknown",
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
          author: mostRecentCommit?.author || "unknown",
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
          authorName: mostRecentCommit?.authorName,
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
          authorPicture: mostRecentCommit?.authorPicture,
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
          timestamp: mostRecentCommit?.timestamp || 0,
        };
      });
        
        setBlameLines(lines);
      } catch (error) {
        console.error("Failed to load blame:", error);
        setFileContent("(Error loading file)");
      } finally {
        setLoading(false);
      }
    };

    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    void loadFileContent();
  }, [filePath, params]);

  if (loading) {
    return <div className="container mx-auto max-w-[95%] xl:max-w-[90%] 2xl:max-w-[85%] p-6">Loading blame...</div>;
  }

  if (!filePath) {
    return (
      <div className="container mx-auto max-w-[95%] xl:max-w-[90%] 2xl:max-w-[85%] p-6">
        <p className="text-gray-400">No file specified</p>
        <Link href={`/${resolvedParams.entity}/${resolvedParams.repo}`} className="text-purple-500 hover:underline">
          Back to repository
        </Link>
      </div>
    );
  }

  // Group lines by commit for better visualization
  const groupedLines: Array<{ commit: BlameLine; lines: BlameLine[] }> = [];
  let currentGroup: BlameLine[] = [];
  let currentCommit = "";

  blameLines.forEach((line, idx) => {
    if (line.commitId !== currentCommit) {
      if (currentGroup.length > 0 && currentCommit) {
        const commitLine = blameLines[idx - currentGroup.length];
        if (commitLine) {
          groupedLines.push({ commit: commitLine, lines: [...currentGroup] });
        }
      }
      currentGroup = [line];
      currentCommit = line.commitId;
    } else {
      currentGroup.push(line);
    }
  });
  if (currentGroup.length > 0 && currentCommit) {
    const lastCommitLine = blameLines[blameLines.length - currentGroup.length];
    if (lastCommitLine) {
      groupedLines.push({ commit: lastCommitLine, lines: [...currentGroup] });
    }
  }

  return (
    <div className="container mx-auto max-w-[95%] xl:max-w-[90%] 2xl:max-w-[85%] p-6">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-2">
          <FileIcon className="h-5 w-5 text-gray-400" />
          <h1 className="text-2xl font-bold">
            Blame for <code className="px-2 py-1 bg-gray-800 rounded text-sm font-normal">{filePath}</code>
          </h1>
        </div>
        <p className="text-sm text-gray-400 mb-4">
          <strong className="text-gray-300">What is &quot;Blame&quot;?</strong> This view shows who last modified each line of code and when. 
          The left column displays the commit author, commit message, and date for each line. 
          Click on a commit ID to view that commit&apos;s details.
        </p>
        <Link
          href={`/${resolvedParams.entity}/${resolvedParams.repo}?file=${encodeURIComponent(filePath)}`}
          className="text-purple-400 hover:text-purple-300 hover:underline text-sm"
        >
          ← Back to file view
        </Link>
      </div>

      {/* Blame View */}
      <div className="border border-gray-700 rounded overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full font-mono text-sm">
            <tbody>
              {groupedLines.map((group, groupIdx) => (
                <React.Fragment key={groupIdx}>
                  {group.lines.map((line, lineIdx) => (
                    <tr
                      key={line.lineNumber}
                      className={`hover:bg-gray-800/50 ${
                        groupIdx % 2 === 0 ? "bg-gray-900/30" : ""
                      }`}
                    >
                      {/* Commit info column */}
                      <td className="p-2 border-r border-gray-700 bg-gray-800/50 min-w-[300px] sticky left-0">
                        <div className="flex items-center gap-2">
                          <Avatar className="h-5 w-5 flex-shrink-0">
                            {line.authorPicture && line.authorPicture.startsWith("http") ? (
                              <AvatarImage 
                                src={line.authorPicture} 
                                className="object-cover max-w-full max-h-full"
                                style={{ maxWidth: '100%', maxHeight: '100%' }}
                              />
                            ) : null}
                            <AvatarFallback className="bg-purple-600 text-white text-[10px]">
                              {line.authorName?.slice(0, 2).toUpperCase() || line.author.slice(0, 2)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="flex-1 min-w-0">
                            {line.commitId !== "unknown" ? (
                              <>
                                <Link
                                  href={`/${resolvedParams.entity}/${resolvedParams.repo}/commits/${line.commitId}`}
                                  className="text-purple-400 hover:text-purple-300 hover:underline truncate block text-xs"
                                  title={line.commitMessage}
                                >
                                  {line.commitMessage.length > 50 ? line.commitMessage.slice(0, 50) + "..." : line.commitMessage}
                                </Link>
                                <div className="text-xs text-gray-500 flex items-center gap-2 mt-1">
                                  <span className="font-mono">{line.commitId.slice(0, 7)}</span>
                                  <span>•</span>
                                  <span>{line.timestamp > 0 ? formatDate24h(line.timestamp) : "Unknown date"}</span>
                                </div>
                              </>
                            ) : (
                              <div className="text-xs text-gray-500">
                                <div className="text-gray-400">No commit history</div>
                                <div className="text-gray-600">Original file content</div>
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      {/* Line number */}
                      <td className="p-2 text-right text-gray-500 border-r border-gray-700 bg-gray-900/30 select-none">
                        {line.lineNumber}
                      </td>
                      {/* Line content */}
                      <td className="p-2 text-gray-300 whitespace-pre font-mono text-sm">
                        {line.content || " "}
                      </td>
                    </tr>
                  ))}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {blameLines.length === 0 && (
        <div className="border border-gray-700 rounded p-8 text-center text-gray-400">
          <GitCommit className="h-12 w-12 mx-auto mb-4 text-gray-600" />
          <p className="text-lg mb-2">No commit history found for this file.</p>
          <p className="text-sm text-gray-500">
            This file hasn&apos;t been modified through any pull requests yet. 
            Once you merge a PR that changes this file, the blame view will show commit information for each line.
          </p>
          {fileContent && fileContent !== "(File content not available)" && fileContent !== "(File not found)" && (
            <div className="mt-6 p-4 bg-gray-800 rounded border border-gray-700 text-left">
              <p className="text-sm text-gray-400 mb-2">File content:</p>
              <pre className="text-xs text-gray-300 whitespace-pre-wrap font-mono overflow-auto max-h-[40vh]">
                {fileContent}
              </pre>
            </div>
          )}
        </div>
      )}

      {fileContent && (fileContent === "(File content not available)" || fileContent === "(File not found)" || fileContent === "(Error loading file)") && (
        <div className="border border-gray-700 rounded p-4 text-center text-yellow-400 text-sm">
          {fileContent}
        </div>
      )}
    </div>
  );
}

