"use client";

import { use, useEffect, useMemo, useRef, useState } from "react";

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
  Search,
  X,
  Settings,
  Folder,
  File,
  ChevronRight,
  ChevronDown,
} from "lucide-react";
import { useSearchParams } from "next/navigation";

// CodeFlow-style dependency visualization

interface GraphNode {
  data: {
    id: string;
    label: string;
    displayLabel?: string;
    type: string;
    filePath?: string;
    path?: string;
    size?: number;
    depth?: number;
    color?: string;
    borderColor?: string;
  };
}

interface GraphEdge {
  data: {
    id: string;
    source: string;
    target: string;
    type: string;
    isExternal?: boolean;
    weight?: number;
    hidden?: boolean;
  };
}

interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

interface GitHubTreeItem {
  type: "blob" | "tree";
  path: string;
  size?: number;
}

// CodeFlow-style File Tree Component
function FileTree({
  nodes,
  onSelectFile,
  selectedId,
}: {
  nodes: GraphNode[];
  onSelectFile: (id: string) => void;
  selectedId: string | null;
}) {
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  
  // Build folder tree structure
  const tree = useMemo(() => {
    const folderMap = new Map<string, { files: GraphNode[]; subfolders: Set<string> }>();
    
    nodes.forEach((node) => {
      const path = node.data.path || node.data.filePath || "";
      const parts = path.split("/");
      const fileName = parts[parts.length - 1];
      const folderPath = parts.slice(0, -1).join("/") || "root";
      
      if (!folderMap.has(folderPath)) {
        folderMap.set(folderPath, { files: [], subfolders: new Set() });
      }
      
      folderMap.get(folderPath)!.files.push(node);
      
      // Track parent folders
      if (folderPath !== "root") {
        const parentParts = folderPath.split("/");
        for (let i = 1; i < parentParts.length; i++) {
          const parentPath = parentParts.slice(0, i).join("/");
          if (parentPath && folderMap.has(parentPath)) {
            folderMap.get(parentPath)!.subfolders.add(folderPath);
          }
        }
      }
    });
    
    return folderMap;
  }, [nodes]);
  
  const toggleFolder = (folderPath: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderPath)) {
        next.delete(folderPath);
      } else {
        next.add(folderPath);
      }
      return next;
    });
  };
  
  const renderFolder = (folderPath: string, depth: number = 0): JSX.Element | null => {
    const folder = tree.get(folderPath);
    if (!folder) return null;
    
    const isExpanded = expandedFolders.has(folderPath);
    const folderName = folderPath === "root" ? "root" : folderPath.split("/").pop() || folderPath;
    const hasChildren = folder.files.length > 0 || folder.subfolders.size > 0;
    
    return (
      <div key={folderPath}>
        {folderPath !== "root" && (
          <div
            className={`flex items-center gap-1 px-2 py-1 text-xs cursor-pointer hover:bg-[#0f172a] rounded ${
              depth > 0 ? `ml-${depth * 4}` : ""
            }`}
            style={{ paddingLeft: `${depth * 12 + 8}px` }}
            onClick={() => hasChildren && toggleFolder(folderPath)}
          >
            {hasChildren ? (
              isExpanded ? (
                <ChevronDown className="h-3 w-3 text-gray-500" />
              ) : (
                <ChevronRight className="h-3 w-3 text-gray-500" />
              )
            ) : (
              <div className="w-3" />
            )}
            <Folder className="h-3 w-3 text-orange-500" />
            <span className="text-gray-400 truncate">{folderName}</span>
          </div>
        )}
        
        {isExpanded && (
          <>
            {/* Render subfolders */}
            {Array.from(folder.subfolders)
              .sort()
              .map((subfolder) => renderFolder(subfolder, depth + 1))}
            
            {/* Render files */}
            {folder.files
              .sort((a, b) => {
                const aName = (a.data.path || a.data.filePath || "").split("/").pop() || "";
                const bName = (b.data.path || b.data.filePath || "").split("/").pop() || "";
                return aName.localeCompare(bName);
              })
              .map((file) => {
                const filePath = file.data.path || file.data.filePath || "";
                const fileName = filePath.split("/").pop() || file.data.id;
                const isSelected = selectedId === file.data.id;
                
                return (
                  <div
                    key={file.data.id}
                    className={`flex items-center gap-1 px-2 py-1 text-xs cursor-pointer rounded ${
                      isSelected
                        ? "bg-orange-500/20 text-orange-400"
                        : "hover:bg-[#0f172a] text-gray-400"
                    }`}
                    style={{ paddingLeft: `${(depth + 1) * 12 + 8}px` }}
                    onClick={() => onSelectFile(file.data.id)}
                  >
                    <File className="h-3 w-3 text-gray-500" />
                    <span className="truncate">{fileName}</span>
                  </div>
                );
              })}
          </>
        )}
      </div>
    );
  };
  
  // Auto-expand root
  useEffect(() => {
    if (tree.has("root") && !expandedFolders.has("root")) {
      setExpandedFolders((prev) => new Set([...prev, "root"]));
    }
  }, [tree]);
  
  return (
    <div className="space-y-0">
      {tree.has("root") && renderFolder("root")}
      {Array.from(tree.keys())
        .filter((path) => path !== "root")
        .sort()
        .map((path) => {
          // Only render top-level folders (no parent in tree)
          const parts = path.split("/");
          if (parts.length === 1) {
            return renderFolder(path);
          }
          return null;
        })}
    </div>
  );
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
  const layoutInitRef = useRef(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const zoomRef = useRef<any>(null);
  const [showFolders, setShowFolders] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"file" | "folder">("file");
  const [showExternal, setShowExternal] = useState(true);
  const [colorMode, setColorMode] = useState<"folder" | "layer" | "churn">("folder");
  const [sidebarWidth, setSidebarWidth] = useState(260);
  const [rightPanelWidth, setRightPanelWidth] = useState(360);
  const [rightTab, setRightTab] = useState<"details" | "functions" | "connections">("details");
  const [folderGraphData, setFolderGraphData] = useState<GraphData | null>(
    null
  );
  const [edgeWeightThreshold, setEdgeWeightThreshold] = useState(1);
  const [minFolderSize, setMinFolderSize] = useState(1);
  const selectFileRef = useRef<((id: string) => void) | null>(null);
  const [blastRadius, setBlastRadius] = useState<{ affected: string[] } | null>(
    null
  );
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [highlightedNodeId, setHighlightedNodeId] = useState<string | null>(null);
  const searchQueryRef = useRef<string>("");
  const highlightedNodeIdRef = useRef<string | null>(null);
  const matchingNodesRef = useRef<Set<string>>(new Set());
  const dragStateRef = useRef<{
    draggedNodeId: string | null;
    initialX: number;
    initialY: number;
    dependents: Set<string>;
    dependencies: Set<string>;
  }>({
    draggedNodeId: null,
    initialX: 0,
    initialY: 0,
    dependents: new Set(),
    dependencies: new Set(),
  });
  
  // CodeFlow-style graph configuration - defaults match user's preferred settings
  const [graphConfig, setGraphConfig] = useState({
    viewMode: "metro" as "force" | "radial" | "hierarchical" | "grid" | "metro",
    spacing: 750, // Default spread - can go up to 1000 for very dense graphs
    linkDist: 195, // High link distance for better spread
    showLabels: true,
    curvedLinks: true, // Curved links enabled by default
  });
  const graphConfigRef = useRef(graphConfig);
  graphConfigRef.current = graphConfig; // Keep ref in sync
  const [showGraphConfig, setShowGraphConfig] = useState(true); // Default: config panel open

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    loadDependencies();
  }, [resolvedParams.entity, resolvedParams.repo, branch]);

  useEffect(() => {
    setFocusedNodeId(null);
  }, [viewMode]);

  const graphPalette = useMemo(
    () => ({
      background: "#0b0f1a",
      text: "#f8fafc",
      dim: "rgba(248,250,252,0.15)",
      edge: "#d1d5db",
      edgeExternal: "#f59e0b",
    }),
    []
  );

  // CodeFlow: Always use graphData (file nodes) for rendering
  // Folder view just shows/hides hulls, doesn't change the nodes
  const activeGraphData = graphData;
  const hasFolderDependencyEdges =
    activeGraphData?.edges.some((edge) => edge.data.type !== "folder") ?? false;

  const buildElements = (options?: {
    minSize?: number;
    minWeight?: number;
    includeExternal?: boolean;
  }) => {
    if (!activeGraphData) return { nodes: [], edges: [] };
    const {
      minSize = minFolderSize,
      minWeight = edgeWeightThreshold,
      includeExternal = showExternal,
    } = options || {};
    const allowedNodeIds = new Set<string>();

    // CodeFlow-style: Only show files and packages as nodes (not folders)
    // Folders are only used for positioning/coloring, not as graph nodes
    const nodes = activeGraphData.nodes.filter((node) => {
      // Always exclude folder and root nodes - they're not part of dependency graph
      if (node.data.type === "folder" || node.data.type === "root") {
        return false;
      }
      // Only include files and packages
      if (node.data.type === "file" || node.data.type === "package") {
        allowedNodeIds.add(node.data.id);
        return true;
      }
      return false;
    });

    const hasDependencyEdges = activeGraphData.edges.some(
      (edge) => edge.data.type !== "folder"
    );

    // CodeFlow-style: Only show dependency edges (actual file-to-file dependencies)
    // Folder edges are never shown in the dependency graph
    const edges = activeGraphData.edges.filter((edge) => {
      // Always exclude folder hierarchy edges
      if (edge.data.type === "folder") {
        return false;
      }
      // Filter by external/internal based on config
      if (!includeExternal && edge.data.isExternal) return false;
      // Filter by weight threshold
      if ((edge.data.weight || 1) < minWeight) return false;
      // Ensure both source and target nodes are in the allowed set
      if (
        allowedNodeIds.size > 0 &&
        (!allowedNodeIds.has(edge.data.source) ||
          !allowedNodeIds.has(edge.data.target))
      ) {
        return false;
      }
      return true;
    });

    return { nodes, edges };
  };

  const primaryElements = buildElements();
  const visibleDependencyEdges = primaryElements.edges.filter(
    (edge) => edge.data.type !== "folder"
  ).length;
  const fallbackElements =
    viewMode === "folder" && !showExternal && visibleDependencyEdges === 0
      ? buildElements({ minSize: 1, minWeight: 1, includeExternal: true })
      : primaryElements;

  const elementsToRender = activeGraphData
    ? fallbackElements.nodes.length === 0
      ? [...activeGraphData.nodes, ...activeGraphData.edges]
      : [...fallbackElements.nodes, ...fallbackElements.edges]
    : [];

  // Render CodeFlow-style dependency graph
  const simRef = useRef<any>(null);
  const nodesRef = useRef<any>(null);
  const linksRef = useRef<any>(null);
  const lastNodeCountRef = useRef<number>(0);
  const isInitialRenderRef = useRef<boolean>(true);
  const handleKeyDownRef = useRef<((e: KeyboardEvent) => void) | null>(null);
  
  useEffect(() => {
    if (!activeGraphData || !svgRef.current || elementsToRender.length === 0) {
      return;
    }

    let cleanup: (() => void) | null = null;
    import("d3").then((d3) => {
      const svg = d3.select(svgRef.current);
      const currentNodeCount = elementsToRender.filter(e => (e as GraphNode).data?.id).length;
      
      // Only recreate SVG structure on first render
      const shouldRecreate = !simRef.current || isInitialRenderRef.current;
      
      if (shouldRecreate) {
        svg.selectAll("*").remove();
        isInitialRenderRef.current = false;
      }
      
      // Always update - we'll update the existing simulation

      const width = svgRef.current?.clientWidth || 800;
      const height = svgRef.current?.clientHeight || 600;

      const nodeEntries = elementsToRender.filter(
        (entry) => (entry as GraphNode).data?.id
      ) as GraphNode[];
      const edgeEntries = elementsToRender.filter(
        (entry) => (entry as GraphEdge).data?.source
      ) as GraphEdge[];
      
      // CodeFlow-style: Only show files and packages as nodes (not folders)
      // Folders are only used for positioning and coloring
      const nodeEntriesForLayout = nodeEntries.filter(
        (node) => node.data.type === "file" || node.data.type === "package"
      );
      const nodeIdSet = new Set(
        nodeEntriesForLayout.map((node) => node.data.id)
      );
      
      // CodeFlow-style: Only show dependency edges (actual file-to-file dependencies)
      // Folder edges are not shown in the dependency graph
      const allEdges = edgeEntries.filter(
        (edge) =>
          edge.data.type !== "folder" && // Exclude folder hierarchy edges
          nodeIdSet.has(edge.data.source) && 
          nodeIdSet.has(edge.data.target)
      );

      // CodeFlow-style: Nodes with folder grouping
      const COLORS = [
        "#4d9fff",
        "#a78bfa",
        "#22d3ee",
        "#00ff9d",
        "#ff9f43",
        "#ec4899",
        "#ff5f5f",
        "#84cc16",
      ];
      // CodeFlow-style: Extract folders from file paths for positioning/coloring
      const folders = new Set<string>();
      const nodes = nodeEntriesForLayout.map((node) => {
        const size = node.data.size || 1;
        const path = node.data.path || node.data.filePath || "";
        // CodeFlow-style: group by top-level folder (\"src\", \"lib\", etc.)
        const folder = path.split("/")[0] || "root";
        folders.add(folder);

        // CodeFlow-style: Node radius based on function count (we'll use size as proxy)
        const base = node.data.type === "package" ? 10 : 8;
        const radius = Math.max(8, Math.min(24, 5 + Math.sqrt(size) * 0.8));
        
        // Ensure packages always have a name/label
        let nodeName = node.data.displayLabel || node.data.label || node.data.id;
        if (node.data.type === "package" && !nodeName) {
          // Extract package name from path or ID
          const pathOrId = node.data.path || node.data.id || "";
          nodeName = pathOrId.split("/").pop() || pathOrId.split("@").pop() || "pkg";
        }
        
        return {
          id: node.data.id,
          label: nodeName,
          name: nodeName,
          type: node.data.type,
          radius,
          folder,
          color:
            node.data.color ||
            COLORS[Array.from(folders).indexOf(folder) % COLORS.length],
          borderColor: node.data.borderColor || "#a78bfa",
          isExternal: node.data.type === "package",
          path,
          fnCount: Math.floor(Math.sqrt(size)), // Approximate function count from size
        };
      });

      // Calculate folder centers (CodeFlow style)
      const folderList = Array.from(folders);
      const folderGroups = new Map<string, typeof nodes>();
      nodes.forEach((node) => {
        if (!folderGroups.has(node.folder)) folderGroups.set(node.folder, []);
        folderGroups.get(node.folder)!.push(node);
      });

      const cols = Math.max(2, Math.ceil(Math.sqrt(folderList.length)));
      const cellW = width / (cols + 1);
      const cellH = height / (Math.ceil(folderList.length / cols) + 1);
      const centers: Record<string, { x: number; y: number }> = {};
      folderList.forEach((folder, i) => {
        centers[folder] = {
          x: ((i % cols) + 1) * cellW,
          y: (Math.floor(i / cols) + 1) * cellH,
        };
      });

      // CodeFlow exact: Don't pre-position nodes, let force simulation handle it

      // Create node map for quick lookup
      const nodeMap = new Map(nodes.map((n) => [n.id, n]));

      // CodeFlow-style: Links must reference node objects, not IDs
      // Aggregate multiple edges between same nodes (like CodeFlow's linkMap)
      const linkMap = new Map<string, { source: any; target: any; count: number; isExternal: boolean }>();
      allEdges.forEach((edge) => {
        const sourceNode = nodeMap.get(edge.data.source);
        const targetNode = nodeMap.get(edge.data.target);
        if (!sourceNode || !targetNode) return;
        
        const key = `${edge.data.source}|${edge.data.target}`;
        if (!linkMap.has(key)) {
          linkMap.set(key, {
            source: sourceNode,
            target: targetNode,
            count: 0,
            isExternal: edge.data.isExternal || false,
          });
        }
        linkMap.get(key)!.count += edge.data.weight || 1;
      });
      const links = Array.from(linkMap.values());

      console.log("📁 Folders:", folderList.length, folderList.slice(0, 10));
      console.log("📊 Nodes:", nodes.length);
      console.log("🔗 Links:", links.length);
      console.log("📍 Centers:", Object.keys(centers).length);

      // Build adjacency for focus/highlight
      const adjacency = new Map<string, Set<string>>();
      links.forEach((link) => {
        const source = link.source.id;
        const target = link.target.id;
        if (!adjacency.has(source)) adjacency.set(source, new Set());
        if (!adjacency.has(target)) adjacency.set(target, new Set());
        adjacency.get(source)!.add(target);
        adjacency.get(target)!.add(source);
      });

      const defs = svg.append("defs");
      // Arrow marker for links
      defs
        .append("marker")
        .attr("id", "arr")
        .attr("viewBox", "0 -5 10 10")
        .attr("refX", 14)
        .attr("refY", 0)
        .attr("markerWidth", 4)
        .attr("markerHeight", 4)
        .attr("orient", "auto")
        .append("path")
        .attr("d", "M0,-4L10,0L0,4")
        .attr("fill", graphPalette.edge);

      const container = svg.append("g");

      // Create zoom behavior - D3's zoom handles mouse wheel automatically
      const zoom = d3
        .zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.2, 5])
        .on("zoom", (event) => {
          // Apply zoom transform to container
          container.attr("transform", event.transform.toString());
        });
      
      // Apply zoom to SVG - this enables mouse wheel zoom automatically
      svg.call(zoom as any);
      zoomRef.current = zoom;
      
      // Enable keyboard zoom (Ctrl/Cmd + Plus/Minus/0)
      const handleKeyDown = (e: KeyboardEvent) => {
        if ((e.ctrlKey || e.metaKey) && svgRef.current && zoomRef.current) {
          const zoom = zoomRef.current;
          const svgSelection = d3.select(svgRef.current);
          if (e.key === "=" || e.key === "+") {
            e.preventDefault();
            const center = [svgRef.current.clientWidth / 2, svgRef.current.clientHeight / 2];
            svgSelection
              .transition()
              .duration(200)
              .call(zoom.scaleBy as any, 1.4, center);
          } else if (e.key === "-") {
            e.preventDefault();
            const center = [svgRef.current.clientWidth / 2, svgRef.current.clientHeight / 2];
            svgSelection
              .transition()
              .duration(200)
              .call(zoom.scaleBy as any, 0.7, center);
          } else if (e.key === "0") {
            e.preventDefault();
            svgSelection
              .transition()
              .duration(300)
              .call(zoom.transform as any, d3.zoomIdentity);
          }
        }
      };
      handleKeyDownRef.current = handleKeyDown; // Store in ref for cleanup
      if (typeof window !== "undefined") {
        window.addEventListener("keydown", handleKeyDown);
      }

      const linkLayer = container.append("g").attr("stroke-linecap", "round");
      const hullLayer = container.append("g"); // For folder hulls
      const nodeLayer = container.append("g");
      const labelLayer = container.append("g");

      // CodeFlow EXACT: Link styling - use join() for updates
      const link = linkLayer
        .selectAll("path")
        .data(links, (d: any) => `${d.source.id}-${d.target.id}`)
        .join(
          (enter) => enter
            .append("path")
            .attr("fill", "none")
            .attr("stroke", (d: any) => {
              const theme = document.documentElement.classList.contains("light") ? "light" : "dark";
              return theme === "light" ? "#ccc" : "#333";
            })
            .attr("stroke-width", (d: any) =>
              Math.max(1, Math.min(2, Math.sqrt((d.count || 1)) * 0.3))
            )
            .attr("stroke-opacity", 0.4)
            .attr("marker-end", "url(#arr)")
            .attr("marker-end", "url(#arr)"),
          (update) => update,
          (exit) => exit.remove()
        );

      // CodeFlow EXACT: Node styling - use join() for updates
      const node = nodeLayer
        .selectAll("g.node")
        .data(nodes, (d: any) => d.id)
        .join(
          (enter) => {
            const nodeEnter = enter
              .append("g")
              .attr("class", "node")
              .style("cursor", "pointer");
            
            nodeEnter.append("circle").attr("class", "nc");
            nodeEnter.append("text");
            
            return nodeEnter;
          },
          (update) => update,
          (exit) => exit.remove()
        );

      // CodeFlow EXACT: Helper functions for node rendering
      const getR = (d: any) => Math.max(8, Math.min(24, 5 + (d.fnCount || 0) * 0.8));
      // CodeFlow-style: Color function based on colorMode
      const getC = (d: any) => {
        if (colorMode === 'folder') {
          // Color by folder/directory
          return d.color || COLORS[Array.from(folders).indexOf(d.folder) % COLORS.length] || COLORS[0];
        } else if (colorMode === 'layer') {
          // Color by architectural layer (heuristic based on folder patterns)
          const path = d.path || d.id || '';
          if (path.includes('/ui/') || path.includes('/components/') || path.includes('/pages/')) {
            return '#4d9fff'; // Blue for UI/Frontend layer
          } else if (path.includes('/api/') || path.includes('/server/') || path.includes('/backend/')) {
            return '#00ff9d'; // Green for API/Backend layer
          } else if (path.includes('/lib/') || path.includes('/utils/') || path.includes('/helpers/')) {
            return '#a78bfa'; // Purple for Library/Utils layer
          } else if (path.includes('/db/') || path.includes('/models/') || path.includes('/schema/')) {
            return '#ff9f43'; // Orange for Data layer
          } else if (path.includes('/test/') || path.includes('/__tests__/') || path.includes('spec.')) {
            return '#ec4899'; // Pink for Test layer
          } else if (path.includes('/config/') || path.includes('/.')) {
            return '#84cc16'; // Lime for Config layer
          } else {
            return '#8b5cf6'; // Default purple
          }
        } else if (colorMode === 'churn') {
          // Color by file churn (change frequency)
          // For now, use a placeholder heuristic based on file size or depth
          // In a real implementation, this would use git history data
          const pathDepth = (d.path || d.id || '').split('/').length;
          if (pathDepth <= 2) {
            return '#ff5f5f'; // Red for high-churn (root/shallow files change often)
          } else if (pathDepth <= 4) {
            return '#ff9f43'; // Orange for medium-churn
          } else {
            return '#4d9fff'; // Blue for low-churn (deep files change less)
          }
        }
        return d.color || COLORS[0];
      };

      // Update circle attributes for all nodes (existing + new)
      node
        .select("circle.nc")
        .attr("r", getR)
        .attr("fill", getC)
        .attr("stroke", (d: any) => {
          const c = d3.color(getC(d));
          return c ? c.brighter(0.3).toString() : "#fff";
        })
        .attr("stroke-width", 1.5);

      // Create tooltip div if it doesn't exist
      let tooltip: any = d3.select("body").select(".dependency-tooltip");
      if (tooltip.empty()) {
        tooltip = d3.select("body")
          .append("div")
          .attr("class", "dependency-tooltip")
          .style("position", "absolute")
          .style("padding", "8px 12px")
          .style("background", "rgba(0, 0, 0, 0.9)")
          .style("color", "#fff")
          .style("border-radius", "4px")
          .style("font-size", "12px")
          .style("font-family", "JetBrains Mono, monospace")
          .style("pointer-events", "none")
          .style("opacity", 0)
          .style("z-index", "10000")
          .style("max-width", "300px")
          .style("word-wrap", "break-word");
      }

      // Update text attributes for all nodes (existing + new)
      // Ensure text is readable inside circles with proper sizing
      node
        .select("text")
        .attr("text-anchor", "middle")
        .attr("dy", "0.35em") // Better vertical centering inside circle
            .attr("fill", (d: any) => {
              const theme = document.documentElement.classList.contains("light") ? "light" : "dark";
              return theme === "light" ? "#333" : "#eee";
            })
        .attr(
          "font-size",
          (d: any) => {
            const r = getR(d);
            // Calculate font size based on circle radius, ensuring it fits inside
            const fontSize = Math.max(8, Math.min(12, r * 0.4));
            return fontSize + "px";
          }
        )
        .attr("font-family", "JetBrains Mono, monospace")
        .attr("font-weight", 500)
        .attr("pointer-events", "none")
        .attr("opacity", graphConfigRef.current.showLabels ? 1 : 0) // Use graphConfigRef for latest value
        .text((d) => {
          // Handle empty or undefined names - use ID as fallback
          let n = d.name || d.id || d.label || "?";
          // Remove file extension for files
          if (d.type === "file") {
            n = n.replace(/\.[^.]+$/, "");
          }
          // For packages, use the package name (might be scoped like @package/name)
          if (d.type === "package" && !n) {
            n = d.id || d.path || "pkg";
          }
          const r = getR(d);
          // Calculate max characters that fit inside circle (circumference / font width)
          // Approximate: each character is ~0.6 * font size wide
          const fontSize = Math.max(8, Math.min(12, r * 0.4));
          const maxChars = Math.max(3, Math.floor((r * 2 * Math.PI) / (fontSize * 0.6)) - 1);
          return n.length > maxChars ? n.slice(0, maxChars) + "…" : n;
        });

      // Add mouseover/mouseout handlers for tooltip
      node
        .on("mouseover", function(event, d: any) {
          // Get full name with fallbacks
          let fullName = d.name || d.id || d.label || d.path || "Unknown";
          let displayName = d.path || d.id || d.name || "Unknown";
          
          // Remove file extension for files
          if (d.type === "file") {
            fullName = fullName.replace(/\.[^.]+$/, "");
          }
          
          // For packages, show the full package path
          if (d.type === "package") {
            fullName = d.path || d.id || d.name || "Package";
            displayName = d.path || d.id || d.name || "External Package";
          }
          
          tooltip
            .style("opacity", 1)
            .html(`<div><strong>${fullName}</strong></div><div style="font-size: 10px; color: #aaa; margin-top: 4px;">${displayName}</div>`);
        })
        .on("mousemove", function(event) {
          tooltip
            .style("left", (event.pageX + 10) + "px")
            .style("top", (event.pageY - 10) + "px");
        })
        .on("mouseout", function() {
          tooltip.style("opacity", 0);
        });

      // Reuse existing simulation or create new one
      let simulation = simRef.current;
      const existingNodes = simulation ? (simulation.nodes() as any[]) : [];
      const existingNodeMap = new Map(existingNodes.map((n: any) => [n.id, n]));
      
      // Preserve positions of existing nodes, initialize new ones
      nodes.forEach((node: any) => {
        const existing = existingNodeMap.get(node.id);
        if (existing && existing.x != null && existing.y != null && 
            isFinite(existing.x) && isFinite(existing.y) &&
            existing.x !== 0 && existing.y !== 0) {
          // Preserve existing position
          node.x = existing.x;
          node.y = existing.y;
          node.vx = existing.vx;
          node.vy = existing.vy;
        } else {
          // Initialize new node near folder center
          const center = centers[node.folder];
          if (center) {
            node.x = center.x + (Math.random() - 0.5) * 50;
            node.y = center.y + (Math.random() - 0.5) * 50;
          } else {
            node.x = width / 2 + (Math.random() - 0.5) * 100;
            node.y = height / 2 + (Math.random() - 0.5) * 100;
          }
        }
      });
      
      if (!simulation) {
        simulation = d3.forceSimulation(nodes as any);
        simRef.current = simulation;
      } else {
        // Update existing simulation with new nodes
        simulation.nodes(nodes as any);
      }
      
      // CodeFlow EXACT: Different force configurations for each view mode
      const config = graphConfigRef.current; // Use ref for latest config
      
      // Add boundary forces to keep nodes within viewport
      const padding = 50;
      const boundaryForce = (d: any) => {
        const r = getR(d);
        if (d.x < padding + r) d.x = padding + r;
        if (d.x > width - padding - r) d.x = width - padding - r;
        if (d.y < padding + r) d.y = padding + r;
        if (d.y > height - padding - r) d.y = height - padding - r;
      };
      
      // Store hubNodes for use in simulation.on("end")
      let hubNodes: any[] = [];
      
      if (config.viewMode === "force") {
        // Hub-based layout: Identify hub nodes (nodes with many outgoing edges)
        const outDegree = new Map<string, number>();
        links.forEach((l: any) => {
          const sourceId = typeof l.source === "object" ? l.source.id : l.source;
          outDegree.set(sourceId, (outDegree.get(sourceId) || 0) + 1);
        });
        
        // Sort nodes by out-degree to find hubs
        const sortedNodes = [...nodes].sort((a: any, b: any) => 
          (outDegree.get(b.id) || 0) - (outDegree.get(a.id) || 0)
        );
        
        // Position hub nodes in a horizontal spine
        hubNodes = sortedNodes.slice(0, Math.min(20, Math.floor(nodes.length * 0.3))) as any[];
        const hubSpacing = width / (hubNodes.length + 1);
        const hubY = height / 2;
        hubNodes.forEach((hub: any, i: number) => {
          hub.isHub = true;
          hub.hubIndex = i;
          hub.hubX = (i + 1) * hubSpacing;
          hub.hubY = hubY;
        });
        
        // Position dependent nodes in orbits around their hub parents
        const dependentsByHub = new Map<string, any[]>();
        links.forEach((l: any) => {
          const sourceId = typeof l.source === "object" ? l.source.id : l.source;
          const targetId = typeof l.target === "object" ? l.target.id : l.target;
          const hub = hubNodes.find((h: any) => h.id === sourceId);
          if (hub) {
            const target = nodes.find((n: any) => n.id === targetId);
            if (target && !(target as any).isHub) {
              if (!dependentsByHub.has(hub.id)) {
                dependentsByHub.set(hub.id, []);
              }
              dependentsByHub.get(hub.id)!.push(target);
            }
          }
        });
        
        // Calculate orbit positions for dependents
        dependentsByHub.forEach((deps, hubId) => {
          const hub = hubNodes.find((h: any) => h.id === hubId);
          if (!hub) return;
          
          const ringBase = 80;
          const ringStep = 32;
          let currentRing = 0;
          let currentAngle = 0;
          const perRing = 8;
          
          deps.forEach((dep: any, i: number) => {
            if (i > 0 && i % perRing === 0) {
              currentRing++;
              currentAngle = 0;
            }
            const angle = (currentAngle / perRing) * 2 * Math.PI;
            const radius = ringBase + currentRing * ringStep;
            dep.orbitHub = hub.id;
            dep.orbitAngle = angle;
            dep.orbitRadius = radius;
            currentAngle++;
              });
            });
        
        simulation
          .force("link", d3.forceLink(links as any).id((d: any) => d.id).distance(config.linkDist).strength(0.3))
          .force("charge", d3.forceManyBody().strength(-config.spacing * 2.5).distanceMax(1000))
          .force("collision", d3.forceCollide().radius((d: any) => getR(d) + 50).iterations(8))
          .force("x", d3.forceX((d: any) => {
            if ((d as any).isHub) return (d as any).hubX;
            if ((d as any).orbitHub) {
              const hub = hubNodes.find((h: any) => h.id === (d as any).orbitHub);
              if (hub) return hub.hubX + Math.cos((d as any).orbitAngle) * (d as any).orbitRadius;
            }
            const center = centers[d.folder];
            return center ? center.x : width / 2;
          }).strength(0.8))
          .force("y", d3.forceY((d: any) => {
            if ((d as any).isHub) return (d as any).hubY;
            if ((d as any).orbitHub) {
              const hub = hubNodes.find((h: any) => h.id === (d as any).orbitHub);
              if (hub) return hub.hubY + Math.sin((d as any).orbitAngle) * (d as any).orbitRadius;
            }
            const center = centers[d.folder];
            return center ? center.y : height / 2;
          }).strength(0.8))
          .force("boundary", () => {
            nodes.forEach(boundaryForce);
          });
      } else if (config.viewMode === "radial") {
        const r = Math.min(width, height) * 0.35;
        nodes.forEach((n: any, i: number) => {
          n.angle = (i / nodes.length) * 2 * Math.PI;
          n.targetX = width / 2 + Math.cos(n.angle) * r;
          n.targetY = height / 2 + Math.sin(n.angle) * r;
        });
        simulation
          .force("link", d3.forceLink(links as any).id((d: any) => d.id).distance(config.linkDist * 0.5).strength(0.05))
          .force("charge", d3.forceManyBody().strength(-config.spacing * 1.5).distanceMax(800))
          .force("collision", d3.forceCollide().radius((d: any) => getR(d) + 50).iterations(8))
          .force("x", d3.forceX((d: any) => (d as any).targetX).strength(0.8))
          .force("y", d3.forceY((d: any) => (d as any).targetY).strength(0.8))
          .force("boundary", () => {
            nodes.forEach(boundaryForce);
          });
      } else if (config.viewMode === "hierarchical") {
        // Group by folder for hierarchical layout
        const layerGroups: { [key: string]: any[] } = {};
        nodes.forEach((n: any) => {
          const l = n.folder || "root";
          if (!layerGroups[l]) layerGroups[l] = [];
          layerGroups[l].push(n);
        });
        const sortedLayers = Object.keys(layerGroups).sort();
        sortedLayers.forEach((l, li) => {
          const g = layerGroups[l];
          if (!g) return;
          const colW = width / (sortedLayers.length + 1);
          g.forEach((n: any, ni: number) => {
            n.targetX = (li + 1) * colW;
            n.targetY = ((ni + 1) * height) / (g.length + 1);
          });
        });
        simulation
          .force("link", d3.forceLink(links as any).id((d: any) => d.id).distance(config.linkDist).strength(0.1))
          .force("charge", d3.forceManyBody().strength(-config.spacing * 2.0).distanceMax(800))
          .force("collision", d3.forceCollide().radius((d: any) => getR(d) + 50).iterations(8))
          .force("x", d3.forceX((d: any) => (d as any).targetX || width / 2).strength(0.9))
          .force("y", d3.forceY((d: any) => (d as any).targetY || height / 2).strength(0.3))
          .force("boundary", () => {
            nodes.forEach(boundaryForce);
          });
      } else if (config.viewMode === "grid") {
        const gridCols = Math.ceil(Math.sqrt(nodes.length));
        const cellW = width / (gridCols + 1);
        const cellH = height / (Math.ceil(nodes.length / gridCols) + 1);
        nodes.forEach((n: any, i: number) => {
          n.targetX = ((i % gridCols) + 1) * cellW;
          n.targetY = (Math.floor(i / gridCols) + 1) * cellH;
        });
        simulation
          .force("link", d3.forceLink(links as any).id((d: any) => d.id).distance(config.linkDist * 1.5).strength(0.02))
          .force("charge", d3.forceManyBody().strength(-config.spacing * 1.5).distanceMax(800))
          .force("collision", d3.forceCollide().radius((d: any) => getR(d) + 50).iterations(8))
          .force("x", d3.forceX((d: any) => (d as any).targetX).strength(1))
          .force("y", d3.forceY((d: any) => (d as any).targetY).strength(1))
          .force("boundary", () => {
            nodes.forEach(boundaryForce);
          });
      } else if (config.viewMode === "metro") {
        // Metro layout: find root nodes (no incoming edges) and arrange in lines
        const roots = nodes.filter((n: any) => 
          !links.some((l: any) => {
            const targetId = typeof l.target === "object" ? l.target.id : l.target;
            return targetId === n.id;
          })
        );
        const actualRoots = roots.length > 0 ? roots : [nodes[0]];
        const lineY = 80;
        const lineSpacing = Math.min(120, (height - 160) / Math.max(1, actualRoots.length));
        actualRoots.forEach((root: any, li: number) => {
          const visited = new Set<string>();
          const queue = [root.id];
          let x = 80;
          while (queue.length > 0) {
            const id = queue.shift()!;
            if (visited.has(id)) continue;
            visited.add(id);
            const node = nodes.find((n: any) => n.id === id);
            if (node) {
              (node as any).targetX = x;
              (node as any).targetY = lineY + li * lineSpacing;
              (node as any).metroLine = li;
              x += config.spacing * 0.8;
              links.forEach((l: any) => {
                const sourceId = typeof l.source === "object" ? l.source.id : l.source;
                const targetId = typeof l.target === "object" ? l.target.id : l.target;
                if (sourceId === id && !visited.has(targetId)) {
                  queue.push(targetId);
                }
              });
            }
          }
        });
        nodes.filter((n: any) => !(n as any).targetX).forEach((n: any, i: number) => {
          n.targetX = 80 + i * 50;
          n.targetY = height - 80;
          (n as any).metroLine = actualRoots.length;
        });
        simulation
          .force("link", d3.forceLink(links as any).id((d: any) => d.id).distance(config.linkDist).strength(0.02))
          .force("charge", d3.forceManyBody().strength(-config.spacing * 2.5).distanceMax(1000))
          .force("collision", d3.forceCollide().radius((d: any) => getR(d) + 50).iterations(8))
          .force("x", d3.forceX((d: any) => (d as any).targetX || width / 2).strength(0.3))
          .force("y", d3.forceY((d: any) => (d as any).targetY || height / 2).strength(0.3))
          .force("boundary", () => {
            nodes.forEach(boundaryForce);
          });
      }
      
      // Always restart simulation when config changes to apply new forces
      simulation
        .velocityDecay(0.6)
        .alphaDecay(0.05)
        .alpha(1) // Full alpha when view mode or config changes - restart simulation
        .restart();
      
      // Attach drag handlers with highlighting and dependent node movement
      // Track if there's actual movement to prevent click from triggering drag
      let dragStarted = false;
      let startX = 0;
      let startY = 0;
      
      node.call(
        d3
          .drag<SVGGElement, any>()
          .on("start", (event, d) => {
            // Track start position to detect actual drag vs click
            startX = event.x;
            startY = event.y;
            dragStarted = false;
            
            // Don't do anything on start - wait for actual drag movement
          })
          .on("drag", (event, d) => {
            // Only activate drag if there's actual movement (more than 5px)
            const dx = Math.abs(event.x - startX);
            const dy = Math.abs(event.y - startY);
            if (!dragStarted && (dx < 5 && dy < 5)) {
              return; // Too little movement, treat as click
            }
            
            if (!dragStarted) {
              // First actual drag - initialize drag state
              dragStarted = true;
              
              // Store initial position
              dragStateRef.current.draggedNodeId = d.id;
              dragStateRef.current.initialX = d.x || 0;
              dragStateRef.current.initialY = d.y || 0;
              // Fix dragged node position
              d.fx = d.x;
              d.fy = d.y;
              
              // Find all dependent nodes (nodes this node connects to)
              const dependents = new Set<string>();
              links.forEach((l: any) => {
                const sourceId = typeof l.source === "object" ? l.source.id : l.source;
                const targetId = typeof l.target === "object" ? l.target.id : l.target;
                if (sourceId === d.id) {
                  dependents.add(targetId);
                }
              });
              
              // Also find nodes that connect to this node (dependencies)
              const dependencies = new Set<string>();
              links.forEach((l: any) => {
                const sourceId = typeof l.source === "object" ? l.source.id : l.source;
                const targetId = typeof l.target === "object" ? l.target.id : l.target;
                if (targetId === d.id) {
                  dependencies.add(sourceId);
                }
              });
              
              // Store for drag handler
              dragStateRef.current.dependents = dependents;
              dragStateRef.current.dependencies = dependencies;
              
              // Combine all related nodes
              const allRelated = new Set([...dependents, ...dependencies]);
              
              // Store initial relative positions for smooth orbiting
              nodes.forEach((n: any) => {
                if (allRelated.has(n.id)) {
                  n._initialRelX = (n.x || 0) - dragStateRef.current.initialX;
                  n._initialRelY = (n.y || 0) - dragStateRef.current.initialY;
                  n._initialRelDist = Math.sqrt(n._initialRelX * n._initialRelX + n._initialRelY * n._initialRelY);
                }
              });
              
              // Update visual highlighting - like search highlighting (green for related, greyish for others)
              const theme = document.documentElement.classList.contains("light") ? "light" : "dark";
              
              nodeLayer.selectAll("g.node").each(function(n: any) {
                const nodeGroup = d3.select(this);
                const circle = nodeGroup.select("circle.nc");
                const isSelected = n.id === d.id;
                const isRelated = allRelated.has(n.id);
                
                circle
                  .attr("opacity", isSelected ? 1 : isRelated ? 1 : 0.2)
                  .attr("fill", isSelected ? "#ff5f5f" : isRelated ? "#00ff9d" : getC(n))
                  .attr("stroke-width", isSelected ? 3 : isRelated ? 3 : 1.5)
                  .attr("stroke", isSelected ? "#ff5f5f" : isRelated ? "#00ff9d" : (() => {
                    const c = d3.color(getC(n));
                    return c ? c.brighter(0.3).toString() : "#fff";
                  })());
              });
              
              // Highlight links - green for connected, greyish for others (like search)
              linkLayer.selectAll("path").each(function(l: any) {
                const path = d3.select(this);
                const sourceId = typeof l.source === "object" ? l.source.id : l.source;
                const targetId = typeof l.target === "object" ? l.target.id : l.target;
                const isConnected = sourceId === d.id || targetId === d.id;
                
                path
                  .attr("stroke-opacity", isConnected ? 0.8 : 0.15)
                  .attr("stroke", isConnected ? "#00ff9d" : (theme === "light" ? "#999999" : "#666666"))
                  .attr("stroke-width", isConnected ? 3 : Math.max(1, Math.min(2, Math.sqrt((l.count || 1)) * 0.3)));
              });
            }
            
            // Continue with drag movement
            // Update dragged node position
            d.fx = event.x;
            d.fy = event.y;
            
            // Smoothly move dependent/dependency nodes to orbit around dragged node
            // Use fixed positions (fx/fy) instead of velocities to prevent chaos
            nodes.forEach((n: any) => {
              if (n.id === d.id) return; // Skip the dragged node itself
              
              const isDependent = dragStateRef.current.dependents.has(n.id);
              const isDependency = dragStateRef.current.dependencies.has(n.id);
              
              if (isDependent || isDependency) {
                // Use stored initial relative position
                const relX = n._initialRelX || 0;
                const relY = n._initialRelY || 0;
                const relDist = n._initialRelDist || 100;
                
                // Maintain orbit distance but allow slight compression for closer inspection
                const orbitRadius = Math.max(80, relDist * 0.9); // Slightly closer for better visibility
                
                // Normalize the relative vector
                const normX = relDist > 0 ? relX / relDist : 0;
                const normY = relDist > 0 ? relY / relDist : 0;
                
                // Calculate target position: dragged node position + relative offset
                const targetX = event.x + normX * orbitRadius;
                const targetY = event.y + normY * orbitRadius;
                
                // Fix position for smooth, predictable movement (no chaos!)
                n.fx = targetX;
                n.fy = targetY;
              }
            });
            
            // Don't restart simulation during drag - let the fixed positions handle movement
            // This prevents the "flies in a glass" effect
          })
          .on("end", (event, d) => {
            // Only reset if drag actually started (not just a click)
            if (!dragStarted) {
              return; // It was just a click, don't reset anything
            }
            
            if (!event.active && simulation) simulation.alphaTarget(0);
            d.fx = null;
            d.fy = null;
            dragStarted = false;
            
            // Release dependent/dependency nodes gradually (smooth transition back to natural forces)
            nodes.forEach((n: any) => {
              if (dragStateRef.current.dependents.has(n.id) || dragStateRef.current.dependencies.has(n.id)) {
                // Clear fixed positions but keep velocities for smooth transition
                n.fx = null;
                n.fy = null;
                // Clean up stored relative positions
                delete n._initialRelX;
                delete n._initialRelY;
                delete n._initialRelDist;
              }
            });
            
            // Restart simulation to let nodes settle naturally
            if (!event.active && simulation) {
              simulation.alphaTarget(0.1).restart();
              // Gradually reduce alpha target to let nodes settle
              setTimeout(() => {
                if (simulation) simulation.alphaTarget(0);
              }, 500);
            }
            
            // Reset drag state
            dragStateRef.current.draggedNodeId = null;
            dragStateRef.current.dependents.clear();
            dragStateRef.current.dependencies.clear();
            
            // Reset highlighting - like search reset
            const theme = document.documentElement.classList.contains("light") ? "light" : "dark";
            nodeLayer.selectAll("g.node").each(function(n: any) {
              const nodeGroup = d3.select(this);
              const circle = nodeGroup.select("circle.nc");
              const c = d3.color(getC(n));
              circle
                .attr("opacity", 1)
                .attr("fill", getC(n))
                .attr("stroke-width", 1.5)
                .attr("stroke", c ? c.brighter(0.3).toString() : "#fff");
            });
            
            linkLayer.selectAll("path").each(function(l: any) {
              const path = d3.select(this);
              path
                .attr("stroke-opacity", 0.4)
                .attr("stroke", theme === "light" ? "#999999" : "#666666")
                .attr("stroke-width", Math.max(1, Math.min(2, Math.sqrt((l.count || 1)) * 0.3)));
            });
          }) as any
      );
      
      // Attach click handlers to all nodes (existing + new)
      node.on("click", (e, d) => {
        e.stopPropagation();
        if (selectFileRef.current) selectFileRef.current(d.id);
      });
      
      // Add double-click handler for dependency analysis (highlight without dragging)
      node.on("dblclick", (e, d) => {
        e.stopPropagation();
        
        // Find all dependent nodes (nodes this node connects to)
        const dependents = new Set<string>();
        links.forEach((l: any) => {
          const sourceId = typeof l.source === "object" ? l.source.id : l.source;
          const targetId = typeof l.target === "object" ? l.target.id : l.target;
          if (sourceId === d.id) {
            dependents.add(targetId);
          }
        });
        
        // Also find nodes that connect to this node (dependencies)
        const dependencies = new Set<string>();
        links.forEach((l: any) => {
          const sourceId = typeof l.source === "object" ? l.source.id : l.source;
          const targetId = typeof l.target === "object" ? l.target.id : l.target;
          if (targetId === d.id) {
            dependencies.add(sourceId);
          }
        });
        
        // Combine all related nodes
        const allRelated = new Set([...dependents, ...dependencies]);
        
        // Highlight like drag/search - green for related, greyish for others
        const theme = document.documentElement.classList.contains("light") ? "light" : "dark";
        
        nodeLayer.selectAll("g.node").each(function(n: any) {
          const nodeGroup = d3.select(this);
          const circle = nodeGroup.select("circle.nc");
          const isSelected = n.id === d.id;
          const isRelated = allRelated.has(n.id);
          
          circle
            .attr("opacity", isSelected ? 1 : isRelated ? 1 : 0.2)
            .attr("fill", isSelected ? "#ff5f5f" : isRelated ? "#00ff9d" : getC(n))
            .attr("stroke-width", isSelected ? 3 : isRelated ? 3 : 1.5)
            .attr("stroke", isSelected ? "#ff5f5f" : isRelated ? "#00ff9d" : (() => {
              const c = d3.color(getC(n));
              return c ? c.brighter(0.3).toString() : "#fff";
            })());
        });
        
        // Highlight links - green for connected, greyish for others
        linkLayer.selectAll("path").each(function(l: any) {
          const path = d3.select(this);
          const sourceId = typeof l.source === "object" ? l.source.id : l.source;
          const targetId = typeof l.target === "object" ? l.target.id : l.target;
          const isConnected = sourceId === d.id || targetId === d.id;
          
          path
            .attr("stroke-opacity", isConnected ? 0.8 : 0.15)
            .attr("stroke", isConnected ? "#00ff9d" : (theme === "light" ? "#999999" : "#666666"))
            .attr("stroke-width", isConnected ? 3 : Math.max(1, Math.min(2, Math.sqrt((l.count || 1)) * 0.3)));
        });
        
        // Set focused node for blast radius
        setFocusedNodeId(d.id);
        if (selectFileRef.current) selectFileRef.current(d.id);
      });

      // CodeFlow EXACT: Update positions on simulation tick
      // Remove old tick handler if exists, then add new one
      simulation.on("tick", null);
      simulation.on("tick", () => {
        // Use graphConfigRef to always get latest config values
        const config = graphConfigRef.current;
        
        // Get current search state from refs (always latest values)
        const currentSearchQuery = searchQueryRef.current;
        const currentMatchingNodes = matchingNodesRef.current;
        const currentHighlightedNodeId = highlightedNodeIdRef.current;
        const hasSearch = currentSearchQuery.trim() && currentMatchingNodes.size > 0;
        
        // Update link paths (curved or straight based on config.curvedLinks)
        // CodeFlow EXACT: Use node centers, not edge points
        link.attr("d", (d: any) => {
          // Ensure source and target are node objects (not IDs)
          const source = typeof d.source === "object" ? d.source : nodes.find((n: any) => n.id === d.source);
          const target = typeof d.target === "object" ? d.target : nodes.find((n: any) => n.id === d.target);
          
          if (!source || !target || source.x == null || source.y == null || target.x == null || target.y == null) {
            return "M0,0L0,0";
          }
          
          // Validate positions are finite
          if (!isFinite(source.x) || !isFinite(source.y) || !isFinite(target.x) || !isFinite(target.y)) {
            return "M0,0L0,0";
          }
          
          // CodeFlow EXACT: Use centers for both curved and straight
          if (config.curvedLinks) {
            const dx = target.x - source.x;
            const dy = target.y - source.y;
            const dr = Math.sqrt(dx * dx + dy * dy);
            if (dr === 0) return "M0,0L0,0";
            return `M${source.x},${source.y}A${dr},${dr} 0 0,1 ${target.x},${target.y}`;
          } else {
            return `M${source.x},${source.y}L${target.x},${target.y}`;
          }
        });
        
        // Preserve highlighting in tick handler (search, drag, double-click) - so it persists during zoom/pan
        const draggedNodeId = dragStateRef.current.draggedNodeId;
        const dragDependents = dragStateRef.current.dependents;
        const dragDependencies = dragStateRef.current.dependencies;
        const dragAllRelated = new Set([...dragDependents, ...dragDependencies]);
        const hasDrag = draggedNodeId !== null;
        // Use focusedNodeId from state (will be updated via closure)
        const currentFocusedNodeId = focusedNodeId;
        const hasFocus = currentFocusedNodeId !== null;
        
        if (hasSearch || hasDrag || hasFocus) {
          link.each(function(l: any) {
            const path = d3.select(this);
            const sourceId = typeof l.source === "object" ? l.source.id : l.source;
            const targetId = typeof l.target === "object" ? l.target.id : l.target;
            
            // Check if link is highlighted by search
            const isSearchHighlighted = hasSearch && (currentMatchingNodes.has(sourceId) || currentMatchingNodes.has(targetId));
            // Check if link is highlighted by drag/double-click
            const isDragHighlighted = hasDrag && (sourceId === draggedNodeId || targetId === draggedNodeId);
            const isFocusHighlighted = hasFocus && (sourceId === currentFocusedNodeId || targetId === currentFocusedNodeId);
            const isHighlighted = isSearchHighlighted || isDragHighlighted || isFocusHighlighted;
            
            // Green for highlighted links, greyish for others
            path
              .attr("stroke", isHighlighted ? "#00ff9d" : "#666666")
              .attr("stroke-opacity", isHighlighted ? 0.8 : 0.15);
          });
        } else {
          // Default link styling when no highlighting - more greyish
          const theme = document.documentElement.classList.contains("light") ? "light" : "dark";
          link.attr("stroke", theme === "light" ? "#999999" : "#666666")
            .attr("stroke-opacity", 0.4);
        }
        
        // Clamp node positions to viewport bounds to prevent nodes going outside
        const padding = 50;
        nodes.forEach((d: any) => {
          const r = getR(d);
          if (d.x != null && d.y != null && isFinite(d.x) && isFinite(d.y)) {
            d.x = Math.max(padding + r, Math.min(width - padding - r, d.x));
            d.y = Math.max(padding + r, Math.min(height - padding - r, d.y));
          }
        });
        
        // Update node positions
        node.attr("transform", (d: any) => {
          if (d.x == null || d.y == null || !isFinite(d.x) || !isFinite(d.y)) {
            return "translate(0,0)";
          }
          return `translate(${d.x},${d.y})`;
        });
        
        // Preserve highlighting for nodes in tick handler (search, drag, double-click) - so it persists during zoom/pan
        if (hasSearch || hasDrag || hasFocus) {
          node.selectAll("circle.nc").each(function(n: any) {
            const circle = d3.select(this);
            
            // Check search highlighting
            const isSearchMatch = hasSearch && currentMatchingNodes.has(n.id);
            const isSearchHighlighted = hasSearch && currentHighlightedNodeId === n.id;
            
            // Check drag/double-click highlighting
            const isDragSelected = hasDrag && n.id === draggedNodeId;
            const isDragRelated = hasDrag && dragAllRelated.has(n.id);
            const isFocusSelected = hasFocus && n.id === currentFocusedNodeId;
            
            const isSelected = isSearchHighlighted || isDragSelected || isFocusSelected;
            const isRelated = isSearchMatch || isDragRelated;
            
            circle
              .attr("opacity", isSelected ? 1 : isRelated ? 1 : 0.2)
              .attr("fill", isSelected ? "#ff5f5f" : isRelated ? "#00ff9d" : getC(n))
              .attr("stroke", isSelected || isRelated ? "#00ff9d" : (() => {
                const c = d3.color(getC(n));
                return c ? c.brighter(0.3).toString() : "#fff";
              })())
              .attr("stroke-width", isSelected || isRelated ? 3 : 1.5);
          });
        } else {
          // Default node styling when no highlighting
          node.selectAll("circle.nc")
            .attr("opacity", 1)
            .attr("fill", getC)
            .attr("stroke", (d: any) => {
              const c = d3.color(getC(d));
              return c ? c.brighter(0.3).toString() : "#fff";
            })
            .attr("stroke-width", 1.5);
        }
        
        // Update text opacity and ensure it's centered inside circle
        node.selectAll("text")
          .attr("opacity", config.showLabels ? 1 : 0)
          .attr("dy", "0.35em"); // Better vertical centering inside circle
        
        // Update hulls
        updateHulls();
      });

      // CodeFlow EXACT: Update hulls (folder groupings)
      const updateHulls = () => {
        hullLayer.selectAll("*").remove();
        if (viewMode === "folder" && folderList.length > 0 && nodes.length > 0) {
          // CodeFlow EXACT: Use folderList and filter nodes by folder
          folderList.forEach((folder) => {
            const fn = nodes.filter((n: any) => n.folder === folder);
            if (fn.length < 1) return;
            
            // CodeFlow EXACT: pad=30, use node positions directly (no radius offset)
            const pad = 30;
            const pts: [number, number][] = [];
            fn.forEach((n: any) => {
              if (n.x != null && n.y != null && isFinite(n.x) && isFinite(n.y)) {
                pts.push(
                  [n.x - pad, n.y - pad],
                  [n.x + pad, n.y - pad],
                  [n.x - pad, n.y + pad],
                  [n.x + pad, n.y + pad]
                );
              }
            });
            if (pts.length < 3) return;
            
            const hull = d3.polygonHull(pts);
            if (hull) {
              const color = COLORS[folderList.indexOf(folder) % COLORS.length] || COLORS[0];
              
              // CodeFlow EXACT: fill-opacity 0.04, stroke-opacity 0.25, stroke-width 2
              hullLayer
                .append("path")
                .attr("d", "M" + hull.join("L") + "Z")
                .attr("fill", color)
                .attr("fill-opacity", 0.04)
                .attr("stroke", color)
                .attr("stroke-width", 2)
                .attr("stroke-opacity", 0.25)
                .attr("rx", 8);
              
              // CodeFlow EXACT: label positioning
              const cx = d3.mean(fn, (n: any) => n.x) || 0;
              const cy = (d3.min(fn, (n: any) => n.y) || 0) - pad - 8;
              
              hullLayer
                .append("text")
                .attr("x", cx)
                .attr("y", cy)
                .attr("text-anchor", "middle")
                .attr("fill", color)
                .attr("font-size", "10px")
                .attr("font-family", "JetBrains Mono, monospace")
                .attr("font-weight", 600)
                .attr("opacity", 0.7)
                .text(folder || "root");
            }
          });
        }
      };

      selectFileRef.current = (id: string) => {
        const selectedNode = nodes.find((n) => n.id === id);
        if (selectedNode) {
          setFocusedNodeId(id);
          // Calculate blast radius (affected files)
          const affected = new Set<string>();
          const visited = new Set<string>();
          const queue = [id];
          visited.add(id);
          while (queue.length > 0 && affected.size < 50) {
            const current = queue.shift()!;
            const neighbors = adjacency.get(current) || new Set();
            neighbors.forEach((neighbor) => {
              if (!visited.has(neighbor)) {
                visited.add(neighbor);
                affected.add(neighbor);
                queue.push(neighbor);
              }
            });
          }
          setBlastRadius({ affected: Array.from(affected) });
        }
      };

      // Click handlers are already attached above

      svg.on("click", (e) => {
        if (e.target === svg.node()) {
          // Reset all highlighting (search, drag, double-click)
          setFocusedNodeId(null);
          setBlastRadius(null);
          dragStateRef.current.draggedNodeId = null;
          dragStateRef.current.dependents.clear();
          dragStateRef.current.dependencies.clear();
          
          const theme = document.documentElement.classList.contains("light") ? "light" : "dark";
          
          // Reset link highlighting
          linkLayer.selectAll("path").each(function(l: any) {
            const path = d3.select(this);
            path
              .attr("stroke-opacity", 0.4)
              .attr("stroke", theme === "light" ? "#999999" : "#666666")
              .attr("stroke-width", Math.max(1, Math.min(2, Math.sqrt((l.count || 1)) * 0.3)));
          });
          
          // Reset node highlighting
          nodeLayer.selectAll("g.node").each(function(n: any) {
            const nodeGroup = d3.select(this);
            const circle = nodeGroup.select("circle.nc");
            const c = d3.color(getC(n));
            circle
              .attr("opacity", 1)
              .attr("fill", getC(n))
              .attr("stroke-width", 1.5)
              .attr("stroke", c ? c.brighter(0.3).toString() : "#fff");
          });
        }
      });

      const fitToView = () => {
        if (!svgRef.current || !zoomRef.current) return;
        const validNodes = nodes.filter(
          (n: any) =>
            n.x != null && n.y != null && isFinite(n.x) && isFinite(n.y)
        );
        if (validNodes.length === 0) return;
        const xs = validNodes.map((n: any) => n.x);
        const ys = validNodes.map((n: any) => n.y);
        const minX = Math.min(...xs);
        const maxX = Math.max(...xs);
        const minY = Math.min(...ys);
        const maxY = Math.max(...ys);
        if (
          !isFinite(minX) ||
          !isFinite(maxX) ||
          !isFinite(minY) ||
          !isFinite(maxY)
        )
          return;
        const pad = 100;
        const boundsW = Math.max(200, maxX - minX + pad * 2);
        const boundsH = Math.max(200, maxY - minY + pad * 2);
        const scale = Math.min(width / boundsW, height / boundsH, 1);
        const tx = (width - scale * (minX + maxX)) / 2;
        const ty = (height - scale * (minY + maxY)) / 2;
        if (!isFinite(scale) || !isFinite(tx) || !isFinite(ty)) return;
        const zoom = zoomRef.current;
        d3.select(svgRef.current)
          .transition()
          .duration(500)
          .call(
            zoom.transform as any,
            d3.zoomIdentity.translate(tx, ty).scale(scale)
          );
      };

      // Store refs for updates
      nodesRef.current = node;
      linksRef.current = link;
      

      simulation.on("end", null);
      simulation.on("end", () => {
        // Only fit to view if nodes have valid positions
        const validNodes = nodes.filter(
          (n: any) =>
            n.x != null && n.y != null && isFinite(n.x) && isFinite(n.y) && 
            n.x !== 0 && n.y !== 0 && 
            Math.abs(n.x) < width * 10 && Math.abs(n.y) < height * 10
        );
        if (validNodes.length > nodes.length * 0.5) {
          setTimeout(() => fitToView(), 200);
        }
        // Prevent graph from collapsing - maintain hub positions (only in force mode)
        if (config.viewMode === "force" && hubNodes.length > 0) {
          hubNodes.forEach((hub: any) => {
            if (hub.x != null && hub.y != null && hub.hubX != null && hub.hubY != null) {
              hub.fx = hub.hubX;
              hub.fy = hub.hubY;
            }
          });
        }
      });

      cleanup = () => {
        if (simRef.current) simRef.current.stop();
        if (typeof window !== "undefined" && handleKeyDownRef.current) {
          window.removeEventListener("keydown", handleKeyDownRef.current);
          handleKeyDownRef.current = null;
        }
        svg.selectAll("*").remove();
      };
    });

    return () => {
      if (cleanup) cleanup();
    };
  }, [
    activeGraphData,
    elementsToRender,
    showFolders,
    viewMode,
    showExternal,
    edgeWeightThreshold,
    focusMode,
    graphPalette,
    focusedNodeId,
    graphConfig, // Add graphConfig so simulation updates when config changes
    colorMode, // Add colorMode so graph re-colors when color mode changes
  ]);


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

      const filePaths = codeFiles.map((f) => f.path);
      const initialGraph = buildGraph([], filePaths);
      const initialFolderGraph = buildFolderOverview([], filePaths);
      setGraphData(initialGraph);
      setFolderGraphData(initialFolderGraph);
      setFilesFetched(true);

      setStatus(`Parsing dependencies from ${codeFiles.length} code files...`);
      const allDeps: Dependency[] = [];

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

            // Update graph progressively as files are scanned (like Gource)
            const currentGraph = buildGraph(allDeps, filePaths);
            const currentFolderGraph = buildFolderOverview(allDeps, filePaths);
            setGraphData(currentGraph);
            setFolderGraphData(currentFolderGraph);
            setDependencies([...allDeps]);
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
      if (!layoutInitRef.current) {
        setShowFolders(false);
        setFocusMode(false);
        setViewMode("folder");
        setEdgeWeightThreshold(1);
        setShowExternal(true);
        setMinFolderSize(1);
        layoutInitRef.current = true;
      }

      const finalGraph = buildGraph(allDeps, filePaths);
      const depEdges = finalGraph.edges.filter(
        (e: any) => e.data.type !== "folder"
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

  const toDisplayLabel = (label: string) => {
    if (label.length <= 18) return label;
    return `${label.slice(0, 8)}...${label.slice(-6)}`;
  };

  function buildGraph(deps: Dependency[], filePaths: string[]): GraphData {
    const nodes = new Map<string, GraphNode>();
    const edges: GraphEdge[] = [];
    const folders = new Set<string>();
    const defaultColor = { fill: "#8b5cf6", border: "#a78bfa" };
    const palette: Array<{ fill: string; border: string }> = [
      { fill: "#8b5cf6", border: "#a78bfa" },
      { fill: "#f59e0b", border: "#fbbf24" },
      { fill: "#22c55e", border: "#4ade80" },
      { fill: "#06b6d4", border: "#22d3ee" },
      { fill: "#ec4899", border: "#f472b6" },
      { fill: "#3b82f6", border: "#60a5fa" },
      { fill: "#f97316", border: "#fb923c" },
      { fill: "#14b8a6", border: "#2dd4bf" },
    ];
    const folderColors = new Map<string, { fill: string; border: string }>();

    const getFolderColor = (folderKey: string) => {
      const existing = folderColors.get(folderKey);
      if (existing) return existing;
      const color = palette[folderColors.size % palette.length] || defaultColor;
      folderColors.set(folderKey, color);
      return color;
    };

    const calcNodeSize = (label: string, min: number, max: number) => {
      const length = Math.max(label.length, 3);
      const size = length * 7.5 + 8;
      return Math.min(Math.max(size, min), max);
    };

    const getPackageKey = (modulePath: string) => {
      if (modulePath.startsWith("@")) {
        const parts = modulePath.split("/");
        return parts.slice(0, 2).join("/");
      }
      return modulePath.split("/")[0] || modulePath;
    };

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
        data: {
          id,
          label,
          path: folderPath,
          type: "folder",
        },
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
      const displayLabel = toDisplayLabel(label);
      const parentPath = path.split("/").slice(0, -1).join("/");

      const folderKey = path.split("/")[0] || "root";
      const folderColor = getFolderColor(folderKey);
      nodes.set(path, {
        data: {
          id,
          label,
          displayLabel,
          path,
          type: "file",
          color: folderColor.fill,
          borderColor: folderColor.border,
          size: calcNodeSize(displayLabel, 26, 90),
        },
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

      // Ensure source file node exists
      if (!nodes.has(dep.from)) {
        const label = dep.from.split("/").pop() || dep.from;
        const displayLabel = toDisplayLabel(label);
        const fromFolderKey = dep.from.split("/")[0] || "root";
        const fromColor = getFolderColor(fromFolderKey);
        nodes.set(dep.from, {
          data: {
            id: fromId,
            label,
            displayLabel,
            path: dep.from,
            type: "file",
            color: fromColor.fill,
            borderColor: fromColor.border,
            size: calcNodeSize(displayLabel, 26, 90),
          },
        });
      }

      // Check if target is an internal file or external package
      const isInternal = nodes.has(dep.to);
      const packageKey = getPackageKey(dep.to);
      const toKey = isInternal ? dep.to : packageKey;
      const toId = toKey.replace(/[^a-zA-Z0-9]/g, "_");

      if (!isInternal) {
        // External package - create a node for it
        const label = packageKey || toKey || toId || "unknown-package";
        const displayLabel = toDisplayLabel(label) || label;
        nodes.set(toKey, {
          data: {
            id: toId,
            label: label || displayLabel,
            displayLabel: displayLabel || label,
            path: toKey || label,
            type: "package",
            size: calcNodeSize(displayLabel, 26, 90),
          },
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
          weight: 1,
        },
      });
    });

    const maxNodes = 300;
    if (nodes.size > maxNodes) {
      const limitedNodes = new Map<string, GraphNode>();
      const keep = new Set<string>();
      const addNode = (key: string) => {
        if (limitedNodes.size >= maxNodes) return;
        const node = nodes.get(key);
        if (node && !limitedNodes.has(key)) {
          limitedNodes.set(key, node);
          keep.add(node.data.id);
        }
      };
      addNode(rootId);
      // Keep top-level folders first
      Array.from(nodes.keys())
        .filter((key) => key.startsWith("folder:"))
        .slice(0, Math.max(20, Math.floor(maxNodes / 5)))
        .forEach(addNode);
      // Keep most connected files/packages
      const degree = new Map<string, number>();
      edges.forEach((edge) => {
        degree.set(edge.data.source, (degree.get(edge.data.source) || 0) + 1);
        degree.set(edge.data.target, (degree.get(edge.data.target) || 0) + 1);
      });
      const byDegree = Array.from(nodes.values())
        .filter((node) => node.data.type !== "folder")
        .sort(
          (a, b) => (degree.get(b.data.id) || 0) - (degree.get(a.data.id) || 0)
        );
      byDegree.forEach((node) => addNode(node.data.path || node.data.id));
      const limitedEdges = edges.filter(
        (edge) => keep.has(edge.data.source) && keep.has(edge.data.target)
      );
      return {
        nodes: Array.from(limitedNodes.values()),
        edges: limitedEdges,
      };
    }

    return {
      nodes: Array.from(nodes.values()),
      edges,
    };
  }

  function buildFolderOverview(
    deps: Dependency[],
    filePaths: string[]
  ): GraphData {
    const nodes = new Map<string, GraphNode>();
    const edges: GraphEdge[] = [];
    const folders = new Set<string>();
    const fileSet = new Set(filePaths);
    const folderStats = new Map<string, { files: number; deps: number }>();
    const packageStats = new Map<string, number>();

    filePaths.forEach((path) => {
      const parts = path.split("/");
      for (let i = 1; i < parts.length; i++) {
        const folderPath = parts.slice(0, i).join("/");
        folders.add(folderPath);
      }
    });

    const rootFolderId = "folder_root";
    nodes.set("folder:/", {
      data: {
        id: rootFolderId,
        label: "/",
        displayLabel: "/",
        path: "/",
        type: "folder",
        size: 1,
        depth: 0,
      },
    });

    const sortedFolders = Array.from(folders).sort((a, b) => {
      const aDepth = a.split("/").length;
      const bDepth = b.split("/").length;
      return aDepth - bDepth;
    });

    sortedFolders.forEach((folderPath) => {
      const id = `folder_${folderPath.replace(/[^a-zA-Z0-9]/g, "_")}`;
      const label = folderPath.split("/").pop() || folderPath;
      const displayLabel = toDisplayLabel(label);
      const depth = folderPath.split("/").length;
      nodes.set(`folder:${folderPath}`, {
        data: {
          id,
          label,
          displayLabel,
          path: folderPath,
          type: "folder",
          size: 1,
          depth,
        },
      });
    });

    // Folder hierarchy edges (root -> folder -> subfolder)
    sortedFolders.forEach((folderPath) => {
      const id = `folder_${folderPath.replace(/[^a-zA-Z0-9]/g, "_")}`;
      const parentPath = folderPath.split("/").slice(0, -1).join("/");
      const parentId = parentPath
        ? `folder_${parentPath.replace(/[^a-zA-Z0-9]/g, "_")}`
        : rootFolderId;

      edges.push({
        data: {
          id: `${parentId}_${id}`,
          source: parentId,
          target: id,
          type: "folder",
          isExternal: false,
          weight: 1,
        },
      });
    });

    const folderIdForPath = (path: string) => {
      const parentPath = path.split("/").slice(0, -1).join("/");
      if (!parentPath) return rootFolderId;
      return `folder_${parentPath.replace(/[^a-zA-Z0-9]/g, "_")}`;
    };

    const edgeCounts = new Map<string, number>();
    const getPackageKey = (modulePath: string) => {
      if (modulePath.startsWith("@")) {
        const parts = modulePath.split("/");
        return parts.slice(0, 2).join("/");
      }
      return modulePath.split("/")[0] || modulePath;
    };

    filePaths.forEach((path) => {
      const parentPath = path.split("/").slice(0, -1).join("/");
      if (!parentPath) return;
      const stat = folderStats.get(parentPath) || { files: 0, deps: 0 };
      stat.files += 1;
      folderStats.set(parentPath, stat);
    });

    deps.forEach((dep) => {
      const fromFolderId = folderIdForPath(dep.from);
      const isInternal = fileSet.has(dep.to);
      const packageKey = getPackageKey(dep.to);
      const toFolderId = isInternal
        ? folderIdForPath(dep.to)
        : packageKey.replace(/[^a-zA-Z0-9]/g, "_");

      if (fromFolderId === toFolderId) {
        return;
      }

      if (!isInternal && !nodes.has(packageKey)) {
        const label = packageKey;
        const displayLabel = toDisplayLabel(label);
        nodes.set(packageKey, {
          data: {
            id: toFolderId,
            label,
            displayLabel,
            path: packageKey,
            type: "package",
            size: 1,
            depth: 99,
          },
        });
      }

      const edgeKey = `${fromFolderId}|${toFolderId}`;
      edgeCounts.set(edgeKey, (edgeCounts.get(edgeKey) || 0) + 1);

      if (!isInternal) {
        packageStats.set(packageKey, (packageStats.get(packageKey) || 0) + 1);
      } else {
        const targetPath = dep.to.split("/").slice(0, -1).join("/");
        if (targetPath) {
          const stat = folderStats.get(targetPath) || { files: 0, deps: 0 };
          stat.deps += 1;
          folderStats.set(targetPath, stat);
        }
      }
    });

    nodes.forEach((node, key) => {
      if (node.data.type === "folder") {
        const folderPath = key.startsWith("folder:")
          ? key.replace("folder:", "")
          : "";
        const stat = folderStats.get(folderPath) || { files: 0, deps: 0 };
        node.data.size = Math.max(1, stat.files + stat.deps);
      }
      if (node.data.type === "package") {
        const stat = packageStats.get(node.data.path || "") || 1;
        node.data.size = Math.max(1, stat);
      }
    });

    edgeCounts.forEach((weight, edgeKey) => {
      const [source, target] = edgeKey.split("|");
      if (!source || !target) return;
      edges.push({
        data: {
          id: edgeKey,
          source,
          target,
          type: "depends",
          isExternal: target.startsWith("folder_") ? false : true,
          weight,
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
        )}&includeSizes=1`
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

  // Search functionality - find matching nodes
  const matchingNodes = useMemo(() => {
    if (!searchQuery.trim() || !activeGraphData) return new Set<string>();
    const query = searchQuery.toLowerCase().trim();
    const matches = new Set<string>();
    activeGraphData.nodes.forEach((node) => {
      const label = (node.data.label || node.data.displayLabel || "").toLowerCase();
      const path = (node.data.path || node.data.filePath || "").toLowerCase();
      const folder = path.split("/").slice(0, -1).join("/").toLowerCase();
      if (
        label.includes(query) ||
        path.includes(query) ||
        folder.includes(query) ||
        node.data.id.toLowerCase().includes(query)
      ) {
        matches.add(node.data.id);
      }
    });
    return matches;
  }, [searchQuery, activeGraphData]);

  // Keep refs in sync with state (so tick handler always has latest values)
  useEffect(() => {
    searchQueryRef.current = searchQuery;
    highlightedNodeIdRef.current = highlightedNodeId;
    matchingNodesRef.current = matchingNodes;
  }, [searchQuery, highlightedNodeId, matchingNodes]);

  // Auto-select first match when search changes
  useEffect(() => {
    if (matchingNodes.size > 0 && !highlightedNodeId) {
      const firstMatch = Array.from(matchingNodes)[0];
      if (firstMatch) {
        setHighlightedNodeId(firstMatch);
        if (selectFileRef.current) {
          selectFileRef.current(firstMatch);
        }
      }
    } else if (matchingNodes.size === 0) {
      setHighlightedNodeId(null);
    }
  }, [matchingNodes, highlightedNodeId]);

  // Highlight search matches
  useEffect(() => {
    if (!nodesRef.current || !linksRef.current || !activeGraphData) return;
    
    import("d3").then((d3) => {
      const node = nodesRef.current;
      const link = linksRef.current;
      const COLORS = [
        "#4d9fff",
        "#a78bfa",
        "#22d3ee",
        "#00ff9d",
        "#ff9f43",
        "#ec4899",
        "#ff5f5f",
        "#84cc16",
      ];
      
      if (searchQuery.trim() && matchingNodes.size > 0) {
        // Highlight matching nodes
        node.selectAll(".nc")
          .transition()
          .duration(200)
          .attr("opacity", (d: any) => {
            if (matchingNodes.has(d.id)) return 1;
            if (highlightedNodeId === d.id) return 1;
            return 0.2;
          })
          .attr("fill", (d: any) => {
            if (highlightedNodeId === d.id) return "#ff5f5f"; // Red for selected
            if (matchingNodes.has(d.id)) return "#00ff9d"; // Green for matches
            if (d.type === "package") return "#f59e0b";
            if (d.type === "folder") return graphPalette.background;
            return d.color || COLORS[0];
          })
          .attr("stroke", (d: any) => {
            if (highlightedNodeId === d.id || matchingNodes.has(d.id)) return "#00ff9d";
            if (d.type === "package") return "#fbbf24";
            const color = d.color || COLORS[0];
            const c = d3.color(color);
            return c ? c.brighter(0.3).toString() : "#fff";
          })
          .attr("stroke-width", (d: any) => {
            if (highlightedNodeId === d.id || matchingNodes.has(d.id)) return 3;
            return 1.5;
          });
        
        // Highlight links to/from matching nodes
        link
          .transition()
          .duration(200)
          .attr("stroke-opacity", (d: any) => {
            const sourceId = typeof d.source === "object" ? d.source.id : d.source;
            const targetId = typeof d.target === "object" ? d.target.id : d.target;
            if (matchingNodes.has(sourceId) || matchingNodes.has(targetId)) return 0.8;
            return 0.15; // More visible greyish for non-highlighted
          })
          .attr("stroke", (d: any) => {
            const sourceId = typeof d.source === "object" ? d.source.id : d.source;
            const targetId = typeof d.target === "object" ? d.target.id : d.target;
            if (matchingNodes.has(sourceId) || matchingNodes.has(targetId)) return "#00ff9d"; // Green for highlighted
            return "#666666"; // More greyish for non-highlighted links
          });
        
        // Zoom to highlighted node if one is selected
        if (highlightedNodeId && svgRef.current && zoomRef.current && simRef.current) {
          const nodes = simRef.current.nodes() as any[];
          const highlightedNode = nodes.find((n: any) => n.id === highlightedNodeId);
          if (highlightedNode && highlightedNode.x != null && highlightedNode.y != null) {
            const width = svgRef.current?.clientWidth || 800;
            const height = svgRef.current?.clientHeight || 600;
            d3.select(svgRef.current)
              .transition()
              .duration(500)
              .call(
                zoomRef.current.transform as any,
                d3.zoomIdentity
                  .translate(width / 2 - highlightedNode.x * 1.5, height / 2 - highlightedNode.y * 1.5)
                  .scale(1.5)
              );
          }
        }
      } else {
        // Reset highlighting when search is cleared
        node.selectAll(".nc")
          .transition()
          .duration(200)
          .attr("opacity", 1)
          .attr("fill", (d: any) => {
            if (d.type === "package") return "#f59e0b";
            if (d.type === "folder") return graphPalette.background;
            return d.color || COLORS[0];
          })
          .attr("stroke", (d: any) => {
            if (d.type === "package") return "#fbbf24";
            const color = d.color || COLORS[0];
            const c = d3.color(color);
            return c ? c.brighter(0.3).toString() : "#fff";
          })
          .attr("stroke-width", 1.5);
        
        link
          .transition()
          .duration(200)
          .attr("stroke-opacity", 0.4)
          .attr("stroke", (() => {
            const theme = document.documentElement.classList.contains("light") ? "light" : "dark";
            return theme === "light" ? "#999999" : "#666666"; // More greyish
          })());
      }
    });
  }, [searchQuery, matchingNodes, highlightedNodeId, graphPalette, activeGraphData]);

  // Calculate stats for sidebar
  const totalFiles = activeGraphData?.nodes.filter(n => n.data.type === 'file').length || 0;
  const totalDependencies = activeGraphData?.edges.filter(e => e.data?.type !== 'folder').length || 0;
  const healthScore = totalFiles > 0 ? Math.min(100, Math.max(0, 100 - (totalDependencies / totalFiles * 10))) : 0;

  return (
    <div className="mt-4 w-full">
      <div className="flex bg-[#0f172a] overflow-hidden" style={{ height: 'calc(100vh - 200px)', minHeight: '600px' }}>
      {/* Left Sidebar - CodeFlow style - Always visible */}
      <div 
        className="flex-shrink-0 bg-[#1a1f2e] border-r border-[#383B42] flex flex-col overflow-hidden"
        style={{ width: `${sidebarWidth}px`, minWidth: `${sidebarWidth}px` }}
      >
        {/* Sidebar Header */}
        <div className="p-4 border-b border-[#383B42]">
          <div className="flex items-center gap-2 mb-4">
            <GitBranch className="h-5 w-5 text-orange-500" />
            <h2 className="text-lg font-semibold text-gray-200">Dependencies</h2>
        </div>
          
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
            <input
              type="text"
              placeholder="Search files..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setHighlightedNodeId(null);
              }}
              className="w-full pl-9 pr-9 py-2 text-sm bg-[#0f172a] border border-[#383B42] rounded-md text-gray-200 placeholder-gray-500 focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
            />
            {searchQuery && (
              <button
                onClick={() => {
                  setSearchQuery("");
                  setHighlightedNodeId(null);
                }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          {matchingNodes.size > 0 && (
            <div className="mt-2 text-xs text-gray-500">
              {matchingNodes.size} match{matchingNodes.size !== 1 ? 'es' : ''}
            </div>
          )}
      </div>

        {/* Health Score */}
        <div className="p-4 border-b border-[#383B42]">
          <div className="text-xs text-gray-500 uppercase tracking-wider mb-2">Health Score</div>
          <div className="flex items-end gap-3">
            <div className="text-4xl font-bold text-orange-500">{Math.round(healthScore)}</div>
            <div className="text-sm text-gray-400 mb-1">/ 100</div>
          </div>
          <div className="mt-3 h-2 bg-[#0f172a] rounded-full overflow-hidden">
            <div 
              className="h-full bg-gradient-to-r from-orange-500 to-orange-400 transition-all duration-500"
              style={{ width: `${healthScore}%` }}
            />
          </div>
        </div>

        {/* Stats Grid */}
        <div className="p-4 border-b border-[#383B42] grid grid-cols-2 gap-3">
          <div className="bg-[#0f172a] rounded-lg p-3">
            <div className="text-xs text-gray-500 mb-1">Files</div>
            <div className="text-2xl font-semibold text-gray-200">{totalFiles}</div>
          </div>
          <div className="bg-[#0f172a] rounded-lg p-3">
            <div className="text-xs text-gray-500 mb-1">Dependencies</div>
            <div className="text-2xl font-semibold text-gray-200">{totalDependencies}</div>
          </div>
        </div>

        {/* View Mode Toggle */}
        <div className="p-4 border-b border-[#383B42]">
          <div className="text-xs text-gray-500 uppercase tracking-wider mb-3">View Mode</div>
          <div className="space-y-2">
            <button
              onClick={() => setViewMode("file")}
              disabled={!folderGraphData}
              className={`w-full text-left px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                viewMode === "file"
                  ? 'bg-orange-500/20 text-orange-400 border border-orange-500/50'
                  : 'bg-[#0f172a] text-gray-400 border border-transparent hover:bg-[#1e293b] hover:text-gray-300 disabled:opacity-50'
              }`}
            >
              File dependencies
            </button>
            <button
              onClick={() => setViewMode("folder")}
              disabled={!folderGraphData}
              className={`w-full text-left px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                viewMode === "folder"
                  ? 'bg-orange-500/20 text-orange-400 border border-orange-500/50'
                  : 'bg-[#0f172a] text-gray-400 border border-transparent hover:bg-[#1e293b] hover:text-gray-300 disabled:opacity-50'
              }`}
            >
              Folder view
            </button>
          </div>
        </div>

        {/* External Toggle */}
        <div className="p-4 border-b border-[#383B42]">
          <div className="text-xs text-gray-500 uppercase tracking-wider mb-3">External Dependencies</div>
          <button
            onClick={() => setShowExternal((prev) => !prev)}
            disabled={!activeGraphData}
            className={`w-full text-left px-3 py-2 rounded-md text-sm font-medium transition-colors ${
              showExternal
                ? 'bg-orange-500/20 text-orange-400 border border-orange-500/50'
                : 'bg-[#0f172a] text-gray-400 border border-transparent hover:bg-[#1e293b] hover:text-gray-300 disabled:opacity-50'
            }`}
          >
            {showExternal ? "External on" : "External off"}
          </button>
        </div>

        {/* Color Mode Selector */}
        <div className="p-4 border-b border-[#383B42]">
          <div className="text-xs text-gray-500 uppercase tracking-wider mb-3">Color By</div>
          <div className="space-y-2">
            {(['folder', 'layer', 'churn'] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setColorMode(mode)}
                className={`w-full text-left px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  colorMode === mode
                    ? 'bg-orange-500/20 text-orange-400 border border-orange-500/50'
                    : 'bg-[#0f172a] text-gray-400 border border-transparent hover:bg-[#1e293b] hover:text-gray-300'
                }`}
              >
                {mode.charAt(0).toUpperCase() + mode.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* File Browser - CodeFlow style - Always use graphData (file dependencies) */}
        {graphData && graphData.nodes.length > 0 && (
          <div className="flex-1 overflow-y-auto p-4 border-b border-[#383B42]">
            <div className="text-xs text-gray-500 uppercase tracking-wider mb-3">Files</div>
            <FileTree
              nodes={graphData.nodes.filter(n => n.data.type === 'file' || n.data.type === 'package')}
              onSelectFile={(id) => {
                if (selectFileRef.current) {
                  selectFileRef.current(id);
                  setHighlightedNodeId(id);
                }
              }}
              selectedId={highlightedNodeId || focusedNodeId}
            />
          </div>
        )}

        {/* Status */}
        <div className="flex-1 overflow-y-auto p-4">
          <div className="text-xs text-gray-500 uppercase tracking-wider mb-3">Status</div>
      {status && (
            <div className="text-xs text-gray-400 bg-[#0f172a] rounded-lg p-3 mb-3">
          {status}
        </div>
      )}
      {error && (
            <div className="bg-red-900/20 border border-red-500/50 rounded-md p-3 flex items-start gap-2 text-red-400 text-xs">
              <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}
          {loading && !activeGraphData && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-orange-500" />
        </div>
      )}
        </div>
      </div>

      {/* Center Canvas */}
      <div className="flex-1 flex flex-col overflow-hidden relative bg-[#0f172a]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(245,158,11,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(245,158,11,0.08) 1px, transparent 1px)",
          backgroundSize: "24px 24px",
        }}
      >
        {/* SVG Canvas - Clean, no toolbar buttons */}
        {activeGraphData && activeGraphData.nodes.length > 0 && (
          <svg
            ref={svgRef}
            className="w-full h-full cursor-grab active:cursor-grabbing"
          />
        )}

        {/* Zoom Controls - absolutely positioned on canvas */}
        {activeGraphData && activeGraphData.nodes.length > 0 && (
          <div className="absolute bottom-4 right-4 flex flex-col gap-2 z-20">
            <Button
              variant="outline"
              size="sm"
              className="bg-[#1a1f2e]/90 backdrop-blur-sm border-[#383B42] hover:bg-[#22262C] hover:border-orange-500/50 h-9 w-9 p-0"
              onClick={() => {
                if (!svgRef.current || !zoomRef.current) return;
                import("d3").then((d3) => {
                  const zoom = zoomRef.current;
                  const center = [svgRef.current!.clientWidth / 2, svgRef.current!.clientHeight / 2];
                  d3.select(svgRef.current)
                    .transition()
                    .duration(200)
                    .call(zoom.scaleBy as any, 1.4, center);
                });
              }}
              title="Zoom In"
            >
              <ZoomIn className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="bg-[#1a1f2e]/90 backdrop-blur-sm border-[#383B42] hover:bg-[#22262C] hover:border-orange-500/50 h-9 w-9 p-0"
              onClick={() => {
                if (!svgRef.current || !zoomRef.current) return;
                import("d3").then((d3) => {
                  const zoom = zoomRef.current;
                  const center = [svgRef.current!.clientWidth / 2, svgRef.current!.clientHeight / 2];
                  d3.select(svgRef.current)
                    .transition()
                    .duration(200)
                    .call(zoom.scaleBy as any, 0.7, center);
                });
              }}
              title="Zoom Out"
            >
              <ZoomOut className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="bg-[#1a1f2e]/90 backdrop-blur-sm border-[#383B42] hover:bg-[#22262C] hover:border-orange-500/50 h-9 w-9 p-0"
              onClick={() => {
                if (!svgRef.current || !zoomRef.current || !simRef.current) return;
                import("d3").then((d3) => {
                  const zoom = zoomRef.current;
                  const sim = simRef.current;
                  if (zoom && sim) {
                    const nodes = sim.nodes() as any[];
                    if (!nodes.length) return;
                    const xs = nodes.map((n: any) => n.x).filter((x: any) => x != null && isFinite(x));
                    const ys = nodes.map((n: any) => n.y).filter((y: any) => y != null && isFinite(y));
                    if (xs.length === 0 || ys.length === 0) return;
                    const minX = Math.min(...xs);
                    const maxX = Math.max(...xs);
                    const minY = Math.min(...ys);
                    const maxY = Math.max(...ys);
                    if (!svgRef.current) return;
                    const w = svgRef.current.clientWidth;
                    const h = svgRef.current.clientHeight;
                    const pad = 60;
                    const scale = 0.8 / Math.max((maxX - minX + pad * 2) / w, (maxY - minY + pad * 2) / h);
                    d3.select(svgRef.current)
                      .transition()
                      .duration(400)
                      .call(
                        zoom.transform as any,
                        d3.zoomIdentity
                          .translate(w / 2 - scale * (minX + maxX) / 2, h / 2 - scale * (minY + maxY) / 2)
                          .scale(Math.min(scale, 2))
                      );
                  }
                });
              }}
              title="Fit to View"
            >
              <Maximize2 className="h-4 w-4" />
            </Button>
          </div>
        )}

        {/* Info Notice - only when no dependencies in file view */}
        {viewMode === "file" && activeGraphData && activeGraphData.nodes.length > 0 &&
          activeGraphData.edges.filter((e: any) => e.data?.type !== "folder").length === 0 && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-[#1a1f2e]/95 backdrop-blur-sm border border-[#383B42] rounded-md px-4 py-2 text-xs text-gray-400 max-w-md z-10">
              <p>
                💡 Showing folder structure. No dependencies found between files.
                </p>
              </div>
            )}

        {/* Empty state */}
        {!loading && !error && filesFetched && !activeGraphData && dependencies.length === 0 && (
          <div className="flex items-center justify-center h-full text-gray-500">
            <div className="text-center">
              <GitBranch className="h-16 w-16 mx-auto mb-4 opacity-30" />
              <p className="text-sm">No dependencies found in this repository</p>
            </div>
        </div>
      )}
      </div>

      {/* Right Panel - CodeFlow style - Always visible */}
      <div 
        className="flex-shrink-0 bg-[#1a1f2e] border-l border-[#383B42] flex flex-col overflow-hidden"
        style={{ width: `${rightPanelWidth}px`, minWidth: `${rightPanelWidth}px` }}
      >
        {/* Tab Header */}
        <div className="flex border-b border-[#383B42]">
          {(['details', 'functions', 'connections'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setRightTab(tab)}
              className={`flex-1 px-4 py-3 text-xs font-medium uppercase tracking-wider transition-colors ${
                rightTab === tab
                  ? 'text-orange-400 bg-[#0f172a] border-b-2 border-orange-500'
                  : 'text-gray-500 hover:text-gray-300 hover:bg-[#1e293b]'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {rightTab === 'details' && (
            <div className="space-y-4">
              <div>
                <h3 className="text-xs font-semibold text-gray-400 uppercase mb-3 tracking-wider">Graph Info</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-500">Total Files:</span>
                    <span className="text-gray-200 font-mono">{totalFiles}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Dependencies:</span>
                    <span className="text-gray-200 font-mono">{totalDependencies}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Avg per File:</span>
                    <span className="text-gray-200 font-mono">
                      {totalFiles > 0 ? (totalDependencies / totalFiles).toFixed(1) : '0'}
                    </span>
                  </div>
                </div>
              </div>

              {focusedNodeId && activeGraphData && (
                <div className="pt-4 border-t border-[#383B42]">
                  <h3 className="text-xs font-semibold text-gray-400 uppercase mb-3 tracking-wider">Selected Node</h3>
                  <div className="space-y-2 text-sm">
                    <div>
                      <span className="text-gray-500 text-xs">ID:</span>
                      <p className="text-gray-200 font-mono text-xs mt-1 break-all">{focusedNodeId}</p>
                    </div>
                    {blastRadius && (
                      <div>
                        <span className="text-gray-500 text-xs">Blast Radius:</span>
                        <p className="text-orange-400 font-mono text-sm mt-1">{blastRadius.affected.length} files</p>
                      </div>
                    )}
                  </div>
        </div>
      )}

              {/* Graph Config Panel - moved to sidebar */}
              {activeGraphData && (
                <div className="pt-4 border-t border-[#383B42]">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Config</h3>
                    <button
                      onClick={() => setShowGraphConfig(!showGraphConfig)}
                      className="text-gray-500 hover:text-gray-300 transition-colors"
                    >
                      <Settings className="h-4 w-4" />
                    </button>
                  </div>
                  {showGraphConfig && (
                    <div className="space-y-4">
                      {/* Layout */}
                      <div>
                        <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2 tracking-wider">Layout</h4>
                        <div className="flex flex-wrap gap-2">
                          {(["force", "radial", "hierarchical", "grid", "metro"] as const).map((mode) => (
                            <button
                              key={mode}
                              onClick={() => setGraphConfig({ ...graphConfig, viewMode: mode })}
                              className={`px-2 py-1 text-xs font-mono rounded border transition-colors ${
                                graphConfig.viewMode === mode
                                  ? 'bg-orange-500/20 text-orange-400 border-orange-500/50'
                                  : 'bg-[#0f172a] text-gray-400 border-[#383B42] hover:bg-[#1e293b] hover:text-gray-300'
                              }`}
                            >
                              {mode.charAt(0).toUpperCase() + mode.slice(1)}
                            </button>
                          ))}
                        </div>
                      </div>
                      
                      {/* Spacing */}
                      <div>
                        <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2 tracking-wider">Spacing</h4>
                        <div className="space-y-3">
                          <div className="flex items-center gap-3">
                            <label className="text-xs text-gray-400 w-12 font-mono">Spread:</label>
                    <input
                      type="range"
                      min="50"
                      max="1000"
                      step="25"
                      value={graphConfig.spacing}
                              onChange={(e) =>
                                setGraphConfig({ ...graphConfig, spacing: parseInt(e.target.value) })
                              }
                              className="flex-1 h-2 bg-[#0f172a] rounded-lg appearance-none cursor-pointer accent-orange-500"
                            />
                            <span className="text-xs text-gray-400 w-10 font-mono text-right">{graphConfig.spacing}</span>
                          </div>
                          <div className="flex items-center gap-3">
                            <label className="text-xs text-gray-400 w-12 font-mono">Links:</label>
                            <input
                              type="range"
                              min="30"
                              max="200"
                              step="5"
                              value={graphConfig.linkDist}
                              onChange={(e) =>
                                setGraphConfig({ ...graphConfig, linkDist: parseInt(e.target.value) })
                              }
                              className="flex-1 h-2 bg-[#0f172a] rounded-lg appearance-none cursor-pointer accent-orange-500"
                            />
                            <span className="text-xs text-gray-400 w-10 font-mono text-right">{graphConfig.linkDist}</span>
                          </div>
                        </div>
                      </div>
                      
                      {/* Display */}
                      <div>
                        <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2 tracking-wider">Display</h4>
                        <div className="space-y-2">
                          <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer hover:text-gray-200">
                            <input
                              type="checkbox"
                              checked={graphConfig.showLabels}
                              onChange={(e) =>
                                setGraphConfig({ ...graphConfig, showLabels: e.target.checked })
                              }
                              className="w-4 h-4 rounded border-[#383B42] bg-[#0f172a] text-orange-500 focus:ring-orange-500 focus:ring-2 cursor-pointer"
                            />
                            <span className="font-mono text-xs">Show labels</span>
                          </label>
                          <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer hover:text-gray-200">
                            <input
                              type="checkbox"
                              checked={graphConfig.curvedLinks}
                              onChange={(e) =>
                                setGraphConfig({ ...graphConfig, curvedLinks: e.target.checked })
                              }
                              className="w-4 h-4 rounded border-[#383B42] bg-[#0f172a] text-orange-500 focus:ring-orange-500 focus:ring-2 cursor-pointer"
                            />
                            <span className="font-mono text-xs">Curved links</span>
                          </label>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {rightTab === 'functions' && (
            <div className="space-y-4">
              <div className="text-sm text-gray-500">
                <p>Function analysis coming soon...</p>
              </div>
            </div>
          )}

          {rightTab === 'connections' && (
            <div className="space-y-4">
              {dependencies.length > 0 ? (
                <>
                  <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                    All Dependencies ({dependencies.length})
          </h3>
                  <div className="space-y-2">
                    {dependencies.slice(0, 100).map((dep, idx) => (
                      <div key={idx} className="text-xs bg-[#0f172a] rounded p-2">
                        <div className="text-orange-400 font-mono break-all">{dep.from}</div>
                        <div className="text-gray-500 my-1">↓</div>
                        <div className="text-blue-400 font-mono break-all">{dep.to}</div>
                  {dep.line && (
                          <div className="text-gray-600 text-[10px] mt-1">
                            Line {dep.line}
                          </div>
                        )}
                      </div>
                    ))}
                    {dependencies.length > 100 && (
                      <div className="text-xs text-gray-500 italic text-center pt-2">
                        ... and {dependencies.length - 100} more
                      </div>
                    )}
          </div>
                </>
              ) : (
                <div className="text-sm text-gray-500">
                  <p>No dependencies found</p>
        </div>
      )}
            </div>
          )}
        </div>
      </div>
    </div>
    </div>
  );
}
