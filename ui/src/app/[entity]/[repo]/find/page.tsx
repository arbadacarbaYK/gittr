"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { normalizeEntityForStorage } from "@/lib/utils/entity-normalizer";
import { findRepoByEntityAndName } from "@/lib/utils/repo-finder";

import { File, Filter, Search } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

interface RepoFileEntry {
  path: string;
  type: string;
  size?: number;
}

interface StoredRepo {
  entity: string;
  repo?: string;
  slug?: string;
  name?: string;
  ownerPubkey?: string;
  files?: RepoFileEntry[];
  sourceUrl?: string;
  defaultBranch?: string;
}

interface SearchResult {
  file: string;
  path: string;
  matches: Array<{
    line: number;
    content: string;
    matchStart: number;
    matchEnd: number;
  }>;
}

export default function FindPage({
  params,
}: {
  params: Promise<{ entity: string; repo: string }>;
}) {
  const resolvedParams = use(params);
  const searchParams = useSearchParams();
  const [query, setQuery] = useState<string>(searchParams?.get("q") || "");
  const [fileType, setFileType] = useState<string>("all");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [repoData, setRepoData] = useState<StoredRepo | null>(null);

  useEffect(() => {
    const loadRepoData = async () => {
      try {
        const repos = JSON.parse(
          localStorage.getItem("gittr_repos") || "[]"
        ) as StoredRepo[];
        let repo = findRepoByEntityAndName(
          repos,
          resolvedParams.entity,
          resolvedParams.repo
        ) as StoredRepo | undefined;

        // If repo found but no files, try to fetch from API
        if (
          repo &&
          (!repo.files || repo.files.length === 0) &&
          repo.sourceUrl
        ) {
          try {
            const response = await fetch("/api/import", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ sourceUrl: repo.sourceUrl }),
            });
            if (response.ok) {
              const data = (await response.json()) as {
                files?: RepoFileEntry[];
              };
              repo = { ...repo, files: data.files || [] };
              // Update localStorage
              const updated = repos.map((r) =>
                r.entity === resolvedParams.entity &&
                (r.repo === resolvedParams.repo ||
                  r.slug === resolvedParams.repo)
                  ? { ...r, files: data.files || [] }
                  : r
              );
              localStorage.setItem("gittr_repos", JSON.stringify(updated));
            }
          } catch (error) {
            console.error("Failed to fetch repo files:", error);
          }
        }

        setRepoData(repo ?? null);
      } catch (error) {
        console.error("Failed to load repo data:", error);
      }
    };

    void loadRepoData();
  }, [resolvedParams.entity, resolvedParams.repo]);

  const fileTypes = useMemo(() => {
    if (!repoData?.files) return [];
    const types = new Set<string>();
    repoData.files.forEach((fileEntry) => {
      if (fileEntry.type === "file") {
        const ext = fileEntry.path.split(".").pop()?.toLowerCase() || "";
        if (ext) types.add(ext);
      }
    });
    return Array.from(types).sort();
  }, [repoData]);

  const isRepoFileEntry = (file: unknown): file is RepoFileEntry =>
    Boolean(
      file &&
        typeof (file as RepoFileEntry).path === "string" &&
        typeof (file as RepoFileEntry).type === "string"
    );

  const performSearch = useCallback(
    async (searchQuery: string) => {
      if (!searchQuery.trim() || !repoData?.files) {
        setResults([]);
        setLoading(false);
        return;
      }

      setLoading(true);
      // Small delay to show loading state even for fast searches
      await new Promise((resolve) => setTimeout(resolve, 100));
      try {
        let searchResults: SearchResult[] = [];
        const normalizedQuery = searchQuery.toLowerCase();
        const sanitizedQuery = searchQuery.replace(
          /[.*+?^${}()|[\]\\]/g,
          "\\$&"
        );
        const regex = new RegExp(sanitizedQuery, "gi");

        // Filter files by type if specified
        let filesToSearch: RepoFileEntry[] = repoData.files
          .filter(isRepoFileEntry)
          .filter((file) => file.type === "file");
        if (fileType !== "all") {
          filesToSearch = filesToSearch.filter((file) =>
            file.path.toLowerCase().endsWith(`.${fileType}`)
          );
        }

        // FIRST: Search file names/paths (fuzzy match)
        const fileNameMatches: SearchResult[] = [];
        for (const file of filesToSearch) {
          if (!file?.path) continue;
          const fileName = file.path.split("/").pop() || file.path;
          const filePath = file.path.toLowerCase();

          // Exact match in filename
          if (
            fileName.toLowerCase() === normalizedQuery ||
            filePath === normalizedQuery
          ) {
            fileNameMatches.push({
              file: fileName,
              path: file.path,
              matches: [
                {
                  line: 1,
                  content: `File: ${file.path}`,
                  matchStart: 0,
                  matchEnd: normalizedQuery.length,
                },
              ],
            });
            continue;
          }

          // Filename contains query
          if (
            fileName.toLowerCase().includes(normalizedQuery) ||
            filePath.includes(normalizedQuery)
          ) {
            const matchIndexInName = fileName
              .toLowerCase()
              .indexOf(normalizedQuery);
            const matchIndexInPath = filePath.indexOf(normalizedQuery);
            const highlightIndex =
              matchIndexInName >= 0 ? matchIndexInName : matchIndexInPath;
            const safeStart = Math.max(highlightIndex, 0);

            fileNameMatches.push({
              file: fileName,
              path: file.path,
              matches: [
                {
                  line: 1,
                  content: `File: ${file.path}`,
                  matchStart: safeStart,
                  matchEnd: safeStart + normalizedQuery.length,
                },
              ],
            });
            continue;
          }

          // Fuzzy match: check if all query chars appear in order in filename
          let pathIndex = 0;
          let allCharsMatch = true;
          for (let i = 0; i < normalizedQuery.length; i++) {
            const char = normalizedQuery[i] || "";
            const foundIndex = filePath.indexOf(char, pathIndex);
            if (foundIndex === -1) {
              allCharsMatch = false;
              break;
            }
            pathIndex = foundIndex + 1;
          }

          if (allCharsMatch) {
            fileNameMatches.push({
              file: fileName,
              path: file.path,
              matches: [
                {
                  line: 1,
                  content: `File: ${file.path}`,
                  matchStart: 0,
                  matchEnd: 1,
                },
              ],
            });
          }
        }

        // SECOND: Search through file content
        for (const file of filesToSearch) {
          // Skip if already matched by filename
          if (fileNameMatches.some((m) => m.path === file.path)) continue;

          try {
            // Get file content
            let content = "";

            // Check overrides first
            const overridesKey = `gittr_overrides__${normalizeEntityForStorage(
              resolvedParams.entity
            )}__${resolvedParams.repo}`;
            const overrides = JSON.parse(
              localStorage.getItem(overridesKey) || "{}"
            ) as Record<string, string>;
            const overrideContent = overrides[file.path];
            if (overrideContent) {
              content = overrideContent;
            } else if (repoData.sourceUrl) {
              // For GitHub imports, fetch from GitHub API
              try {
                const githubMatch = repoData.sourceUrl.match(
                  /github\.com\/([^\/]+)\/([^\/]+)/
                );
                if (githubMatch) {
                  const owner = githubMatch[1];
                  const repoName = githubMatch[2];
                  if (!owner || !repoName) {
                    continue;
                  }
                  const branch = repoData.defaultBranch || "main";
                  const response = await fetch(
                    `https://api.github.com/repos/${owner}/${repoName}/contents/${encodeURIComponent(
                      file.path
                    )}?ref=${branch}`,
                    { headers: { Accept: "application/vnd.github.v3.raw" } }
                  );
                  if (response.ok) {
                    content = await response.text();
                  }
                }
              } catch {}
            }

            // Search in content
            if (content) {
              const lines = content.split("\n");
              const matches: SearchResult["matches"] = [];

              lines.forEach((line: string, index: number) => {
                regex.lastIndex = 0;
                let match: RegExpExecArray | null;
                // Capture every occurrence within the line
                // eslint-disable-next-line no-cond-assign
                while ((match = regex.exec(line)) !== null) {
                  matches.push({
                    line: index + 1,
                    content: line,
                    matchStart: match.index,
                    matchEnd: match.index + match[0].length,
                  });
                }
              });

              if (matches.length > 0) {
                searchResults.push({
                  file: file.path.split("/").pop() || file.path,
                  path: file.path,
                  matches,
                });
              }
            }
          } catch (error) {
            console.error(`Failed to search file ${file.path}:`, error);
          }
        }

        // Combine filename matches (prioritized) with content matches
        const combinedResults = [...fileNameMatches, ...searchResults];

        // Deduplicate by path (keep filename matches over content matches)
        const seenPaths = new Set<string>();
        const deduplicated: SearchResult[] = [];
        for (const result of combinedResults) {
          if (!seenPaths.has(result.path)) {
            seenPaths.add(result.path);
            deduplicated.push(result);
          }
        }

        searchResults = deduplicated;

        setResults(searchResults);
      } catch (error) {
        console.error("Search failed:", error);
      } finally {
        setLoading(false);
      }
    },
    [fileType, resolvedParams.entity, resolvedParams.repo, repoData]
  );

  const handleSearch = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    void performSearch(query);
  };

  useEffect(() => {
    if (query && query.length >= 2) {
      const timeout = setTimeout(() => {
        void performSearch(query);
      }, 500);
      return () => clearTimeout(timeout);
    } else {
      setResults([]);
    }
  }, [performSearch, query]);

  const totalMatches = useMemo(
    () => results.reduce((sum, result) => sum + result.matches.length, 0),
    [results]
  );

  return (
    <div className="container mx-auto max-w-[95%] xl:max-w-[90%] 2xl:max-w-[85%] p-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold mb-4 flex items-center gap-2">
          <Search className="h-6 w-6" />
          Find in repository
        </h1>

        {/* Search Form */}
        <form onSubmit={handleSearch} className="space-y-4">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                type="text"
                placeholder="Search for code, text, or patterns..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-10 bg-gray-800 border-gray-700"
                autoFocus
              />
            </div>
            <Button
              type="submit"
              disabled={loading || !query.trim()}
              className="bg-purple-600 hover:bg-purple-700"
            >
              {loading ? "Searching..." : "Search"}
            </Button>
          </div>

          {/* File Type Filter */}
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-gray-400" />
            <span className="text-sm text-gray-400">File type:</span>
            <select
              value={fileType}
              onChange={(e) => setFileType(e.target.value)}
              className="px-3 py-1 bg-gray-800 border border-gray-700 rounded text-white text-sm"
            >
              <option value="all">All files</option>
              {fileTypes.map((ext) => (
                <option key={ext} value={ext}>
                  .{ext}
                </option>
              ))}
            </select>
          </div>
        </form>

        {/* Results Summary */}
        {results.length > 0 && (
          <div className="mt-4 p-3 bg-gray-800 rounded border border-gray-700">
            <div className="flex items-center gap-4 text-sm">
              <span className="text-gray-400">
                Found {totalMatches} match{totalMatches !== 1 ? "es" : ""} in{" "}
                {results.length} file{results.length !== 1 ? "s" : ""}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Loading indicator */}
      {loading && query && (
        <div className="border border-gray-700 rounded p-8 text-center">
          <div className="flex flex-col items-center gap-4">
            <div className="animate-spin h-8 w-8 border-4 border-purple-500 border-t-transparent rounded-full" />
            <p className="text-gray-400">Searching repository...</p>
            <p className="text-sm text-gray-500">
              This may take a moment for large repositories.
            </p>
          </div>
        </div>
      )}

      {/* Search Results */}
      {query && !loading && results.length === 0 && (
        <div className="border border-gray-700 rounded p-8 text-center text-gray-400">
          <Search className="h-12 w-12 mx-auto mb-4 text-gray-600" />
          <p>No results found for &ldquo;{query}&rdquo;</p>
          <p className="text-sm text-gray-500 mt-2">
            {fileType !== "all"
              ? `Try searching in all files or a different file type.`
              : "Try a different search query or check spelling."}
          </p>
        </div>
      )}

      {!loading && results.length > 0 && (
        <div className="space-y-4">
          {results.map((result, idx) => (
            <div
              key={idx}
              className="border border-gray-700 rounded overflow-hidden"
            >
              <div className="p-3 bg-gray-800 border-b border-gray-700">
                <Link
                  href={`/${resolvedParams.entity}/${
                    resolvedParams.repo
                  }?file=${encodeURIComponent(result.path)}`}
                  className="text-purple-400 hover:text-purple-300 font-mono text-sm flex items-center gap-2"
                >
                  <File className="h-4 w-4" />
                  {result.path}
                </Link>
                <div className="mt-1 text-xs text-gray-400">
                  {result.matches.length} match
                  {result.matches.length !== 1 ? "es" : ""}
                </div>
              </div>

              <div className="max-h-[60vh] overflow-auto">
                <table className="w-full font-mono text-sm">
                  <tbody>
                    {result.matches.map((match, matchIdx) => (
                      <tr
                        key={matchIdx}
                        className="hover:bg-gray-800/50 border-b border-gray-800"
                      >
                        <td className="p-2 text-right text-gray-500 bg-gray-900/30 border-r border-gray-700 select-none min-w-[60px]">
                          {match.line}
                        </td>
                        <td className="p-2 text-gray-300 whitespace-pre">
                          {match.content.slice(0, match.matchStart)}
                          <mark className="bg-yellow-600 text-yellow-100 px-0">
                            {match.content.slice(
                              match.matchStart,
                              match.matchEnd
                            )}
                          </mark>
                          {match.content.slice(match.matchEnd)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
