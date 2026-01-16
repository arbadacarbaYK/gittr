/**
 * Utility functions to analyze codebase structure and generate Mermaid diagrams
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

/**
 * Analyze repository structure and generate architecture diagram
 */
export function analyzeArchitecture(
  files: Array<{ type: string; path: string }>
): ArchitectureDiagram {
  const nodes: ArchitectureNode[] = [];
  const edges: Array<{ from: string; to: string; type: string }> = [];
  const nodeMap = new Map<string, ArchitectureNode>();

  // Filter to only code files
  const codeFiles = files.filter(
    (f) =>
      f.type === "file" &&
      /\.(js|ts|jsx|tsx|py|go|rs|java|php|rb)$/.test(f.path)
  );

  // Identify entry points and structure
  const entryPoints = identifyEntryPoints(codeFiles.map((f) => f.path));
  const modules = identifyModules(codeFiles.map((f) => f.path));

  // Create nodes for entry points
  entryPoints.forEach((entry) => {
    const node: ArchitectureNode = {
      id: entry.id,
      label: entry.name,
      type: entry.type,
      path: entry.path,
    };
    nodes.push(node);
    nodeMap.set(entry.id, node);
  });

  // Create nodes for modules
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

  // Create edges based on directory structure
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

/**
 * Identify entry points (main files, index files, app files)
 */
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

    // Main entry points
    if (
      fileName === "main.js" ||
      fileName === "main.ts" ||
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

    // API routes
    if (path.includes("/api/") || path.includes("/routes/")) {
      entryPoints.push({
        id: path,
        name: fileName,
        type: "api",
        path,
      });
    }

    // Config files
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

/**
 * Identify modules (directories with code files)
 */
function identifyModules(
  filePaths: string[]
): Array<{ id: string; name: string; path: string }> {
  const moduleMap = new Map<
    string,
    { id: string; name: string; path: string }
  >();

  filePaths.forEach((path) => {
    const parts = path.split("/");
    // Create modules for each directory level
    for (let i = 1; i < parts.length; i++) {
      const modulePath = parts.slice(0, i).join("/");
      const moduleName = parts[i - 1] || "";

      if (moduleName && !moduleMap.has(modulePath)) {
        moduleMap.set(modulePath, {
          id: modulePath,
          name: moduleName,
          path: modulePath,
        });
      }
    }
  });

  return Array.from(moduleMap.values());
}

/**
 * Find parent module for a given path
 */
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
 * Generate Mermaid diagram from architecture - shows hierarchical structure
 * This view shows entry points, modules, and their relationships (different from layered view)
 */
export function generateMermaidDiagram(
  architecture: ArchitectureDiagram
): string {
  if (architecture.nodes.length === 0) {
    return 'graph TB\n  Empty["No structure found"]\n';
  }

  // Use graph LR (left-right) for better flow visualization
  let mermaid = "graph LR\n";

  // Separate entry points from modules
  const entryPoints = architecture.nodes.filter(
    (n) =>
      n.type === "api" ||
      n.type === "component" ||
      n.type === "service" ||
      n.type === "config"
  );
  const modules = architecture.nodes.filter((n) => n.type === "module");

  // Group modules by directory structure
  const moduleGroups = new Map<string, ArchitectureNode[]>();
  modules.forEach((module) => {
    const path = module.path || "";
    const parts = path.split("/");
    const groupKey = parts.length > 1 ? parts.slice(0, -1).join("/") : "root";

    if (!moduleGroups.has(groupKey)) {
      moduleGroups.set(groupKey, []);
    }
    moduleGroups.get(groupKey)!.push(module);
  });

  // Add entry points first (these are the main components)
  entryPoints.forEach((node) => {
    const shape = getNodeShape(node.type);
    const label = sanitizeLabel(node.label);
    const displayName =
      node.label.length > 25 ? node.label.substring(0, 22) + "..." : node.label;
    mermaid += `  ${label}${shape}[\"${displayName}\"]\n`;
  });

  // Add modules grouped by directory (if we have groups)
  if (moduleGroups.size > 1) {
    moduleGroups.forEach((groupModules, groupKey) => {
      if (groupModules.length > 0) {
        const groupName =
          groupKey === "root" ? "Root" : groupKey.split("/").pop() || "Modules";
        const sanitizedGroupName = sanitizeLabel(groupName);
        mermaid += `  subgraph ${sanitizedGroupName}[\"${groupName}\"]\n`;
        groupModules.forEach((node) => {
          const label = sanitizeLabel(node.label);
          const displayName =
            node.label.length > 25
              ? node.label.substring(0, 22) + "..."
              : node.label;
          mermaid += `    ${label}[\"${displayName}\"]\n`;
        });
        mermaid += "  end\n";
      }
    });
  } else {
    // No grouping - just add modules directly
    modules.forEach((node) => {
      const label = sanitizeLabel(node.label);
      const displayName =
        node.label.length > 25
          ? node.label.substring(0, 22) + "..."
          : node.label;
      mermaid += `  ${label}[\"${displayName}\"]\n`;
    });
  }

  // Add edges to show relationships (only if we have edges)
  if (architecture.edges.length > 0) {
    architecture.edges.forEach((edge) => {
      const fromLabel = sanitizeLabel(edge.from.split("/").pop() || edge.from);
      const toLabel = sanitizeLabel(edge.to.split("/").pop() || edge.to);
      mermaid += `  ${fromLabel} --> ${toLabel}\n`;
    });
  } else if (entryPoints.length > 0 && modules.length > 0) {
    // If no explicit edges, connect entry points to their containing modules
    entryPoints.forEach((entry) => {
      const entryPath = entry.path || "";
      const entryDir = entryPath.substring(0, entryPath.lastIndexOf("/"));
      modules.forEach((module) => {
        if (module.path && entryDir.includes(module.path)) {
          const entryLabel = sanitizeLabel(entry.label);
          const moduleLabel = sanitizeLabel(module.label);
          mermaid += `  ${entryLabel} --> ${moduleLabel}\n`;
        }
      });
    });
  }

  return mermaid;
}

/**
 * Sanitize label for Mermaid (remove special chars, keep alphanumeric and underscores)
 */
function sanitizeLabel(label: string): string {
  return label.replace(/[^a-zA-Z0-9_]/g, "_");
}

/**
 * Get Mermaid node shape based on type
 */
function getNodeShape(type: ArchitectureNode["type"]): string {
  switch (type) {
    case "component":
      return "[Component]";
    case "service":
      return "[Service]";
    case "api":
      return "[API]";
    case "database":
      return "[(Database)]";
    case "config":
      return "[Config]";
    default:
      return "[Module]";
  }
}

/**
 * Generate a more detailed architecture diagram with layers (Frontend/API/Backend)
 * Shows ALL files organized by architectural layer
 */
export function generateLayeredArchitecture(
  files: Array<{ type: string; path: string }>
): string {
  // Include ALL files, not just code files
  const allFiles = files.filter((f) => f.type === "file");

  if (allFiles.length === 0) {
    return 'graph TB\n  Empty["No files found"]\n';
  }

  const layers = identifyLayers(allFiles.map((f) => f.path));

  // Use graph TB (top-bottom) for better vertical layout with subgraphs
  let mermaid = "graph TB\n";

  // Frontend subgraph - show ALL files
  mermaid += '  subgraph Frontend["Frontend"]\n';
  if (layers.frontend.length > 0) {
    layers.frontend.forEach((filePath) => {
      const fileName = filePath.split("/").pop() || filePath;
      const label = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
      mermaid += `    F_${label}[\"${fileName}\"]\n`;
    });
  } else {
    mermaid += `    F_empty[\"No files\"]\n`;
  }
  mermaid += "  end\n";

  // API subgraph - show ALL files
  mermaid += '  subgraph API["API"]\n';
  if (layers.api.length > 0) {
    layers.api.forEach((filePath) => {
      const fileName = filePath.split("/").pop() || filePath;
      const label = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
      mermaid += `    A_${label}[\"${fileName}\"]\n`;
    });
  } else {
    mermaid += `    A_empty[\"No files\"]\n`;
  }
  mermaid += "  end\n";

  // Backend subgraph - show ALL files
  mermaid += '  subgraph Backend["Backend"]\n';
  if (layers.backend.length > 0) {
    layers.backend.forEach((filePath) => {
      const fileName = filePath.split("/").pop() || filePath;
      const label = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
      mermaid += `    B_${label}[\"${fileName}\"]\n`;
    });
  } else {
    mermaid += `    B_empty[\"No files\"]\n`;
  }
  mermaid += "  end\n";

  // Database subgraph - only if it has files
  if (layers.database.length > 0) {
    mermaid += '  subgraph Database["Database"]\n';
    layers.database.forEach((filePath) => {
      const fileName = filePath.split("/").pop() || filePath;
      const label = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
      mermaid += `    D_${label}[\"${fileName}\"]\n`;
    });
    mermaid += "  end\n";
  }

  // Add connections between layers
  if (layers.frontend.length > 0 && layers.api.length > 0) {
    mermaid += "  Frontend --> API\n";
  } else if (layers.frontend.length === 0 && layers.api.length > 0) {
    mermaid += "  Frontend -.-> API\n";
  }

  if (layers.api.length > 0 && layers.backend.length > 0) {
    mermaid += "  API --> Backend\n";
  } else if (layers.api.length === 0 && layers.backend.length > 0) {
    mermaid += "  API -.-> Backend\n";
  }

  if (layers.backend.length > 0 && layers.database.length > 0) {
    mermaid += "  Backend --> Database\n";
  }

  return mermaid;
}

/**
 * Get icon for file type
 */
function getFileIcon(ext: string): string {
  const icons: Record<string, string> = {
    js: "📄",
    ts: "📘",
    jsx: "⚛️",
    tsx: "⚛️",
    py: "🐍",
    go: "🐹",
    rs: "🦀",
    java: "☕",
    php: "🐘",
    rb: "💎",
    html: "🌐",
    css: "🎨",
    json: "📋",
    md: "📝",
    yml: "⚙️",
    yaml: "⚙️",
    xml: "📄",
    sql: "🗄️",
    sh: "💻",
    dockerfile: "🐳",
  };
  return icons[ext] || "📄";
}

/**
 * Identify layers (frontend, backend, API, database)
 */
function identifyLayers(filePaths: string[]): {
  frontend: string[];
  backend: string[];
  api: string[];
  database: string[];
} {
  const layers = {
    frontend: [] as string[],
    backend: [] as string[],
    api: [] as string[],
    database: [] as string[],
  };

  filePaths.forEach((path) => {
    const lowerPath = path.toLowerCase();

    if (
      lowerPath.includes("/api/") ||
      lowerPath.includes("/routes/") ||
      lowerPath.includes("/endpoints/")
    ) {
      layers.api.push(path);
    } else if (
      lowerPath.includes("/components/") ||
      lowerPath.includes("/pages/") ||
      lowerPath.includes("/views/") ||
      lowerPath.includes("/ui/") ||
      lowerPath.includes("/client/") ||
      lowerPath.endsWith(".jsx") ||
      lowerPath.endsWith(".tsx")
    ) {
      layers.frontend.push(path);
    } else if (
      lowerPath.includes("/models/") ||
      lowerPath.includes("/schema/") ||
      lowerPath.includes("/database/") ||
      lowerPath.includes("/db/")
    ) {
      layers.database.push(path);
    } else {
      layers.backend.push(path);
    }
  });

  return layers;
}
