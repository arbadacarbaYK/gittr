"use client";

import { use, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { fetchBridgeRead } from "@/lib/nostr/bridge-read";
import {
  type RepoFileEntry,
  type StoredRepo,
  loadRepoFiles,
  loadStoredRepos,
} from "@/lib/repos/storage";
import {
  type ArchitectureViewMode,
  generateArchitectureDiagram,
} from "@/lib/utils/architecture-generator";
import {
  getRepoOwnerPubkey,
  resolveEntityToPubkey,
  resolveEntityToPubkeyAsync,
} from "@/lib/utils/entity-resolver";
import { findRepoByEntityAndName } from "@/lib/utils/repo-finder";

import { AlertCircle, Layers, Loader2, RefreshCw } from "lucide-react";
import { useSearchParams } from "next/navigation";

export default function ArchitecturePage({
  params,
}: {
  params: Promise<{ entity: string; repo: string }>;
}) {
  const resolvedParams = use(params);
  const searchParams = useSearchParams();
  const branch = searchParams?.get("branch") || "main";

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mermaidDiagram, setMermaidDiagram] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [diagramType, setDiagramType] =
    useState<ArchitectureViewMode>("overview");
  const [filesFetched, setFilesFetched] = useState(false);
  const fetchedRef = useRef(false);
  const mermaidRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    loadArchitecture();
  }, [resolvedParams.entity, resolvedParams.repo, branch]);

  // Render Mermaid diagram when ready
  useEffect(() => {
    if (!mermaidDiagram || !mermaidRef.current || typeof window === "undefined")
      return;

    let isMounted = true;

    // Dynamically import Mermaid (client-side only)
    import("mermaid")
      .then((mermaidModule) => {
        if (!isMounted || !mermaidRef.current) return;

        const mermaid = mermaidModule.default;

        // Initialize Mermaid with theme settings (only once)
        // Re-init each render so overview/structure/detailed themes stay consistent
        mermaid.initialize({
          startOnLoad: false,
          theme: "dark",
          themeVariables: {
            // LikeC4-inspired calm dark map (teal / sky / soft fills)
            primaryColor: "#134e4a",
            primaryTextColor: "#ecfeff",
            primaryBorderColor: "#2dd4bf",
            primaryBorderWidth: "2px",
            lineColor: "#94a3b8",
            secondaryColor: "#1e293b",
            tertiaryColor: "#0b1220",
            background: "#0b1220",
            mainBkg: "#134e4a",
            secondBkg: "#1e293b",
            tertiaryBkg: "#0b1220",
            textColor: "#e2e8f0",
            clusterBkg: "#111827",
            clusterBorder: "#475569",
            defaultLinkColor: "#94a3b8",
            titleColor: "#f8fafc",
            edgeLabelBackground: "#0f172a",
            nodeBkg: "#1e293b",
            nodeBorder: "#2dd4bf",
            nodeTextColor: "#f8fafc",
            fontFamily:
              "ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif",
          },
          securityLevel: "loose",
          flowchart: {
            useMaxWidth: false,
            htmlLabels: true,
            curve: "basis",
            padding: 28,
            nodeSpacing: 50,
            rankSpacing: 60,
          },
        });

        if (!mermaidRef.current) return;

        // Clear previous content
        mermaidRef.current.innerHTML = "";

        // Create a unique ID for this diagram
        const diagramId = `mermaid-${Date.now()}`;

        // Create element with mermaid class and diagram content
        const mermaidDiv = document.createElement("div");
        mermaidDiv.id = diagramId;
        mermaidDiv.className = "mermaid";
        mermaidDiv.textContent = mermaidDiagram;

        mermaidRef.current.appendChild(mermaidDiv);

        // Add zoom and pan functionality after SVG is rendered
        const setupZoomPan = () => {
          const container = mermaidRef.current;
          if (!container) return;

          const svg = container.querySelector("svg");
          if (!svg) {
            // SVG not ready yet, try again
            setTimeout(setupZoomPan, 100);
            return;
          }

          let scale = 1;
          let panX = 0;
          let panY = 0;
          let isDragging = false;
          let startX = 0;
          let startY = 0;

          // Wrap SVG in a group for transform
          const wrapper = document.createElementNS(
            "http://www.w3.org/2000/svg",
            "g"
          );
          wrapper.setAttribute("id", "mermaid-zoom-pan-wrapper");
          while (svg.firstChild) {
            wrapper.appendChild(svg.firstChild);
          }
          svg.appendChild(wrapper);

          // Center the diagram initially (wait for SVG to be fully rendered)
          const centerDiagram = () => {
            const svgRect = svg.getBoundingClientRect();
            const containerRect = container.getBoundingClientRect();

            // Only center if SVG is smaller than container
            if (svgRect.width > 0 && svgRect.width < containerRect.width) {
              panX = (containerRect.width - svgRect.width) / 2;
            }
            if (svgRect.height > 0 && svgRect.height < containerRect.height) {
              panY = (containerRect.height - svgRect.height) / 2;
            }

            wrapper.setAttribute(
              "transform",
              `translate(${panX}, ${panY}) scale(${scale})`
            );
          };

          // Try to center immediately, then retry after a short delay
          centerDiagram();
          setTimeout(centerDiagram, 300);

          // Mouse wheel zoom
          container.addEventListener(
            "wheel",
            (e: WheelEvent) => {
              e.preventDefault();
              const delta = e.deltaY > 0 ? 0.9 : 1.1;
              scale = Math.max(0.5, Math.min(3, scale * delta));

              wrapper.setAttribute(
                "transform",
                `translate(${panX}, ${panY}) scale(${scale})`
              );
            },
            { passive: false }
          );

          // Mouse drag pan
          container.addEventListener("mousedown", (e: MouseEvent) => {
            if (e.button === 0) {
              // Left mouse button
              isDragging = true;
              startX = e.clientX - panX;
              startY = e.clientY - panY;
              container.style.cursor = "grabbing";
            }
          });

          container.addEventListener("mousemove", (e: MouseEvent) => {
            if (isDragging) {
              panX = e.clientX - startX;
              panY = e.clientY - startY;
              wrapper.setAttribute(
                "transform",
                `translate(${panX}, ${panY}) scale(${scale})`
              );
            }
          });

          container.addEventListener("mouseup", () => {
            isDragging = false;
            container.style.cursor = "grab";
          });

          container.addEventListener("mouseleave", () => {
            isDragging = false;
            container.style.cursor = "grab";
          });

          // Click on nodes
          container.addEventListener("click", (e: MouseEvent) => {
            const target = e.target as HTMLElement;
            if (target.tagName === "text" || target.closest("g.node")) {
              console.log(
                "Node clicked:",
                target.textContent || target.getAttribute("data-label")
              );
            }
          });
        };

        // Render using mermaid.run() - check if it exists and handle both sync and async cases
        try {
          setTimeout(() => {
            if (!isMounted || !mermaidRef.current) return;

            const element = document.getElementById(diagramId);
            if (!element) {
              console.error("Mermaid element not found");
              return;
            }

            // Try mermaid.run() if available (Mermaid 11.x)
            if (typeof mermaid.run === "function") {
              try {
                const result = mermaid.run({
                  querySelector: `#${diagramId}`,
                });

                if (result && typeof result.then === "function") {
                  result
                    .then(() => {
                      if (!isMounted || !mermaidRef.current) return;
                      console.log("✅ Mermaid diagram rendered via run()");
                      // Setup zoom/pan after rendering
                      setTimeout(setupZoomPan, 100);
                    })
                    .catch((err) => {
                      console.error("Mermaid run error:", err);
                      setTimeout(setupZoomPan, 500);
                    });
                } else {
                  // run() completed synchronously
                  console.log("✅ Mermaid diagram rendered via run() (sync)");
                  setTimeout(setupZoomPan, 100);
                }
              } catch (runErr) {
                console.warn(
                  "mermaid.run() failed, trying contentLoaded:",
                  runErr
                );
                setTimeout(setupZoomPan, 500);
              }
            } else {
              // Older API - just let startOnLoad handle it
              console.log("Using startOnLoad for Mermaid rendering");
              setTimeout(setupZoomPan, 500);
            }
          }, 150);
        } catch (err) {
          console.error("Mermaid render error:", err);
          if (mermaidRef.current && isMounted) {
            const errorMessage =
              err instanceof Error ? err.message : String(err);
            mermaidRef.current.innerHTML = `<div class="text-red-400 p-4">Failed to render diagram: ${errorMessage}</div>`;
          }
        }
      })
      .catch((err) => {
        console.error("Failed to load Mermaid:", err);
        if (mermaidRef.current && isMounted) {
          mermaidRef.current.innerHTML = `<div class="text-red-400 p-4">Failed to load Mermaid library</div>`;
        }
      });

    return () => {
      isMounted = false;
    };
  }, [mermaidDiagram, diagramType]);

  async function loadArchitecture(modeOverride?: ArchitectureViewMode) {
    const mode = modeOverride ?? diagramType;
    setLoading(true);
    setError(null);
    setStatus("Loading repository data...");

    try {
      // Get repos from localStorage
      const repos = loadStoredRepos();

      // Get repo data (local list). Deep links without a cached row still work
      // if the URL entity resolves to an owner — we then fetch files from the bridge.
      let repo =
        findRepoByEntityAndName<StoredRepo>(
          repos,
          resolvedParams.entity,
          resolvedParams.repo
        ) ?? null;
      if (!repo) {
        setStatus("Opening repository from link (not in local list)...");
        const pk =
          resolveEntityToPubkey(resolvedParams.entity) ??
          (await resolveEntityToPubkeyAsync(resolvedParams.entity));
        if (!pk) {
          throw new Error(
            "This repository is not saved in this browser yet, and the owner in the URL could not be resolved. Use an npub or full hex pubkey in the path, or open the repo from Gittr once so it is cached."
          );
        }
        repo = {
          entity: resolvedParams.entity,
          repo: resolvedParams.repo,
          ownerPubkey: pk.toLowerCase(),
        };
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

      // Same canonical name as Dependencies (NIP-34 repositoryName vs URL slug)
      const repoDataAny = repo as any;
      let actualRepoName =
        repoDataAny?.repositoryName ||
        repoDataAny?.repo ||
        repoDataAny?.slug ||
        repoDataAny?.name ||
        resolvedParams.repo;
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
        setError(null);
        setMermaidDiagram("");
        setStatus(
          "No file listing yet. Open the Code tab once and wait for the file tree to finish loading, then return here (public repos now save that tree in this browser for all viewers). If it still fails, set GIT_NOSTR_BRIDGE_REPOS_DIR on the server or try ?branch= for non-main defaults."
        );
        setLoading(false);
        return;
      }

      setStatus(`Analyzing ${files.length} files for architecture...`);

      const diagram = generateArchitectureDiagram(
        files,
        mode,
        actualRepoName
      );
      console.log("📊 [Architecture] Generated diagram:", mode, diagram);

      setMermaidDiagram(diagram);
      setFilesFetched(true);
      setStatus("Architecture diagram generated");
    } catch (err: any) {
      console.error("Failed to load architecture:", err);
      setError(
        err instanceof Error ? err.message : "Failed to load architecture"
      );
    } finally {
      setLoading(false);
    }
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
        `✅ [Architecture] Using ${repo.files.length} files from repo data (immediate)`
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
          `✅ [Architecture] Using ${matchingRepo.files.length} files from localStorage (immediate)`
        );
        return matchingRepo.files;
      }

      // Separate file tree cache (Code tab / bridge) — keyed by URL entity + repo slug.
      // Must NOT require a row in gittr_repos: deep links and synthetic repo objects still
      // have the same keys after persistRepoFiles on the main repo page.
      try {
        const slugFiles = loadRepoFiles(
          resolvedParams.entity,
          resolvedParams.repo
        );
        if (slugFiles && slugFiles.length > 0) {
          console.log(
            `✅ [Architecture] Using ${slugFiles.length} files from gittr_files cache (${resolvedParams.repo})`
          );
          return slugFiles.map((f: RepoFileEntry) => ({
            type: f.type,
            path: f.path,
          }));
        }
        if (repoName && repoName !== resolvedParams.repo) {
          const nameFiles = loadRepoFiles(resolvedParams.entity, repoName);
          if (nameFiles && nameFiles.length > 0) {
            console.log(
              `✅ [Architecture] Using ${nameFiles.length} files from gittr_files cache (${repoName})`
            );
            return nameFiles.map((f: RepoFileEntry) => ({
              type: f.type,
              path: f.path,
            }));
          }
        }
      } catch (e) {
        console.warn("Failed to check separate files storage:", e);
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
            const data = await response.json();
            if (data.tree) {
              const files = data.tree
                .filter((n: any) => n.type === "blob")
                .map((n: any) => ({
                  type: "file",
                  path: n.path,
                  size: n.size,
                }));
              const dirs = data.tree
                .filter((n: any) => n.type === "tree")
                .map((n: any) => ({ type: "dir", path: n.path }));
              console.log(
                `✅ [Architecture] Fetched ${files.length} files from GitHub`
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
      const response = await fetchBridgeRead(
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
            `✅ [Architecture] Fetched ${data.files.length} files from git-nostr-bridge`
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

  return (
    <div className="mt-4 w-screen max-w-none relative left-1/2 right-1/2 -translate-x-1/2 px-3 sm:px-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
        <div className="flex items-center gap-2 min-w-0">
          <Layers className="h-5 w-5 shrink-0 theme-accent-primary" />
          <div className="min-w-0">
            <h2 className="text-xl font-semibold truncate">Architecture</h2>
            <p className="text-xs text-gray-500">
              C4-style overview from the file tree — fewer boxes, clearer flow
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={diagramType}
            onChange={(e) => {
              const next = e.target.value as ArchitectureViewMode;
              setDiagramType(next);
              fetchedRef.current = false;
              // Pass mode explicitly — setState is async
              void loadArchitecture(next);
            }}
            className="px-3 py-1.5 bg-[#22262C] border border-[#383B42] rounded-md text-sm text-gray-300"
          >
            <option value="overview">Overview (C4)</option>
            <option value="structure">Structure</option>
            <option value="detailed">Detailed layers</option>
          </select>
          <Button
            onClick={() => {
              fetchedRef.current = false;
              void loadArchitecture();
            }}
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
      </div>

      <div className="mb-3 flex flex-wrap gap-3 text-[11px] text-gray-500">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-teal-700 border border-teal-400" />
          Frontend
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-blue-900 border border-blue-400" />
          API
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-purple-950 border border-purple-400" />
          Backend
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-amber-950 border border-amber-400" />
          Data
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-zinc-800 border border-zinc-400" />
          Platform
        </span>
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

      {loading && !mermaidDiagram && (
        <div className="flex items-center justify-center h-96">
          <Loader2 className="h-8 w-8 animate-spin theme-accent-primary" />
        </div>
      )}

      {mermaidDiagram && (
        <>
          <style>{`
            .mermaid-architecture-container::-webkit-scrollbar {
              width: 8px !important;
              height: 8px !important;
            }
            .mermaid-architecture-container::-webkit-scrollbar-track {
              background: transparent !important;
            }
            .mermaid-architecture-container::-webkit-scrollbar-thumb {
              background-color: #4b5563 !important;
              border-radius: 4px !important;
            }
            .mermaid-architecture-container::-webkit-scrollbar-thumb:hover {
              background-color: #6b7280 !important;
            }
            .mermaid-architecture-container svg {
              max-width: none !important;
              width: auto !important;
              height: auto !important;
              display: block;
              position: relative;
              z-index: 1;
              margin: 0;
              padding: 0;
            }
            .mermaid-architecture-container {
              isolation: isolate;
              position: relative;
              z-index: 1;
            }
            .mermaid-architecture-wrapper {
              position: relative;
              z-index: 0;
              isolation: isolate;
              overflow: hidden;
            }
            .mermaid-architecture-container * {
              position: relative;
            }
            /* Ensure scrollbar doesn't overlay content */
            .mermaid-architecture-container {
              scrollbar-gutter: stable;
            }
            /* Make sure SVG content is fully visible and not clipped */
            .mermaid-architecture-container svg {
              overflow: visible !important;
            }
            /* Ensure container doesn't clip content */
            .mermaid-architecture-container {
              overflow-x: auto;
              overflow-y: auto;
            }
          `}</style>
          <div className="mermaid-architecture-wrapper border border-[#383B42] rounded-xl bg-[#0b1220] relative h-[70vh] min-h-[520px] md:h-[800px] shadow-[inset_0_1px_0_rgba(148,163,184,0.08)]">
            <div
              className="absolute top-0 left-0 right-0 h-8 flex items-center gap-1.5 px-3 border-b border-[#1f2937] bg-[#111827]/60 rounded-t-xl z-10 pointer-events-none"
              aria-hidden
            >
              <span className="h-2.5 w-2.5 rounded-full bg-[#f87171]/80" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#fbbf24]/80" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#34d399]/80" />
              <span className="ml-2 text-[10px] text-gray-500 tracking-wide">
                architecture overview
              </span>
            </div>
            <div
              ref={mermaidRef}
              className="mermaid-architecture-container w-full h-full overflow-auto cursor-grab active:cursor-grabbing"
              style={{
                scrollbarWidth: "thin",
                scrollbarColor: "#4b5563 transparent",
                boxSizing: "border-box",
                position: "relative",
                zIndex: 1,
                padding: "40px 24px 24px",
                width: "100%",
                height: "100%",
              }}
            />
          </div>
        </>
      )}

      {!loading && !error && filesFetched && !mermaidDiagram && (
        <div className="text-center py-12 text-gray-400">
          <Layers className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p>Could not generate architecture diagram</p>
        </div>
      )}
    </div>
  );
}
