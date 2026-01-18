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
    spacing: 500, // Maximum spread for better visualization
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

  const activeGraphData = viewMode === "folder" ? folderGraphData : graphData;
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
        const folder = path.split("/").slice(0, -1).join("/") || "root";
        folders.add(folder);

        // CodeFlow-style: Node radius based on function count (we'll use size as proxy)
        const base = node.data.type === "package" ? 10 : 8;
        const radius = Math.max(8, Math.min(24, 5 + Math.sqrt(size) * 0.8));
        
        return {
          id: node.data.id,
          label: node.data.displayLabel || node.data.label,
          name: node.data.displayLabel || node.data.label,
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
      const getC = (d: any) => {
        // CodeFlow-style: Color by folder
        return d.color || COLORS[Array.from(folders).indexOf(d.folder) % COLORS.length] || COLORS[0];
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
          const n = d.name.replace(/\.[^.]+$/, "");
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
          const fullName = d.name.replace(/\.[^.]+$/, "");
          const displayName = d.name;
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
          .force("charge", d3.forceManyBody().strength(-config.spacing * 1.5).distanceMax(400))
          .force("collision", d3.forceCollide().radius((d: any) => getR(d) + 20).iterations(3))
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
          .force("charge", d3.forceManyBody().strength(-config.spacing * 0.5))
          .force("collision", d3.forceCollide().radius((d: any) => getR(d) + 20).iterations(3))
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
          .force("charge", d3.forceManyBody().strength(-config.spacing * 0.8).distanceMax(200))
          .force("collision", d3.forceCollide().radius((d: any) => getR(d) + 20).iterations(3))
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
          .force("charge", d3.forceManyBody().strength(-config.spacing * 0.3))
          .force("collision", d3.forceCollide().radius((d: any) => getR(d) + 20).iterations(3))
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
          .force("link", d3.forceLink(links as any).id((d: any) => d.id).distance(config.linkDist).strength(0.05))
          .force("charge", d3.forceManyBody().strength(-config.spacing * 0.4))
          .force("collision", d3.forceCollide().radius((d: any) => getR(d) + 20).iterations(3))
          .force("x", d3.forceX((d: any) => (d as any).targetX || width / 2).strength(0.95))
          .force("y", d3.forceY((d: any) => (d as any).targetY || height / 2).strength(0.95))
          .force("boundary", () => {
            nodes.forEach(boundaryForce);
          });
      }
      
      // Update forces when spacing/linkDist change - use graphConfigRef for latest values
      const linkForce = simulation.force("link") as any;
      if (linkForce) {
        linkForce.distance(config.linkDist);
      }
      const chargeForce = simulation.force("charge") as any;
      if (chargeForce) {
        // Update charge strength based on view mode
        if (config.viewMode === "force") {
          chargeForce.strength(-config.spacing * 1.5);
        } else if (config.viewMode === "radial") {
          chargeForce.strength(-config.spacing * 0.5);
        } else if (config.viewMode === "hierarchical") {
          chargeForce.strength(-config.spacing * 0.8);
        } else if (config.viewMode === "grid") {
          chargeForce.strength(-config.spacing * 0.3);
        } else if (config.viewMode === "metro") {
          chargeForce.strength(-config.spacing * 0.4);
        }
      }
      
      // Always restart simulation when config changes to apply new forces
      simulation
        .velocityDecay(0.6)
        .alphaDecay(0.05)
        .alpha(1) // Full alpha when view mode or config changes - restart simulation
        .restart();
      
      // Attach drag handlers with highlighting and dependent node movement
      node.call(
        d3
          .drag<SVGGElement, any>()
          .on("start", (event, d) => {
            if (!event.active && simulation) simulation.alphaTarget(0.1).restart();
            
            // Store initial position
            dragStateRef.current.draggedNodeId = d.id;
            dragStateRef.current.initialX = d.x || 0;
            dragStateRef.current.initialY = d.y || 0;
            
            d.fx = d.x;
            d.fy = d.y;
            
            // Find all dependent nodes (nodes this node connects to)
            const affected = new Set<string>();
            links.forEach((l: any) => {
              const sourceId = typeof l.source === "object" ? l.source.id : l.source;
              const targetId = typeof l.target === "object" ? l.target.id : l.target;
              if (sourceId === d.id) {
                affected.add(targetId);
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
            dragStateRef.current.dependents = affected;
            dragStateRef.current.dependencies = dependencies;
            
            // Combine all related nodes
            const allRelated = new Set([...affected, ...dependencies]);
            
            // Update visual highlighting - highlight all nodes using nodeLayer
            // Select all node groups, then update their circles
            nodeLayer.selectAll("g.node").each(function(n: any) {
              const nodeGroup = d3.select(this);
              const circle = nodeGroup.select("circle.nc");
              const isSelected = n.id === d.id;
              const isRelated = allRelated.has(n.id);
              
              circle
                .attr("opacity", isSelected ? 1 : isRelated ? 0.8 : 0.2)
                .attr("fill", isSelected ? "#ff5f5f" : isRelated ? "#ff9f43" : getC(n))
                .attr("stroke-width", isSelected ? 3 : isRelated ? 2.5 : 1.5)
                .attr("stroke", isSelected ? "#ff5f5f" : isRelated ? "#ff9f43" : (() => {
                  const c = d3.color(getC(n));
                  return c ? c.brighter(0.3).toString() : "#fff";
                })());
            });
            
            // Highlight links connecting to/from this node
            linkLayer.selectAll("path").each(function(l: any) {
              const path = d3.select(this);
              const sourceId = typeof l.source === "object" ? l.source.id : l.source;
              const targetId = typeof l.target === "object" ? l.target.id : l.target;
              const theme = document.documentElement.classList.contains("light") ? "light" : "dark";
              const isConnected = sourceId === d.id || targetId === d.id;
              const isRelatedLink = allRelated.has(sourceId) && allRelated.has(targetId);
              
              path
                .attr("stroke-opacity", isConnected ? 0.95 : isRelatedLink ? 0.7 : 0.15)
                .attr("stroke", isConnected ? "#ff5f5f" : isRelatedLink ? "#ff9f43" : (theme === "light" ? "#ccc" : "#333"))
                .attr("stroke-width", isConnected ? 3 : isRelatedLink ? 2 : Math.max(1, Math.min(2, Math.sqrt((l.count || 1)) * 0.3)));
            });
          })
          .on("drag", (event, d) => {
            d.fx = event.x;
            d.fy = event.y;
            
            // Calculate movement vector from initial position
            const dx = event.x - dragStateRef.current.initialX;
            const dy = event.y - dragStateRef.current.initialY;
            
            // Move dependent nodes in the same direction and orbit around dragged node
            nodes.forEach((n: any) => {
              if (n.id === d.id) return; // Skip the dragged node itself
              
              const isDependent = dragStateRef.current.dependents.has(n.id);
              const isDependency = dragStateRef.current.dependencies.has(n.id);
              
              if (isDependent || isDependency) {
                // Get the node's position relative to the initial dragged node position
                const initialRelX = (n.x || 0) - dragStateRef.current.initialX;
                const initialRelY = (n.y || 0) - dragStateRef.current.initialY;
                const initialRelDistance = Math.sqrt(initialRelX * initialRelX + initialRelY * initialRelY);
                
                // Calculate target position: follow the dragged node's movement while maintaining relative position
                // Use a follow strength to make them move smoothly
                const followStrength = 0.7; // How much to follow (0-1)
                const orbitRadius = Math.max(100, initialRelDistance); // Maintain orbit distance
                
                // Normalize the relative vector
                const normX = initialRelDistance > 0 ? initialRelX / initialRelDistance : 0;
                const normY = initialRelDistance > 0 ? initialRelY / initialRelDistance : 0;
                
                // Calculate target position: dragged node position + relative offset
                const targetX = event.x + normX * orbitRadius * followStrength;
                const targetY = event.y + normY * orbitRadius * followStrength;
                
                // Apply velocity to move towards target (smooth following)
                const currentX = n.x || 0;
                const currentY = n.y || 0;
                const deltaX = targetX - currentX;
                const deltaY = targetY - currentY;
                
                // Apply velocity with damping for smooth movement
                n.vx = (n.vx || 0) * 0.4 + deltaX * 0.2;
                n.vy = (n.vy || 0) * 0.4 + deltaY * 0.2;
              }
            });
            
            // Restart simulation to apply velocities
            if (simulation) {
              simulation.alphaTarget(0.3).restart();
            }
            
            // Keep highlighting during drag
          })
          .on("end", (event, d) => {
            if (!event.active && simulation) simulation.alphaTarget(0);
            d.fx = null;
            d.fy = null;
            
            // Release dependent nodes (let them settle naturally)
            nodes.forEach((n: any) => {
              if (dragStateRef.current.dependents.has(n.id) || dragStateRef.current.dependencies.has(n.id)) {
                // Remove any fixed positions to let them settle
                if (n.fx != null || n.fy != null) {
                  n.fx = null;
                  n.fy = null;
                }
              }
            });
            
            // Reset drag state
            dragStateRef.current.draggedNodeId = null;
            dragStateRef.current.dependents.clear();
            dragStateRef.current.dependencies.clear();
            
            // Reset highlighting
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
                .attr("stroke", theme === "light" ? "#ccc" : "#333")
                .attr("stroke-width", Math.max(1, Math.min(2, Math.sqrt((l.count || 1)) * 0.3)));
            });
          }) as any
      );
      
      // Attach click handlers to all nodes (existing + new)
      node.on("click", (e, d) => {
        e.stopPropagation();
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
        if (config.curvedLinks) {
          link.attr("d", (d: any) => {
            const source = typeof d.source === "object" ? d.source : d.source;
            const target = typeof d.target === "object" ? d.target : d.target;
            if (!source || !target || source.x == null || source.y == null || target.x == null || target.y == null) {
              return "M0,0L0,0";
            }
            const dx = target.x - source.x;
            const dy = target.y - source.y;
            const dr = Math.sqrt(dx * dx + dy * dy);
            return `M${source.x},${source.y}A${dr},${dr} 0 0,1 ${target.x},${target.y}`;
              });
            } else {
          link.attr("d", (d: any) => {
            const source = typeof d.source === "object" ? d.source : d.source;
            const target = typeof d.target === "object" ? d.target : d.target;
            if (!source || !target || source.x == null || source.y == null || target.x == null || target.y == null) {
              return "M0,0L0,0";
            }
            return `M${source.x},${source.y}L${target.x},${target.y}`;
          });
        }
        
        // Preserve search highlighting in tick handler (so it persists during zoom/pan)
        if (hasSearch) {
          link.each(function(l: any) {
            const path = d3.select(this);
            const sourceId = typeof l.source === "object" ? l.source.id : l.source;
            const targetId = typeof l.target === "object" ? l.target.id : l.target;
            const isHighlighted = currentMatchingNodes.has(sourceId) || currentMatchingNodes.has(targetId);
            
            // Green for highlighted links, greyish for others
            path
              .attr("stroke", isHighlighted ? "#00ff9d" : "#666666") // More greyish for non-highlighted
              .attr("stroke-opacity", isHighlighted ? 0.8 : 0.15); // Dimmer for non-highlighted
          });
        } else {
          // Default link styling when no search - more greyish
          const theme = document.documentElement.classList.contains("light") ? "light" : "dark";
          link.attr("stroke", theme === "light" ? "#999999" : "#666666") // More greyish
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
        
        // Preserve search highlighting for nodes in tick handler (so it persists during zoom/pan)
        if (hasSearch) {
          node.selectAll("circle.nc").each(function(n: any) {
            const circle = d3.select(this);
            const isMatch = currentMatchingNodes.has(n.id);
            const isHighlighted = currentHighlightedNodeId === n.id;
            
            circle
              .attr("opacity", isMatch || isHighlighted ? 1 : 0.2)
              .attr("fill", isHighlighted ? "#ff5f5f" : isMatch ? "#00ff9d" : getC(n))
              .attr("stroke", isMatch || isHighlighted ? "#00ff9d" : (() => {
                const c = d3.color(getC(n));
                return c ? c.brighter(0.3).toString() : "#fff";
              })())
              .attr("stroke-width", isMatch || isHighlighted ? 3 : 1.5);
          });
        } else {
          // Default node styling when no search
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

      // CodeFlow-style: Update hulls (folder groupings)
      const updateHulls = () => {
        // Hide folder hulls in dependency view - only show in folder view
        hullLayer.selectAll("*").remove();
        if (viewMode === "folder") {
          folderList.forEach((folder) => {
          const folderNodes = nodes.filter((n) => n.folder === folder);
          if (folderNodes.length < 1) return;
          const pad = 30;
          const pts: [number, number][] = [];
          folderNodes.forEach((n: any) => {
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
            const color =
              COLORS[folderList.indexOf(folder) % COLORS.length] ||
              COLORS[0] ||
              "#4d9fff";
            hullLayer
              .append("path")
              .attr("d", "M" + hull.join("L") + "Z")
              .attr("fill", color)
              .attr("fill-opacity", 0.04)
              .attr("stroke", color)
              .attr("stroke-width", 2)
              .attr("stroke-opacity", 0.25);
            const cx = d3.mean(folderNodes, (n: any) => n.x) || 0;
            const cy = (d3.min(folderNodes, (n: any) => n.y) || 0) - pad - 8;
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
        // In dependency view, hulls are hidden
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
          setFocusedNodeId(null);
          setBlastRadius(null);
          const theme = document.documentElement.classList.contains("light") ? "light" : "dark";
          link.attr("stroke", theme === "light" ? "#ccc" : "#333").attr("stroke-opacity", 0.4);
          node
            .selectAll(".nc")
            .attr("opacity", 1)
            .attr("fill", getC);
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
        const label = packageKey;
        const displayLabel = toDisplayLabel(label);
        nodes.set(toKey, {
          data: {
            id: toId,
            label,
            displayLabel,
            path: toKey,
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

  return (
    <div className="mt-4 w-screen max-w-none relative left-1/2 right-1/2 -translate-x-1/2 px-3 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <GitBranch className="h-5 w-5 text-purple-500" />
          <h2 className="text-xl font-semibold">Dependency Graph</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Search Input - CodeFlow style */}
          <div className="relative flex items-center">
            <Search className="absolute left-2 h-4 w-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search files/folders..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setHighlightedNodeId(null);
              }}
              className="pl-8 pr-8 py-1.5 text-sm bg-[#1e293b] border border-[#383B42] rounded-md text-gray-200 placeholder-gray-500 focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500 w-48"
            />
            {searchQuery && (
              <button
                onClick={() => {
                  setSearchQuery("");
                  setHighlightedNodeId(null);
                }}
                className="absolute right-2 text-gray-400 hover:text-gray-200"
              >
                <X className="h-4 w-4" />
              </button>
            )}
            {matchingNodes.size > 0 && (
              <span className="absolute -right-8 text-xs text-gray-400">
                {matchingNodes.size}
              </span>
            )}
        </div>
        <Button
            onClick={() => {
              // Toggle folder view - if already in folder view, switch to file view (dependencies)
              setViewMode(viewMode === "folder" ? "file" : "folder");
            }}
            disabled={!folderGraphData}
            variant={viewMode === "folder" ? "default" : "outline"}
          size="sm"
        >
            {viewMode === "folder" ? "Folder view" : "Dependencies"}
          </Button>
          <Button
            onClick={() => setViewMode("file")}
            disabled={!graphData}
            variant={viewMode === "file" ? "default" : "outline"}
            size="sm"
          >
            File dependencies
          </Button>
          <Button
            onClick={() => setShowExternal((prev) => !prev)}
            disabled={!activeGraphData}
            variant={showExternal ? "default" : "outline"}
            size="sm"
          >
            {showExternal ? "External on" : "External off"}
          </Button>
          <Button
            onClick={() => setShowGraphConfig(!showGraphConfig)}
            variant={showGraphConfig ? "default" : "outline"}
            size="sm"
          >
            <Settings className="h-4 w-4 mr-2" />
            Config
        </Button>
        </div>
      </div>

      {/* CodeFlow-style Graph Config Panel */}
      {showGraphConfig && (
        <div className="mb-4 p-4 bg-[#1e293b] border border-[#383B42] rounded-md">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <h4 className="text-xs font-semibold text-gray-400 uppercase mb-2 tracking-wider">Layout</h4>
              <div className="flex flex-wrap gap-2">
                {(["force", "radial", "hierarchical", "grid", "metro"] as const).map((mode) => (
                  <Button
                    key={mode}
                    onClick={() => setGraphConfig({ ...graphConfig, viewMode: mode })}
                    variant={graphConfig.viewMode === mode ? "default" : "outline"}
                    size="sm"
                    className="text-xs font-mono"
                  >
                    {mode.charAt(0).toUpperCase() + mode.slice(1)}
                  </Button>
                ))}
              </div>
            </div>
            <div>
              <h4 className="text-xs font-semibold text-gray-400 uppercase mb-2 tracking-wider">Spacing</h4>
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <label className="text-xs text-gray-300 w-16 font-mono">Spread:</label>
                  <input
                    type="range"
                    min="50"
                    max="500"
                    step="10"
                    value={graphConfig.spacing}
                    onChange={(e) =>
                      setGraphConfig({ ...graphConfig, spacing: parseInt(e.target.value) })
                    }
                    className="flex-1 h-2 bg-[#0f172a] rounded-lg appearance-none cursor-pointer accent-orange-500"
                  />
                  <span className="text-xs text-gray-400 w-12 font-mono text-right">{graphConfig.spacing}</span>
                </div>
                <div className="flex items-center gap-3">
                  <label className="text-xs text-gray-300 w-16 font-mono">Links:</label>
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
                  <span className="text-xs text-gray-400 w-12 font-mono text-right">{graphConfig.linkDist}</span>
                </div>
              </div>
            </div>
            <div>
              <h4 className="text-xs font-semibold text-gray-400 uppercase mb-2 tracking-wider">Display</h4>
              <div className="space-y-3">
                <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer hover:text-gray-200">
                  <input
                    type="checkbox"
                    checked={graphConfig.showLabels}
                    onChange={(e) =>
                      setGraphConfig({ ...graphConfig, showLabels: e.target.checked })
                    }
                    className="w-4 h-4 rounded border-[#383B42] bg-[#0f172a] text-orange-500 focus:ring-orange-500 focus:ring-2 cursor-pointer"
                  />
                  <span className="font-mono">Show labels</span>
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer hover:text-gray-200">
                  <input
                    type="checkbox"
                    checked={graphConfig.curvedLinks}
                    onChange={(e) =>
                      setGraphConfig({ ...graphConfig, curvedLinks: e.target.checked })
                    }
                    className="w-4 h-4 rounded border-[#383B42] bg-[#0f172a] text-orange-500 focus:ring-orange-500 focus:ring-2 cursor-pointer"
                  />
                  <span className="font-mono">Curved links</span>
                </label>
              </div>
            </div>
          </div>
        </div>
      )}

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

      {loading && !activeGraphData && (
        <div className="flex items-center justify-center h-96">
          <Loader2 className="h-8 w-8 animate-spin text-purple-500" />
        </div>
      )}

      {activeGraphData && activeGraphData.nodes.length > 0 && (
        <div
          className="border border-[#383B42] rounded-md overflow-hidden bg-[#0f172a] relative h-[70vh] min-h-[520px] md:h-[700px]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(139,92,246,0.12) 1px, transparent 1px), linear-gradient(90deg, rgba(139,92,246,0.12) 1px, transparent 1px)",
            backgroundSize: "24px 24px",
          }}
        >
          <svg
            ref={svgRef}
            className="w-full h-full cursor-grab active:cursor-grabbing"
          />

          {/* Zoom Controls */}
          <div className="absolute top-4 right-4 flex flex-col gap-2 z-10">
            <Button
              variant="outline"
              size="sm"
              className="bg-[#1e293b] border-[#383B42] hover:bg-[#22262C] hover:border-purple-500/50 h-8 w-8 p-0"
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
              className="bg-[#1e293b] border-[#383B42] hover:bg-[#22262C] hover:border-purple-500/50 h-8 w-8 p-0"
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
              className="bg-[#1e293b] border-[#383B42] hover:bg-[#22262C] hover:border-purple-500/50 h-8 w-8 p-0"
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

          {activeGraphData.nodes.length > 0 &&
            activeGraphData.edges.filter((e: any) => e.data.type !== "folder")
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
