/**
 * Guards against crawler / markdown-link traps that invent deeply nested
 * bogus repo paths (e.g. …/src/a/src/b/src/c or LICENSE/LICENSE/…).
 * Those URLs storm /api/git/file-content and overload Next → nginx 502s.
 */

export const MAX_REPO_PATH_SEGMENTS = 16;
export const MAX_REPO_PATH_CHARS = 260;

/** Extensionless names that are almost always files, not folders. */
export const EXTENSIONLESS_REPO_FILE_NAMES = new Set(
  [
    "license",
    "licence",
    "copying",
    "makefile",
    "dockerfile",
    "changelog",
    "contributing",
    "authors",
    "notice",
    "readme",
    "gemfile",
    "rakefile",
    "procfile",
    "vagrantfile",
  ].map((s) => s.toLowerCase())
);

const FILE_EXT_RE =
  /\.(md|mdx|txt|ts|tsx|js|jsx|json|ya?ml|toml|xml|html?|css|scss|svg|png|jpe?g|gif|webp|pdf|rs|go|py|sh|bash|zsh|lock|gitignore|c|h|cpp|hpp|java|kt|swift|rb|php|sql|wasm|bin|exe|dll|so|dylib|zip|tar|gz|tgz|bz2|xz|7z|deb|rpm|apk|aab|dmg|iso|ico|woff2?|ttf|otf|eot|mp[34]|webm|mov|avi|mkv)$/i;

export function normalizeRepoPathSegments(path: string): string[] {
  if (!path) return [];
  const segments = path.replace(/\\/g, "/").trim().split("/");
  const stack: string[] = [];
  for (const segment of segments) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      stack.pop();
    } else {
      stack.push(segment);
    }
  }
  return stack;
}

export function looksLikeRepoFileName(segment: string): boolean {
  if (!segment) return false;
  if (FILE_EXT_RE.test(segment)) return true;
  const base = segment.split("/").pop() || segment;
  return EXTENSIONLESS_REPO_FILE_NAMES.has(base.toLowerCase());
}

/**
 * True when a path looks like a markdown-relative join loop or is absurdly deep.
 * Used by markdown href resolution, Code-tab navigation, and file-content APIs.
 */
export function isAbsurdRepoPath(path: string): boolean {
  if (!path || typeof path !== "string") return true;
  const cleaned = path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!cleaned) return false;
  if (cleaned.length > MAX_REPO_PATH_CHARS) return true;
  if (cleaned.includes("\0") || cleaned.includes("//")) return true;
  const segments = normalizeRepoPathSegments(cleaned);
  if (segments.length > MAX_REPO_PATH_SEGMENTS) return true;

  for (let i = 1; i < segments.length; i++) {
    if (segments[i]!.toLowerCase() === segments[i - 1]!.toLowerCase()) {
      return true;
    }
  }

  // Motif: …/src/<x>/src/<y>/src/<z> (common crawler nest from root README fallback)
  let srcHops = 0;
  for (let i = 0; i < segments.length - 1; i++) {
    if (segments[i]!.toLowerCase() === "src") srcHops += 1;
  }
  if (srcHops >= 3) return true;

  // Same for docs/…/docs/…/docs/
  let docsHops = 0;
  for (const seg of segments) {
    if (seg.toLowerCase() === "docs") docsHops += 1;
  }
  if (docsHops >= 3) return true;

  return false;
}

/** Normalize + reject absurd paths. Returns null when unsafe. */
export function sanitizeRepoNavPath(path: string): string | null {
  if (!path || typeof path !== "string") return null;
  if (path.includes("..") || path.includes("\0")) return null;
  const segments = normalizeRepoPathSegments(path);
  const joined = segments.join("/");
  if (!joined) return "";
  if (isAbsurdRepoPath(joined)) return null;
  return joined;
}
