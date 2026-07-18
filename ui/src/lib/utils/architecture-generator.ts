/**
 * Architecture diagrams from repository file trees.
 * Default view is a LikeC4-inspired C4 overview (few containers, labeled edges).
 */

export interface ArchitectureNode {
  id: string;
  label: string;
  type: "module" | "component" | "service" | "api" | "database" | "config";
  path?: string;
  children?: ArchitectureNode[];
}

export interface ArchitectureDiagram {
  nodes: ArchitectureNode[];
  edges: Array<{ from: string; to: string; type: string }>;
}

export type ArchitectureViewMode = "overview" | "structure" | "detailed";

type LayerKey = "frontend" | "api" | "backend" | "database" | "infra";

type LayerBucket = {
  key: LayerKey;
  title: string;
  description: string;
  paths: string[];
  modules: Map<string, number>;
};

const SKIP_PATH_PARTS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "coverage",
  "vendor",
  "__pycache__",
  ".turbo",
  "target",
]);

/**
 * Analyze repository structure and generate architecture diagram
 */
export function analyzeArchitecture(
  files: Array<{ type: string; path: string }>
): ArchitectureDiagram {
  const nodes: ArchitectureNode[] = [];
  const edges: Array<{ from: string; to: string; type: string }> = [];
  const nodeMap = new Map<string, ArchitectureNode>();

  const codeFiles = files.filter(
    (f) =>
      f.type === "file" &&
      /\.(js|ts|jsx|tsx|py|go|rs|java|php|rb)$/.test(f.path) &&
      !shouldSkipPath(f.path)
  );

  const entryPoints = identifyEntryPoints(codeFiles.map((f) => f.path));
  const modules = identifyModules(codeFiles.map((f) => f.path)).slice(0, 24);

  entryPoints.slice(0, 16).forEach((entry) => {
    const node: ArchitectureNode = {
      id: entry.id,
      label: entry.name,
      type: entry.type,
      path: entry.path,
    };
    nodes.push(node);
    nodeMap.set(entry.id, node);
  });

  modules.forEach((module) => {
    if (!nodeMap.has(module.id)) {
      const node: ArchitectureNode = {
        id: module.id,
        label: module.name,
        type: "module",
        path: module.path,
      };
      nodes.push(node);
      nodeMap.set(module.id, node);
    }
  });

  modules.forEach((module) => {
    const parent = findParentModule(module.path, modules);
    if (parent) {
      edges.push({
        from: parent.id,
        to: module.id,
        type: "contains",
      });
    }
  });

  return { nodes, edges };
}

function shouldSkipPath(path: string): boolean {
  return path.split("/").some((p) => SKIP_PATH_PARTS.has(p));
}

function identifyEntryPoints(filePaths: string[]): Array<{
  id: string;
  name: string;
  type: ArchitectureNode["type"];
  path: string;
}> {
  const entryPoints: Array<{
    id: string;
    name: string;
    type: ArchitectureNode["type"];
    path: string;
  }> = [];

  filePaths.forEach((path) => {
    const fileName = path.split("/").pop()?.toLowerCase() || "";
    const dir = path.substring(0, path.lastIndexOf("/"));

    if (
      fileName === "main.js" ||
      fileName === "main.ts" ||
      fileName === "main.go" ||
      fileName === "index.js" ||
      fileName === "index.ts" ||
      fileName === "app.js" ||
      fileName === "app.ts" ||
      fileName === "app.jsx" ||
      fileName === "app.tsx" ||
      fileName === "server.js" ||
      fileName === "server.ts"
    ) {
      entryPoints.push({
        id: path,
        name: fileName,
        type: dir === "" || dir === "src" ? "component" : "module",
        path,
      });
    }

    if (path.includes("/api/") || path.includes("/routes/")) {
      entryPoints.push({
        id: path,
        name: fileName,
        type: "api",
        path,
      });
    }

    if (
      fileName === "config.js" ||
      fileName === "config.ts" ||
      fileName === "settings.js" ||
      fileName === "settings.ts"
    ) {
      entryPoints.push({
        id: path,
        name: fileName,
        type: "config",
        path,
      });
    }
  });

  return entryPoints;
}

function identifyModules(
  filePaths: string[]
): Array<{ id: string; name: string; path: string; count: number }> {
  const counts = new Map<string, number>();

  filePaths.forEach((path) => {
    const parts = path.split("/").filter(Boolean);
    if (parts.length < 2) return;
    // Prefer top-level + one nested folder (src/app, ui/src, cmd/bridge)
    const depth = Math.min(2, parts.length - 1);
    for (let i = 1; i <= depth; i++) {
      const modulePath = parts.slice(0, i).join("/");
      counts.set(modulePath, (counts.get(modulePath) || 0) + 1);
    }
  });

  return Array.from(counts.entries())
    .map(([path, count]) => ({
      id: path,
      name: path.split("/").pop() || path,
      path,
      count,
    }))
    .sort((a, b) => b.count - a.count);
}

function findParentModule(
  path: string,
  modules: Array<{ id: string; name: string; path: string }>
): { id: string; name: string; path: string } | null {
  const parts = path.split("/");
  if (parts.length <= 1) return null;
  const parentPath = parts.slice(0, -1).join("/");
  return modules.find((m) => m.path === parentPath) || null;
}

/**
 * Structure view — capped module map (not every directory level).
 */
export function generateMermaidDiagram(
  architecture: ArchitectureDiagram
): string {
  if (architecture.nodes.length === 0) {
    return 'graph TB\n  Empty["No structure found"]\n';
  }

  let mermaid = "graph LR\n";
  const entryPoints = architecture.nodes.filter((n) => n.type !== "module");
  const modules = architecture.nodes.filter((n) => n.type === "module");

  mermaid += '  subgraph Entries["Entry points"]\n';
  if (entryPoints.length === 0) {
    mermaid += '    E_none["(none detected)"]\n';
  } else {
    entryPoints.forEach((node) => {
      const id = sanitizeId(`e_${node.label}_${node.path || ""}`);
      mermaid += `    ${id}["${escapeLabel(truncate(node.label, 28))}"]\n`;
    });
  }
  mermaid += "  end\n";

  mermaid += '  subgraph Modules["Top modules"]\n';
  modules.slice(0, 14).forEach((node) => {
    const id = sanitizeId(`m_${node.path || node.label}`);
    mermaid += `    ${id}["${escapeLabel(truncate(node.label, 28))}"]\n`;
  });
  mermaid += "  end\n";

  if (entryPoints.length > 0 && modules.length > 0) {
    mermaid += "  Entries -.->|belongs to| Modules\n";
  }

  return mermaid;
}

/**
 * LikeC4-inspired C4 overview: system boundary + few containers + labeled edges.
 */
export function generateC4Overview(
  files: Array<{ type: string; path: string }>,
  repoName = "System"
): string {
  const allFiles = files.filter(
    (f) => f.type === "file" && !shouldSkipPath(f.path)
  );
  if (allFiles.length === 0) {
    return 'graph TB\n  Empty["No files found"]\n';
  }

  const buckets = buildLayerBuckets(allFiles.map((f) => f.path));
  const active = (
    ["frontend", "api", "backend", "database", "infra"] as LayerKey[]
  ).filter((k) => buckets[k].paths.length > 0);

  if (active.length === 0) {
    return 'graph TB\n  Empty["No architecture signals found"]\n';
  }

  const systemLabel = truncate(repoName.replace(/\.git$/, "") || "System", 40);
  let mermaid = "graph TB\n";
  mermaid += `  Users((Users))\n`;
  mermaid += `  subgraph System["${escapeLabel(systemLabel)}"]\n`;

  for (const key of active) {
    const b = buckets[key];
    const topMods = topModuleLabels(b.modules, 3);
    const modLine = topMods.length
      ? topMods.join(" · ")
      : `${b.paths.length} files`;
    const countLine = `${b.modules.size || 1} areas · ${b.paths.length} files`;
    const nodeId = `C_${key}`;
    mermaid += `    ${nodeId}["${escapeLabel(b.title)}<br/><small>${escapeLabel(
      b.description
    )}</small><br/><small>${escapeLabel(countLine)}</small><br/><small>${escapeLabel(
      truncate(modLine, 48)
    )}</small>"]\n`;
  }

  mermaid += "  end\n";

  // Edges — LikeC4-style labels
  if (buckets.frontend.paths.length > 0) {
    mermaid += "  Users -->|opens in browser| C_frontend\n";
  } else if (buckets.api.paths.length > 0) {
    mermaid += "  Users -->|uses| C_api\n";
  } else if (buckets.backend.paths.length > 0) {
    mermaid += "  Users -->|uses| C_backend\n";
  }

  if (buckets.frontend.paths.length > 0 && buckets.api.paths.length > 0) {
    mermaid += "  C_frontend -->|requests via HTTPS| C_api\n";
  } else if (
    buckets.frontend.paths.length > 0 &&
    buckets.backend.paths.length > 0
  ) {
    mermaid += "  C_frontend -->|calls| C_backend\n";
  }

  if (buckets.api.paths.length > 0 && buckets.backend.paths.length > 0) {
    mermaid += "  C_api -->|invokes| C_backend\n";
  }

  if (buckets.backend.paths.length > 0 && buckets.database.paths.length > 0) {
    mermaid += "  C_backend -->|reads / writes| C_database\n";
  } else if (buckets.api.paths.length > 0 && buckets.database.paths.length > 0) {
    mermaid += "  C_api -->|reads / writes| C_database\n";
  }

  if (buckets.infra.paths.length > 0) {
    const target =
      buckets.backend.paths.length > 0
        ? "C_backend"
        : buckets.api.paths.length > 0
        ? "C_api"
        : active[0]
        ? `C_${active[0]}`
        : null;
    if (target) {
      mermaid += `  C_infra -.->|deploys / configures| ${target}\n`;
    }
  }

  // Class styles (picked up by Mermaid theme + classDef)
  mermaid += `
  classDef actor fill:#1e3a5f,stroke:#38bdf8,stroke-width:2px,color:#e0f2fe
  classDef frontend fill:#134e4a,stroke:#2dd4bf,stroke-width:2px,color:#ccfbf1
  classDef api fill:#1e3a8a,stroke:#60a5fa,stroke-width:2px,color:#dbeafe
  classDef backend fill:#3b0764,stroke:#c084fc,stroke-width:2px,color:#f3e8ff
  classDef database fill:#422006,stroke:#fbbf24,stroke-width:2px,color:#fef3c7
  classDef infra fill:#27272a,stroke:#a1a1aa,stroke-width:2px,color:#e4e4e7
  class Users actor
`;
  for (const key of active) {
    mermaid += `  class C_${key} ${key}\n`;
  }

  return mermaid;
}

/**
 * Detailed layered view — capped file samples per layer (legacy, less noisy).
 */
export function generateLayeredArchitecture(
  files: Array<{ type: string; path: string }>
): string {
  const allFiles = files.filter(
    (f) => f.type === "file" && !shouldSkipPath(f.path)
  );
  if (allFiles.length === 0) {
    return 'graph TB\n  Empty["No files found"]\n';
  }

  const buckets = buildLayerBuckets(allFiles.map((f) => f.path));
  const maxPerLayer = 8;
  let mermaid = "graph TB\n";

  const renderLayer = (key: LayerKey, prefix: string) => {
    const b = buckets[key];
    mermaid += `  subgraph ${prefix}["${b.title}"]\n`;
    const sample = b.paths.slice(0, maxPerLayer);
    if (sample.length === 0) {
      mermaid += `    ${prefix}_empty["(empty)"]\n`;
    } else {
      sample.forEach((filePath, i) => {
        const fileName = filePath.split("/").pop() || filePath;
        mermaid += `    ${prefix}_${i}["${escapeLabel(
          truncate(fileName, 28)
        )}"]\n`;
      });
      if (b.paths.length > maxPerLayer) {
        mermaid += `    ${prefix}_more["+${
          b.paths.length - maxPerLayer
        } more…"]\n`;
      }
    }
    mermaid += "  end\n";
  };

  renderLayer("frontend", "Frontend");
  renderLayer("api", "API");
  renderLayer("backend", "Backend");
  if (buckets.database.paths.length > 0) renderLayer("database", "Database");
  if (buckets.infra.paths.length > 0) renderLayer("infra", "Infra");

  if (buckets.frontend.paths.length && buckets.api.paths.length) {
    mermaid += "  Frontend -->|requests| API\n";
  }
  if (buckets.api.paths.length && buckets.backend.paths.length) {
    mermaid += "  API -->|invokes| Backend\n";
  } else if (buckets.frontend.paths.length && buckets.backend.paths.length) {
    mermaid += "  Frontend -->|calls| Backend\n";
  }
  if (buckets.backend.paths.length && buckets.database.paths.length) {
    mermaid += "  Backend -->|stores| Database\n";
  }

  return mermaid;
}

function buildLayerBuckets(filePaths: string[]): Record<LayerKey, LayerBucket> {
  const make = (
    key: LayerKey,
    title: string,
    description: string
  ): LayerBucket => ({
    key,
    title,
    description,
    paths: [],
    modules: new Map(),
  });

  const buckets: Record<LayerKey, LayerBucket> = {
    frontend: make("frontend", "Frontend", "UI and client surfaces"),
    api: make("api", "API", "HTTP / RPC boundaries"),
    backend: make("backend", "Backend", "Core services and domain logic"),
    database: make("database", "Data", "Models, schema, persistence"),
    infra: make("infra", "Platform", "Deploy, CI, ops config"),
  };

  const note = (key: LayerKey, path: string) => {
    buckets[key].paths.push(path);
    const mod = topArea(path);
    if (mod) {
      buckets[key].modules.set(mod, (buckets[key].modules.get(mod) || 0) + 1);
    }
  };

  filePaths.forEach((path) => {
    const lower = path.toLowerCase();
    if (
      /(^|\/)(dockerfile|docker-compose|compose\.ya?ml|\.github\/|deploy\/|k8s\/|helm\/|terraform\/|infra\/)/.test(
        lower
      ) ||
      (/\.(ya?ml|toml)$/.test(lower) &&
        /(docker|k8s|deploy|ci|workflow)/.test(lower))
    ) {
      note("infra", path);
    } else if (
      /(^|\/)(api|routes|endpoints|graphql|rpc)(\/|$)/.test(lower) ||
      /pages\/api\//.test(lower) ||
      /app\/api\//.test(lower)
    ) {
      note("api", path);
    } else if (
      /(^|\/)(components|pages|views|ui|client|frontend|app|public)(\/|$)/.test(
        lower
      ) ||
      /\.(jsx|tsx|vue|svelte|css|scss)$/.test(lower)
    ) {
      note("frontend", path);
    } else if (
      /(^|\/)(models|schema|database|db|migrations|prisma|sql)(\/|$)/.test(
        lower
      ) ||
      /\.(sql|prisma)$/.test(lower)
    ) {
      note("database", path);
    } else if (
      /\.(md|txt|svg|png|jpg|ico|lock|example|gitignore|dockerignore|editorconfig|prettierignore|eslintignore)$/.test(
        lower
      ) ||
      /(^|\/)\.[^/]+$/.test(path) || // root/dotfiles (.env.example, .cursorignore, …)
      /(^|\/)(license|changelog|contributing|code_of_conduct)(\.|$)/i.test(path)
    ) {
      // docs / assets / tooling noise — skip so overview stays calm
    } else {
      note("backend", path);
    }
  });

  return buckets;
}

function topArea(path: string): string | null {
  const parts = path.split("/").filter(Boolean);
  if (parts.length === 0) return null;
  if (parts[0] === "src" || parts[0] === "app" || parts[0] === "ui") {
    return parts.slice(0, Math.min(2, parts.length)).join("/");
  }
  return parts[0] ?? null;
}

function topModuleLabels(modules: Map<string, number>, n: number): string[] {
  return Array.from(modules.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([name]) => name);
}

function sanitizeId(label: string): string {
  const s = label.replace(/[^a-zA-Z0-9_]/g, "_");
  return s.replace(/^(\d)/, "_$1").slice(0, 48) || "n";
}

function escapeLabel(label: string): string {
  return label.replace(/"/g, "'").replace(/[<>]/g, "");
}

function truncate(label: string, max: number): string {
  if (label.length <= max) return label;
  return `${label.slice(0, max - 1)}…`;
}

/** @deprecated kept for callers; prefer generateC4Overview */
export function generateArchitectureDiagram(
  files: Array<{ type: string; path: string }>,
  mode: ArchitectureViewMode,
  repoName?: string
): string {
  if (mode === "overview") return generateC4Overview(files, repoName);
  if (mode === "detailed") return generateLayeredArchitecture(files);
  return generateMermaidDiagram(analyzeArchitecture(files));
}
