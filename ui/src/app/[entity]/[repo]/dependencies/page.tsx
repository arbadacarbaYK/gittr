"use client";

import { use, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  type RepoFileEntry,
  type StoredRepo,
  loadRepoFiles,
  loadRepoOverrides,
  loadStoredRepos,
} from "@/lib/repos/storage";
import {
  Dependency,
  parseDependencies,
  resolveImportPath,
} from "@/lib/utils/dependency-parser";
import {
  getRepoOwnerPubkey,
  resolveEntityToPubkey,
} from "@/lib/utils/entity-resolver";
import { findRepoByEntityAndName } from "@/lib/utils/repo-finder";

import {
  AlertCircle,
  GitBranch,
  Loader2,
  Maximize2,
  RefreshCw,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useSearchParams } from "next/navigation";

interface GraphNode {
  data: {
    id: string;
    label: string;
    type: string;
    filePath?: string;
    path?: string;
  };
}

interface GraphEdge {
  data: {
    id: string;
    source: string;
    target: string;
    type: string;
    isExternal?: boolean;
  };
}

interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

interface CytoscapeStylesheet {
  selector: string;
  style: Record<string, string | number>;
}

interface GitHubTreeItem {
  type: "blob" | "tree";
  path: string;
  size?: number;
}

export default function DependenciesPage({
  params,
}: {
  params: Promise<{ entity: string; repo: string }>;
}) {
  const resolvedParams = use(params);
  const searchParams = useSearchParams();
  const branch = searchParams?.get("branch") || "main";

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dependencies, setDependencies] = useState<Dependency[]>([]);
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [status, setStatus] = useState<string>("");
  const [filesFetched, setFilesFetched] = useState(false);
  const fetchedRef = useRef(false);
  const cytoscapeRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cyRef = useRef<any>(null); // Cytoscape instance type is complex, using any for now

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    loadDependencies();
  }, [resolvedParams.entity, resolvedParams.repo, branch]);

  const cytoscapeStylesheet: CytoscapeStylesheet[] = [
    {
      selector: "node[type='file']",
      style: {
        label: "data(label)",
        width: 46,
        height: 46,
        backgroundColor: "#1e293b",
        color: "#e5e7eb",
        textValign: "center",
        textHalign: "center",
        fontSize: 10,
        fontWeight: "600",
        shape: "ellipse",
        borderWidth: 2,
        borderColor: "#475569",
        textWrap: "wrap",
        textMaxWidth: 90,
        textOverflowWrap: "ellipsis",
        textOutlineColor: "#0f172a",
        textOutlineWidth: 2,
        shadowBlur: 8,
        shadowColor: "#1e293b",
        shadowOpacity: 0.2,
        shadowOffsetX: 0,
        shadowOffsetY: 2,
      },
    },
    {
      selector: "node[type='package']",
      style: {
        label: "data(label)",
        width: "label",
        height: "label",
        minWidth: 36,
        minHeight: 22,
        padding: "6px",
        backgroundColor: "#8b5cf6",
        color: "#0f172a",
        textValign: "center",
        textHalign: "center",
        fontSize: 10,
        fontWeight: "700",
        shape: "round-rectangle",
        borderWidth: 2,
        borderColor: "#7c3aed",
        textWrap: "wrap",
        textMaxWidth: 120,
        textOverflowWrap: "ellipsis",
        textOutlineColor: "#ddd6fe",
        textOutlineWidth: 0,
        shadowBlur: 8,
        shadowColor: "#7c3aed",
        shadowOpacity: 0.25,
        shadowOffsetX: 0,
        shadowOffsetY: 2,
      },
    },
    {
      selector: "node[type='root']",
      style: {
        label: "data(label)",
        width: 68,
        height: 68,
        backgroundColor: "#7c3aed",
        color: "#f5f3ff",
        textValign: "center",
        textHalign: "center",
        fontSize: 16,
        fontWeight: "700",
        shape: "ellipse",
        borderWidth: 3,
        borderColor: "#a78bfa",
        textOutlineColor: "#1e1b4b",
        textOutlineWidth: 2,
        shadowBlur: 12,
        shadowColor: "#7c3aed",
        shadowOpacity: 0.3,
        shadowOffsetX: 0,
        shadowOffsetY: 4,
      },
    },
    {
      selector: "node[type='folder']",
      style: {
        label: "data(label)",
        width: 54,
        height: 54,
        backgroundColor: "#0f172a",
        color: "#94a3b8",
        textValign: "center",
        textHalign: "center",
        fontSize: 11,
        fontWeight: "600",
        shape: "ellipse",
        borderWidth: 2,
        borderColor: "#475569",
        textWrap: "wrap",
        textMaxWidth: 110,
        shadowBlur: 6,
        shadowColor: "#0f172a",
        shadowOpacity: 0.25,
        shadowOffsetX: 0,
        shadowOffsetY: 2,
      },
    },
    {
      selector: "edge[isExternal='true']",
      style: {
        width: 2,
        lineColor: "#a78bfa",
        targetArrowColor: "#a78bfa",
        targetArrowShape: "triangle",
        targetArrowSize: 9,
        curveStyle: "bezier",
        lineStyle: "dashed",
        opacity: 0.7,
      },
    },
    {
      selector: "edge[isExternal='false']",
      style: {
        width: 2,
        lineColor: "#64748b",
        targetArrowColor: "#64748b",
        targetArrowShape: "triangle",
        targetArrowSize: 10,
        curveStyle: "bezier",
        opacity: 0.85,
      },
    },
    {
      selector: "edge[type='folder']",
      style: {
        width: 1,
        lineColor: "#475569",
        targetArrowColor: "#475569",
        targetArrowShape: "none",
        curveStyle: "straight",
        opacity: 0.4,
        lineStyle: "dotted",
      },
    },
  ];

  // Render Cytoscape graph when graphData is ready
  useEffect(() => {
    if (!graphData || !cytoscapeRef.current || graphData.nodes.length === 0)
      return;

    // Dynamically import Cytoscape (client-side only)
    import("cytoscape").then((cytoscape) => {
      import("cytoscape-dagre").then((dagre) => {
        import("dagre").then(() => {
          cytoscape.default.use(dagre.default);

          if (cyRef.current) {
            cyRef.current.destroy();
          }

          const cy = cytoscape.default({
            container: cytoscapeRef.current,
            elements: [...graphData.nodes, ...graphData.edges],
            style: cytoscapeStylesheet,
            layout: {
              name: "dagre",
              padding: 40,
              nodeSep: 60,
              rankSep: 100,
              rankDir: "TB", // Top to bottom (hierarchical tree)
              spacingFactor: 1.5,
              edgesep: 20,
            } as any,
            minZoom: 0.1,
            maxZoom: 5,
            wheelSensitivity: 0.5, // Increased from 0.2 for faster zoom
          });

          // Add pan and zoom controls
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          cy.on("tap", "node", (evt: any) => {
            const node = evt.target;
            console.log("Node clicked:", node.data());
          });

          // Highlight dependencies when node is dragged
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          let highlightedEdges: any[] = [];
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          let draggedNode: any = null;

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          cy.on("grab", "node", (evt: any) => {
            const node = evt.target;
            draggedNode = node;

            // Get all edges connected to this node
            const connectedEdges = node.connectedEdges();

            // Store original styles and highlight edges
            highlightedEdges = [];
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            connectedEdges.forEach((edge: any) => {
              highlightedEdges.push({
                edge,
                originalStyle: {
                  width: edge.style("width"),
                  lineColor: edge.style("line-color"),
                  targetArrowColor: edge.style("target-arrow-color"),
                  opacity: edge.style("opacity"),
                },
              });

              // Highlight with theme color (purple)
              edge.style({
                width: 4,
                "line-color": "#8b5cf6",
                "target-arrow-color": "#8b5cf6",
                opacity: 1,
              });
            });

            // Also highlight the node itself
            node.style({
              "border-width": 3,
              "border-color": "#8b5cf6",
              "background-color":
                node.data("type") === "file" ? "#8b5cf6" : "#7c3aed",
            });
          });

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          cy.on("dragfree", "node", (evt: any) => {
            const node = evt.target;

            // Reset all highlighted edges to original styles
            highlightedEdges.forEach(({ edge, originalStyle }) => {
              edge.style({
                width: originalStyle.width,
                "line-color": originalStyle.lineColor,
                "target-arrow-color": originalStyle.targetArrowColor,
                opacity: originalStyle.opacity,
              });
            });
            highlightedEdges = [];

            // Reset node style
            const nodeType = node.data("type");
            if (nodeType === "file") {
              node.style({
                "border-width": 1,
                "border-color": "#94a3b8",
                "background-color": "#64748b",
              });
            } else if (nodeType === "package") {
              node.style({
                "border-width": 1,
                "border-color": "#7c3aed",
                "background-color": "#8b5cf6",
              });
            } else if (nodeType === "root") {
              node.style({
                "border-width": 3,
                "border-color": "#7c3aed",
                "background-color": "#8b5cf6",
              });
            } else {
              node.style({
                "border-width": 2,
                "border-color": "#475569",
                "background-color": "#1e293b",
              });
            }

            draggedNode = null;
          });

          // Also handle drag end (when user releases mouse)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          cy.on("drag", "node", (evt: any) => {
            // Keep highlighting during drag
            // The highlighting is already set in "grab" event
          });

          // Fit the graph nicely
          cy.fit(undefined, 50);

          cyRef.current = cy;
        });
      });
    });

    return () => {
      if (cyRef.current) {
        cyRef.current.destroy();
        cyRef.current = null;
      }
    };
  }, [graphData]);

  async function loadDependencies() {
    setLoading(true);
    setError(null);
    setStatus("Loading repository data...");

    try {
      // Get repos from localStorage
      const repos = loadStoredRepos();

      // Get repo data
      const repo = findRepoByEntityAndName<StoredRepo>(
        repos,
        resolvedParams.entity,
        resolvedParams.repo
      );
      if (!repo) {
        throw new Error("Repository not found");
      }

      setStatus("Resolving repository owner...");
      // getRepoOwnerPubkey expects (repo, entity) not (entity, repoName)
      let ownerPubkey = getRepoOwnerPubkey(repo, resolvedParams.entity);

      // If not found in repo, try to resolve from entity directly
      if (!ownerPubkey) {
        ownerPubkey = resolveEntityToPubkey(resolvedParams.entity, repo);
      }

      if (!ownerPubkey) {
        throw new Error("Could not resolve repository owner");
      }

      // CRITICAL: Use repositoryName from Nostr event (exact name used by git-nostr-bridge)
      // Priority: repositoryName > repo > slug > name > resolvedParams.repo
      const repoDataAny = repo as any; // Type assertion for dynamic fields
      let actualRepoName =
        repoDataAny?.repositoryName ||
        repoDataAny?.repo ||
        repoDataAny?.slug ||
        repoDataAny?.name ||
        resolvedParams.repo;

      // Extract repo name (handle paths like "gitnostr.com/gitworkshop")
      if (actualRepoName.includes("/")) {
        const parts = actualRepoName.split("/");
        actualRepoName = parts[parts.length - 1] || actualRepoName;
      }
      actualRepoName = actualRepoName.replace(/\.git$/, "");

      setStatus("Fetching file list...");
      const files = await fetchFileList(
        ownerPubkey,
        actualRepoName,
        branch,
        repo
      );
      if (!files || files.length === 0) {
        throw new Error(
          "No files found in repository. The repository may be empty or not yet cloned by git-nostr-bridge."
        );
      }

      setStatus(`Analyzing ${files.length} files for dependencies...`);
      const codeFiles = files.filter(
        (f) =>
          f.type === "file" &&
          /\.(js|ts|jsx|tsx|py|go|rs|java|php|rb)$/.test(f.path)
      );

      if (codeFiles.length === 0) {
        setError("No code files found to analyze");
        setLoading(false);
        return;
      }

      setStatus(`Parsing dependencies from ${codeFiles.length} code files...`);
      const allDeps: Dependency[] = [];
      const filePaths = codeFiles.map((f) => f.path);

      // Fetch and parse each code file
      for (let i = 0; i < codeFiles.length; i++) {
        const file = codeFiles[i];
        if (!file) continue;

        setStatus(`Processing ${i + 1}/${codeFiles.length}: ${file.path}`);

        try {
          const content = await fetchFileContent(
            ownerPubkey,
            actualRepoName,
            file.path,
            branch,
            repo.sourceUrl
          );

          if (content) {
            const deps = parseDependencies(file.path, content);
            console.log(
              `📦 [Dependencies] Parsed ${deps.length} dependencies from ${file.path}`,
              deps
            );

            // Resolve import paths
            const resolvedDeps = deps.map((dep) => {
              const resolved = resolveImportPath(dep.to, dep.from, filePaths);
              return {
                ...dep,
                to: resolved || dep.to,
              };
            });

            if (resolvedDeps.length > 0) {
              console.log(
                `✅ [Dependencies] Adding ${resolvedDeps.length} resolved dependencies from ${file.path}`
              );
            }

            allDeps.push(...resolvedDeps);
          } else {
            console.warn(
              `⚠️ [Dependencies] No content fetched for ${file.path}`
            );
          }
        } catch (err) {
          console.warn(`Failed to parse ${file.path}:`, err);
        }
      }

      console.log(
        `✅ [Dependencies] Total dependencies found: ${allDeps.length}`,
        allDeps
      );
      setDependencies(allDeps);
      setStatus("Building dependency graph with folder structure...");

      // Build graph data for Cytoscape (includes folder structure even if no deps)
      const graph = buildGraph(allDeps, filePaths);
      console.log(
        `📊 [Dependencies] Graph built: ${graph.nodes.length} nodes, ${graph.edges.length} edges`
      );
      setGraphData(graph);
      setFilesFetched(true);

      const depEdges = graph.edges.filter(
        (e) => e.data.type !== "folder"
      ).length;
      if (depEdges > 0) {
        setStatus(
          `Found ${allDeps.length} dependencies across ${codeFiles.length} files`
        );
      } else {
        setStatus(
          `Showing folder structure for ${filePaths.length} files (no dependencies found)`
        );
      }
    } catch (err) {
      console.error("Failed to load dependencies:", err);
      setError(
        err instanceof Error ? err.message : "Failed to load dependencies"
      );
    } finally {
      setLoading(false);
    }
  }

  function buildGraph(deps: Dependency[], filePaths: string[]): GraphData {
    const nodes = new Map<string, GraphNode>();
    const edges: GraphEdge[] = [];
    const folders = new Set<string>();

    // Extract folder structure from file paths
    filePaths.forEach((path) => {
      const parts = path.split("/");
      // Add all parent folders
      for (let i = 1; i < parts.length; i++) {
        const folderPath = parts.slice(0, i).join("/");
        folders.add(folderPath);
      }
    });

    // Create root "/" node (like folders2graph)
    const rootId = "root";
    nodes.set("root", {
      data: { id: rootId, label: "/", path: "/", type: "root" },
    });

    // Create folder nodes (like folders2graph) - sorted to ensure parents are created first
    const sortedFolders = Array.from(folders).sort((a, b) => {
      const aDepth = a.split("/").length;
      const bDepth = b.split("/").length;
      return aDepth - bDepth;
    });

    sortedFolders.forEach((folderPath) => {
      const id = `folder_${folderPath.replace(/[^a-zA-Z0-9]/g, "_")}`;
      const label = folderPath.split("/").pop() || folderPath;
      const parentPath = folderPath.split("/").slice(0, -1).join("/");

      nodes.set(`folder:${folderPath}`, {
        data: { id, label, path: folderPath, type: "folder" },
      });

      // Create folder hierarchy edges - connect to parent folder or root
      if (parentPath && folders.has(parentPath)) {
        const parentId = `folder_${parentPath.replace(/[^a-zA-Z0-9]/g, "_")}`;
        edges.push({
          data: {
            id: `${parentId}_${id}`,
            source: parentId,
            target: id,
            type: "folder",
          },
        });
      } else {
        // Connect to root
        edges.push({
          data: {
            id: `${rootId}_${id}`,
            source: rootId,
            target: id,
            type: "folder",
          },
        });
      }
    });

    // Create nodes for all files
    filePaths.forEach((path) => {
      const id = path.replace(/[^a-zA-Z0-9]/g, "_");
      const label = path.split("/").pop() || path;
      const parentPath = path.split("/").slice(0, -1).join("/");

      nodes.set(path, {
        data: { id, label, path, type: "file" },
      });

      // Connect file to its parent folder or root
      if (parentPath && folders.has(parentPath)) {
        const folderId = `folder_${parentPath.replace(/[^a-zA-Z0-9]/g, "_")}`;
        edges.push({
          data: {
            id: `${folderId}_${id}`,
            source: folderId,
            target: id,
            type: "folder",
          },
        });
      } else {
        // File is in root - connect to root node
        edges.push({
          data: {
            id: `${rootId}_${id}`,
            source: rootId,
            target: id,
            type: "folder",
          },
        });
      }
    });

    // Create edges for dependencies (both internal and external)
    deps.forEach((dep) => {
      const fromId = dep.from.replace(/[^a-zA-Z0-9]/g, "_");
      const toId = dep.to.replace(/[^a-zA-Z0-9]/g, "_");

      // Ensure source file node exists
      if (!nodes.has(dep.from)) {
        const label = dep.from.split("/").pop() || dep.from;
        nodes.set(dep.from, {
          data: { id: fromId, label, path: dep.from, type: "file" },
        });
      }

      // Check if target is an internal file or external package
      const isInternal = nodes.has(dep.to);

      if (!isInternal) {
        // External package - create a node for it
        const label = dep.to.split("/").pop()?.split(".")[0] || dep.to;
        nodes.set(dep.to, {
          data: { id: toId, label, path: dep.to, type: "package" },
        });
      }

      // Create edge
      edges.push({
        data: {
          id: `${fromId}_${toId}`,
          source: fromId,
          target: toId,
          type: dep.type,
          isExternal: !isInternal,
        },
      });
    });

    return {
      nodes: Array.from(nodes.values()),
      edges,
    };
  }

  async function fetchFileList(
    ownerPubkey: string,
    repoName: string,
    branch: string,
    repo?: StoredRepo
  ): Promise<Array<{ type: string; path: string }> | null> {
    // Priority 1: Check if repo has files in localStorage (from Nostr events or GitHub import)
    // CRITICAL: Use files immediately if available - don't wait for all relays
    if (repo?.files && Array.isArray(repo.files) && repo.files.length > 0) {
      console.log(
        `✅ [Dependencies] Using ${repo.files.length} files from repo data (immediate)`
      );
      return repo.files;
    }

    // Also check localStorage directly in case repo object is stale
    try {
      const allRepos = loadStoredRepos();
      const matchingRepo = allRepos.find((r) => {
        const repoEntity = r.entity || r.ownerPubkey;
        const normalizedEntity = resolvedParams.entity.startsWith("npub")
          ? resolvedParams.entity
          : repoEntity && /^[0-9a-f]{64}$/i.test(repoEntity)
          ? repoEntity
          : resolvedParams.entity;
        return (
          (normalizedEntity === resolvedParams.entity ||
            repoEntity === resolvedParams.entity) &&
          (r.repo === resolvedParams.repo ||
            r.name === resolvedParams.repo ||
            r.slug === resolvedParams.repo)
        );
      });

      if (
        matchingRepo?.files &&
        Array.isArray(matchingRepo.files) &&
        matchingRepo.files.length > 0
      ) {
        console.log(
          `✅ [Dependencies] Using ${matchingRepo.files.length} files from localStorage (immediate)`
        );
        return matchingRepo.files;
      }

      // CRITICAL: Check separate files storage key (for optimized storage)
      if (matchingRepo) {
        try {
          const storedFiles = loadRepoFiles(
            resolvedParams.entity,
            resolvedParams.repo
          );
          if (storedFiles && storedFiles.length > 0) {
            console.log(
              `✅ [Dependencies] Using ${storedFiles.length} files from separate storage key`
            );
            return storedFiles.map((f: RepoFileEntry) => ({
              type: f.type,
              path: f.path,
            }));
          }
        } catch (e) {
          console.warn("Failed to check separate files storage:", e);
        }
      }
    } catch (e) {
      console.warn("Failed to check localStorage for files:", e);
    }

    // Priority 2: Try GitHub API if sourceUrl is available
    if (repo?.sourceUrl) {
      try {
        const githubMatch = repo.sourceUrl.match(
          /github\.com\/([^\/]+)\/([^\/]+)/
        );
        if (githubMatch) {
          const [, owner, repoName] = githubMatch;
          const response = await fetch(
            `https://api.github.com/repos/${owner}/${repoName}/git/trees/${encodeURIComponent(
              branch
            )}?recursive=1`,
            {
              headers: {
                "User-Agent": "gittr-space",
                Accept: "application/vnd.github.v3+json",
              },
            }
          );
          if (response.ok) {
            const data = (await response.json()) as { tree?: GitHubTreeItem[] };
            if (data.tree && Array.isArray(data.tree)) {
              const files = data.tree
                .filter((n): n is GitHubTreeItem => n.type === "blob")
                .map((n) => ({
                  type: "file" as const,
                  path: n.path,
                  size: n.size,
                }));
              const dirs = data.tree
                .filter((n): n is GitHubTreeItem => n.type === "tree")
                .map((n) => ({ type: "dir" as const, path: n.path }));
              console.log(
                `✅ [Dependencies] Fetched ${files.length} files from GitHub`
              );
              return [...dirs, ...files];
            }
          }
        }
      } catch (err) {
        console.warn("Failed to fetch from GitHub:", err);
      }
    }

    // Priority 3: Try git-nostr-bridge API (for cloned repos)
    try {
      const response = await fetch(
        `/api/nostr/repo/files?ownerPubkey=${encodeURIComponent(
          ownerPubkey
        )}&repo=${encodeURIComponent(repoName)}&branch=${encodeURIComponent(
          branch
        )}`
      );
      if (response.ok) {
        const data = await response.json();
        if (data.files && Array.isArray(data.files) && data.files.length > 0) {
          console.log(
            `✅ [Dependencies] Fetched ${data.files.length} files from git-nostr-bridge`
          );
          return data.files;
        }
      } else {
        const errorData = await response.json().catch(() => ({}));
        console.warn("git-nostr-bridge API error:", errorData);
      }
    } catch (err) {
      console.warn("Failed to fetch from git-nostr-bridge:", err);
    }

    return null;
  }

  async function fetchFileContent(
    ownerPubkey: string,
    repoName: string,
    filePath: string,
    branch: string,
    sourceUrl?: string
  ): Promise<string | null> {
    // Check localStorage overrides first
    const overrides = loadRepoOverrides(
      resolvedParams.entity,
      resolvedParams.repo
    );
    if (overrides[filePath]) {
      return overrides[filePath];
    }

    // Try GitHub API if sourceUrl is available
    if (sourceUrl) {
      try {
        const githubMatch = sourceUrl.match(/github\.com\/([^\/]+)\/([^\/]+)/);
        if (githubMatch) {
          const [, owner, repo] = githubMatch;
          const response = await fetch(
            `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(
              branch
            )}/${filePath}`,
            { headers: { "User-Agent": "gittr-space" } }
          );
          if (response.ok) {
            return await response.text();
          }
        }
      } catch (err) {
        console.warn("Failed to fetch from GitHub:", err);
      }
    }

    // Try git-nostr-bridge API
    try {
      const response = await fetch(
        `/api/nostr/repo/file-content?ownerPubkey=${encodeURIComponent(
          ownerPubkey
        )}&repo=${encodeURIComponent(repoName)}&path=${encodeURIComponent(
          filePath
        )}&branch=${encodeURIComponent(branch)}`
      );
      if (response.ok) {
        const data = await response.json();
        return data.content || null;
      }
    } catch (err) {
      console.warn("Failed to fetch from git-nostr-bridge:", err);
    }

    return null;
  }

  return (
    <div className="mt-4 w-screen max-w-none relative left-1/2 right-1/2 -translate-x-1/2 px-3 sm:px-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <GitBranch className="h-5 w-5 text-purple-500" />
          <h2 className="text-xl font-semibold">Dependency Graph</h2>
        </div>
        <Button
          onClick={loadDependencies}
          disabled={loading}
          variant="outline"
          size="sm"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4 mr-2" />
          )}
          Refresh
        </Button>
      </div>

      {status && (
        <div className="mb-4 p-3 bg-[#22262C] border border-[#383B42] rounded-md text-sm text-gray-400">
          {status}
        </div>
      )}

      {error && (
        <div className="mb-4 p-4 bg-red-900/20 border border-red-500/50 rounded-md flex items-center gap-2 text-red-400">
          <AlertCircle className="h-5 w-5" />
          <span>{error}</span>
        </div>
      )}

      {loading && !graphData && (
        <div className="flex items-center justify-center h-96">
          <Loader2 className="h-8 w-8 animate-spin text-purple-500" />
        </div>
      )}

      {graphData && graphData.nodes.length > 0 && (
        <div
          className="border border-[#383B42] rounded-md overflow-hidden bg-[#0f172a] relative h-[70vh] min-h-[520px] md:h-[700px]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(139,92,246,0.12) 1px, transparent 1px), linear-gradient(90deg, rgba(139,92,246,0.12) 1px, transparent 1px)",
            backgroundSize: "24px 24px",
          }}
        >
          <div
            ref={cytoscapeRef}
            className="w-full h-full cursor-grab active:cursor-grabbing"
          />

          {/* Zoom Controls */}
          <div className="absolute top-4 right-4 flex flex-col gap-2 z-10">
            <Button
              variant="outline"
              size="sm"
              className="bg-[#1e293b] border-[#383B42] hover:bg-[#22262C] hover:border-purple-500/50 h-8 w-8 p-0"
              onClick={() => {
                if (cyRef.current) {
                  cyRef.current.zoom(cyRef.current.zoom() * 1.3);
                }
              }}
              title="Zoom In"
            >
              <ZoomIn className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="bg-[#1e293b] border-[#383B42] hover:bg-[#22262C] hover:border-purple-500/50 h-8 w-8 p-0"
              onClick={() => {
                if (cyRef.current) {
                  cyRef.current.zoom(cyRef.current.zoom() * 0.7);
                }
              }}
              title="Zoom Out"
            >
              <ZoomOut className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="bg-[#1e293b] border-[#383B42] hover:bg-[#22262C] hover:border-purple-500/50 h-8 w-8 p-0"
              onClick={() => {
                if (cyRef.current) {
                  cyRef.current.fit(undefined, 50);
                }
              }}
              title="Fit to View"
            >
              <Maximize2 className="h-4 w-4" />
            </Button>
          </div>

          {graphData.nodes.length > 0 &&
            graphData.edges.filter((e: any) => e.data.type !== "folder")
              .length === 0 && (
              <div className="absolute top-4 left-4 bg-[#1e293b] border border-[#383B42] rounded-md px-3 py-2 text-xs text-gray-400 max-w-xs">
                <p>
                  💡 Showing folder structure. No dependencies found between
                  files.
                </p>
                <p className="mt-1 text-gray-500">
                  Files are connected to their parent folders.
                </p>
              </div>
            )}
        </div>
      )}

      {!loading && !error && filesFetched && dependencies.length === 0 && (
        <div className="text-center py-12 text-gray-400">
          <GitBranch className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p>No dependencies found in this repository</p>
        </div>
      )}

      {dependencies.length > 0 && (
        <div className="mt-4">
          <h3 className="text-sm font-semibold mb-2 text-gray-400">
            Dependency List ({dependencies.length})
          </h3>
          <div className="bg-[#22262C] border border-[#383B42] rounded-md p-4 max-h-64 overflow-y-auto">
            <ul className="space-y-1 text-sm">
              {dependencies.slice(0, 50).map((dep, idx) => (
                <li key={idx} className="text-gray-300">
                  <span className="text-purple-400">{dep.from}</span>
                  {" → "}
                  <span className="text-blue-400">{dep.to}</span>
                  {dep.line && (
                    <span className="text-gray-500 ml-2">
                      (line {dep.line})
                    </span>
                  )}
                </li>
              ))}
              {dependencies.length > 50 && (
                <li className="text-gray-500 italic">
                  ... and {dependencies.length - 50} more
                </li>
              )}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
