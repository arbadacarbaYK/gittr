/**
 * Utility functions to parse dependencies from code files
 * Supports: JavaScript/TypeScript, Python, Go, Rust, Java, etc.
 */

export interface Dependency {
  from: string; // File path
  to: string; // Imported module/file path
  type: "import" | "require" | "from" | "include" | "use";
  line?: number;
}

/**
 * Parse dependencies from a file's content
 */
export function parseDependencies(
  filePath: string,
  content: string
): Dependency[] {
  const ext = filePath.split(".").pop()?.toLowerCase() || "";
  const deps: Dependency[] = [];

  const lines = content.split("\n");

  switch (ext) {
    case "js":
    case "jsx":
    case "ts":
    case "tsx":
      return parseJavaScriptDependencies(filePath, lines);
    case "py":
      return parsePythonDependencies(filePath, lines);
    case "go":
      return parseGoDependencies(filePath, lines);
    case "rs":
      return parseRustDependencies(filePath, lines);
    case "java":
      return parseJavaDependencies(filePath, lines);
    case "php":
      return parsePhpDependencies(filePath, lines);
    case "rb":
      return parseRubyDependencies(filePath, lines);
    default:
      return [];
  }
}

/**
 * Parse JavaScript/TypeScript imports
 * Supports: import, require, export from
 */
function parseJavaScriptDependencies(
  filePath: string,
  lines: string[]
): Dependency[] {
  const deps: Dependency[] = [];

  lines.forEach((line, index) => {
    const trimmed = line.trim();

    // ES6 import: import x from 'y'
    // Match various import patterns: default, named, namespace, mixed
    const importMatch = trimmed.match(
      /^import\s+(?:(?:\*\s+as\s+\w+)|(?:\{[^}]*\})|(?:\w+)|(?:\w+\s*,\s*\{[^}]*\})|(?:\{[^}]*\}\s*,\s*\w+))\s+from\s+['"]([^'"]+)['"]/
    );
    if (importMatch && importMatch[1]) {
      deps.push({
        from: filePath,
        to: importMatch[1],
        type: "import",
        line: index + 1,
      });
    }
    
    // Also match: import 'module' (side-effect imports)
    const sideEffectImportMatch = trimmed.match(/^import\s+['"]([^'"]+)['"]/);
    if (sideEffectImportMatch && sideEffectImportMatch[1] && !importMatch) {
      deps.push({
        from: filePath,
        to: sideEffectImportMatch[1],
        type: "import",
        line: index + 1,
      });
    }

    // require: const x = require('y')
    const requireMatch = trimmed.match(/require\(['"]([^'"]+)['"]\)/);
    if (requireMatch) {
      deps.push({
        from: filePath,
        to: requireMatch[1] || "",
        type: "require",
        line: index + 1,
      });
    }

    // Dynamic import: import('y')
    const dynamicImportMatch = trimmed.match(/import\(['"]([^'"]+)['"]\)/);
    if (dynamicImportMatch) {
      deps.push({
        from: filePath,
        to: dynamicImportMatch[1] || "",
        type: "import",
        line: index + 1,
      });
    }
  });

  return deps;
}

/**
 * Parse Python imports
 */
function parsePythonDependencies(
  filePath: string,
  lines: string[]
): Dependency[] {
  const deps: Dependency[] = [];

  lines.forEach((line, index) => {
    const trimmed = line.trim();

    // import x
    // from x import y
    const importMatch = trimmed.match(/^(?:from\s+)?([\w.]+)\s+import|import\s+([\w.]+)/);
    if (importMatch) {
      const module = importMatch[1] || importMatch[2] || "";
      if (module && !module.startsWith(".")) {
        // Skip relative imports for now
        deps.push({
          from: filePath,
          to: module,
          type: "from",
          line: index + 1,
        });
      }
    }
  });

  return deps;
}

/**
 * Parse Go imports
 */
function parseGoDependencies(filePath: string, lines: string[]): Dependency[] {
  const deps: Dependency[] = [];

  let inImportBlock = false;
  lines.forEach((line, index) => {
    const trimmed = line.trim();

    if (trimmed === "import (") {
      inImportBlock = true;
      return;
    }
    if (inImportBlock && trimmed === ")") {
      inImportBlock = false;
      return;
    }

    // import "package"
    // import alias "package"
    const importMatch = trimmed.match(/^import\s+(?:\w+\s+)?['"]([^'"]+)['"]/);
    if (importMatch) {
      deps.push({
        from: filePath,
        to: importMatch[1] || "",
        type: "import",
        line: index + 1,
      });
    }

    if (inImportBlock) {
      const blockImportMatch = trimmed.match(/['"]([^'"]+)['"]/);
      if (blockImportMatch) {
        deps.push({
          from: filePath,
          to: blockImportMatch[1] || "",
          type: "import",
          line: index + 1,
        });
      }
    }
  });

  return deps;
}

/**
 * Parse Rust imports
 */
function parseRustDependencies(
  filePath: string,
  lines: string[]
): Dependency[] {
  const deps: Dependency[] = [];

  lines.forEach((line, index) => {
    const trimmed = line.trim();

    // use package::module
    // use crate::module
    const useMatch = trimmed.match(/^use\s+([\w:]+)/);
    if (useMatch) {
      deps.push({
        from: filePath,
        to: useMatch[1] || "",
        type: "use",
        line: index + 1,
      });
    }
  });

  return deps;
}

/**
 * Parse Java imports
 */
function parseJavaDependencies(
  filePath: string,
  lines: string[]
): Dependency[] {
  const deps: Dependency[] = [];

  lines.forEach((line, index) => {
    const trimmed = line.trim();

    // import package.Class
    const importMatch = trimmed.match(/^import\s+(?:static\s+)?([\w.]+)/);
    if (importMatch) {
      deps.push({
        from: filePath,
        to: importMatch[1] || "",
        type: "import",
        line: index + 1,
      });
    }
  });

  return deps;
}

/**
 * Parse PHP imports
 */
function parsePhpDependencies(
  filePath: string,
  lines: string[]
): Dependency[] {
  const deps: Dependency[] = [];

  lines.forEach((line, index) => {
    const trimmed = line.trim();

    // require 'file.php'
    // include 'file.php'
    // use Namespace\Class
    const requireMatch = trimmed.match(/(?:require|include)(?:_once)?\s+['"]([^'"]+)['"]/);
    if (requireMatch) {
      deps.push({
        from: filePath,
        to: requireMatch[1] || "",
        type: "include",
        line: index + 1,
      });
    }

    const useMatch = trimmed.match(/^use\s+([\w\\]+)/);
    if (useMatch) {
      deps.push({
        from: filePath,
        to: useMatch[1] || "",
        type: "use",
        line: index + 1,
      });
    }
  });

  return deps;
}

/**
 * Parse Ruby imports
 */
function parseRubyDependencies(
  filePath: string,
  lines: string[]
): Dependency[] {
  const deps: Dependency[] = [];

  lines.forEach((line, index) => {
    const trimmed = line.trim();

    // require 'gem'
    // require_relative 'file'
    const requireMatch = trimmed.match(/^require(?:_relative)?\s+['"]([^'"]+)['"]/);
    if (requireMatch) {
      deps.push({
        from: filePath,
        to: requireMatch[1] || "",
        type: "require",
        line: index + 1,
      });
    }
  });

  return deps;
}

/**
 * Resolve relative imports to absolute paths
 */
export function resolveImportPath(
  importPath: string,
  fromFile: string,
  allFiles: string[]
): string | null {
  // If it's already an absolute path or external package, return as-is
  if (importPath.startsWith("/") || !importPath.startsWith(".")) {
    // Try to find matching file
    const matches = allFiles.filter((f) => {
      const baseName = f.split("/").pop()?.replace(/\.[^.]+$/, "") || "";
      return f.includes(importPath) || baseName === importPath;
    });
    return matches[0] || null;
  }

  // Handle relative imports
  const fromDir = fromFile.substring(0, fromFile.lastIndexOf("/"));
  const resolved = fromDir + "/" + importPath.replace(/^\.\//, "");

  // Try exact match
  if (allFiles.includes(resolved)) {
    return resolved;
  }

  // Try with common extensions
  const extensions = [".js", ".ts", ".jsx", ".tsx", ".json"];
  for (const ext of extensions) {
    const withExt = resolved + ext;
    if (allFiles.includes(withExt)) {
      return withExt;
    }
  }

  // Try index files
  for (const ext of extensions) {
    const indexFile = resolved + "/index" + ext;
    if (allFiles.includes(indexFile)) {
      return indexFile;
    }
  }

  return null;
}

