"use client";
import { getRepoStorageKey } from "@/lib/utils/entity-normalizer";
import { findRepoByEntityAndName } from "@/lib/utils/repo-finder";
import { loadStoredRepos, type StoredRepo } from "@/lib/repos/storage";

import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { GitBranch, GitCommit, FileDiff, ArrowRight } from "lucide-react";

interface DiffFile {
  path: string;
  status: "added" | "modified" | "deleted";
  additions?: number;
  deletions?: number;
  before?: string;
  after?: string;
}

export default function ComparePage({ params }: { params: { entity: string; repo: string } }) {
  const searchParams = useSearchParams();
  const [baseRef, setBaseRef] = useState<string>(searchParams?.get("base") || "main");
  const [compareRef, setCompareRef] = useState<string>(searchParams?.get("compare") || "");
  const [diffFiles, setDiffFiles] = useState<DiffFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [branches, setBranches] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>([]);

  useEffect(() => {
    try {
      const repos = loadStoredRepos();
      const repo = findRepoByEntityAndName<StoredRepo>(repos, params.entity, params.repo);
      setBranches((repo?.branches as string[] | undefined) || ["main"]);
      setTags((repo?.tags as string[] | undefined)?.map((t: string | { name: string }) => typeof t === "string" ? t : t.name) || []);
    } catch {}
  }, [params]);

  const handleCompare = async () => {
    if (!baseRef || !compareRef) {
      alert("Please select both base and compare references");
      return;
    }

    setLoading(true);
    try {
      // Load commits for both refs
      const commitsKey = getRepoStorageKey("gittr_commits", params.entity, params.repo);
      const allCommits = JSON.parse(localStorage.getItem(commitsKey) || "[]");
      
      // Find commits in base branch/tag
      const baseCommits = allCommits.filter((c: any) => 
        !baseRef.includes("commit-") ? c.branch === baseRef : c.id === baseRef
      );
      
      // Find commits in compare branch/tag
      const compareCommits = allCommits.filter((c: any) => 
        !compareRef.includes("commit-") ? c.branch === compareRef : c.id === compareRef
      );
      
      // Get unique files changed in compare but not in base (simplified diff)
      const baseFiles = new Set<string>();
      baseCommits.forEach((c: any) => {
        c.changedFiles?.forEach((f: any) => baseFiles.add(f.path));
      });
      
      const compareFiles = new Map<string, DiffFile>();
      compareCommits.forEach((c: any) => {
        c.changedFiles?.forEach((f: any) => {
          if (!baseFiles.has(f.path)) {
            // File exists in compare but not in base (added or modified in compare)
            compareFiles.set(f.path, {
              path: f.path,
              status: f.status || "modified",
            });
            
            // Try to get file content from PR
            if (c.prId) {
              try {
                const prsKey = getRepoStorageKey("gittr_prs", params.entity, params.repo);
                const prs = JSON.parse(localStorage.getItem(prsKey) || "[]");
                const pr = prs.find((p: any) => p.id === c.prId);
                if (pr && pr.path === f.path) {
                  compareFiles.set(f.path, {
                    ...compareFiles.get(f.path)!,
                    before: pr.before,
                    after: pr.after,
                  });
                }
              } catch {}
            }
          }
        });
      });
      
      // Files in base but not in compare (deleted)
      baseFiles.forEach((path) => {
        if (!compareFiles.has(path)) {
          const inCompare = compareCommits.some((c: any) =>
            c.changedFiles?.some((f: any) => f.path === path && f.status === "deleted")
          );
          if (inCompare) {
            compareFiles.set(path, {
              path,
              status: "deleted",
            });
          }
        }
      });
      
      setDiffFiles(Array.from(compareFiles.values()));
    } catch (error) {
      console.error("Failed to compare:", error);
    } finally {
      setLoading(false);
    }
  };

  const totalAdditions = diffFiles.reduce((sum, f) => sum + (f.additions || 0), 0);
  const totalDeletions = diffFiles.reduce((sum, f) => sum + (f.deletions || 0), 0);

  return (
    <div className="container mx-auto max-w-[95%] xl:max-w-[90%] 2xl:max-w-[85%] p-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold mb-4 flex items-center gap-2">
          <FileDiff className="h-6 w-6" />
          Compare changes
        </h1>

        {/* Compare Controls */}
        <div className="flex items-center gap-4 mb-6">
          <div className="flex-1">
            <label className="block text-sm font-medium mb-2">Base</label>
            <div className="flex gap-2">
              <select
                value={baseRef}
                onChange={(e) => setBaseRef(e.target.value)}
                className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white"
              >
                <optgroup label="Branches">
                  {branches.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </optgroup>
                {tags.length > 0 && (
                  <optgroup label="Tags">
                    {tags.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </div>
          </div>

          <ArrowRight className="h-6 w-6 text-gray-400 mt-6" />

          <div className="flex-1">
            <label className="block text-sm font-medium mb-2">Compare</label>
            <div className="flex gap-2">
              <select
                value={compareRef}
                onChange={(e) => setCompareRef(e.target.value)}
                className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white"
              >
                <option value="">Select...</option>
                <optgroup label="Branches">
                  {branches.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </optgroup>
                {tags.length > 0 && (
                  <optgroup label="Tags">
                    {tags.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </div>
          </div>

          <div className="flex gap-2">
            <Button
              onClick={handleCompare}
              disabled={loading || !baseRef || !compareRef}
              variant="default"
            >
              {loading ? "Comparing..." : "Compare"}
            </Button>
            {diffFiles.length > 0 && (
              <Button
                onClick={() => {
                  window.location.href = `/${params.entity}/${params.repo}/pulls/new?base=${encodeURIComponent(baseRef)}&compare=${encodeURIComponent(compareRef)}`;
                }}
                variant="default"
                className="bg-green-600 hover:bg-green-700"
              >
                Create pull request
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Diff Results */}
      {diffFiles.length > 0 && (
        <div className="mb-4 p-4 bg-gray-800 rounded border border-gray-700">
          <div className="flex items-center gap-4 text-sm">
            <span className="text-gray-400">
              {diffFiles.length} file{diffFiles.length !== 1 ? "s" : ""} changed
            </span>
            {totalAdditions > 0 && (
              <span className="text-green-400">+{totalAdditions}</span>
            )}
            {totalDeletions > 0 && (
              <span className="text-red-400">-{totalDeletions}</span>
            )}
          </div>
        </div>
      )}

      {/* File Diffs */}
      {diffFiles.length > 0 ? (
        <div className="space-y-4">
          {diffFiles.map((file, idx) => (
            <div key={idx} className="border border-gray-700 rounded">
              <div className="p-4 bg-gray-800 border-b border-gray-700">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Badge
                      className={
                        file.status === "added"
                          ? "bg-green-600"
                          : file.status === "deleted"
                          ? "bg-red-600"
                          : "bg-yellow-600"
                      }
                    >
                      {file.status}
                    </Badge>
                    <Link
                      href={`/${params.entity}/${params.repo}?file=${encodeURIComponent(file.path)}`}
                      className="text-purple-400 hover:text-purple-300 font-mono text-sm"
                    >
                      {file.path}
                    </Link>
                  </div>
                  {file.additions !== undefined && file.deletions !== undefined && (
                    <div className="text-sm text-gray-400">
                      <span className="text-green-400">+{file.additions}</span>
                      {" "}
                      <span className="text-red-400">-{file.deletions}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Diff Content */}
              {(file.before || file.after) && (
                <div className="grid grid-cols-2 gap-0">
                  {file.before && (
                    <div>
                      <div className="p-2 bg-[#0E1116] border-r border-gray-700 text-xs text-gray-400 font-semibold">
                        {baseRef}
                      </div>
                      <pre className="bg-[#0E1116] p-4 overflow-auto text-sm font-mono whitespace-pre-wrap text-gray-300 border-r border-gray-700 max-h-[40vh]">
                        {file.before}
                      </pre>
                    </div>
                  )}
                  {file.after && (
                    <div>
                      <div className="p-2 bg-[#0E1116] text-xs text-gray-400 font-semibold">
                        {compareRef}
                      </div>
                      <pre className="bg-[#0E1116] p-4 overflow-auto text-sm font-mono whitespace-pre-wrap text-gray-100 max-h-[40vh]">
                        {file.after}
                      </pre>
                    </div>
                  )}
                </div>
              )}

              {file.status === "deleted" && !file.before && (
                <div className="p-4 text-gray-400 text-center">
                  File was deleted in {compareRef}
                </div>
              )}

              {file.status === "added" && !file.after && (
                <div className="p-4 text-gray-400 text-center">
                  File was added in {compareRef}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        !loading && (
          <div className="border border-gray-700 rounded p-8 text-center text-gray-400">
            <FileDiff className="h-12 w-12 mx-auto mb-4 text-gray-600" />
            <p>No differences found</p>
            <p className="text-sm text-gray-500 mt-2">
              {baseRef && compareRef
                ? "The selected branches/tags are identical."
                : "Select base and compare references to see differences."}
            </p>
          </div>
        )
      )}
    </div>
  );
}

