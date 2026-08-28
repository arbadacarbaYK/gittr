/**
 * Guards against crawler / markdown-link traps that invent deeply nested
 * bogus repo paths (e.g. …/src/a/src/b/src/c, nips/…/nips/…/nips, LICENSE/LICENSE).
 * Those URLs storm repo pages + file APIs and can wedge Next → Cloudflare 504.
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

  // Same folder name 3+ times (nips/…/nips/…/nips, contributions/…, src/…).
  // Special-casing only src/docs missed the nostrc crawler storm that wedged prod.
  const hopCounts = new Map<string, number>();
  for (const seg of segments) {
    const key = seg.toLowerCase();
    const next = (hopCounts.get(key) ?? 0) + 1;
    if (next >= 3) return true;
    hopCounts.set(key, next);
  }

  return false;
}

/** True when ?path= or ?file= looks like a crawler nest. */
export function searchParamsHaveAbsurdRepoPath(
  searchParams: {
    get(name: string): string | null;
  } | null
): boolean {
  if (!searchParams) return false;
  for (const key of ["path", "file"] as const) {
    const value = searchParams.get(key);
    if (value && isAbsurdRepoPath(value)) return true;
  }
  return false;
}

/** generateMetadata searchParams (string | string[]). */
export function recordHasAbsurdRepoNav(
  record: Record<string, string | string[] | undefined> | undefined
): boolean {
  if (!record) return false;
  for (const key of ["path", "file"] as const) {
    const raw = record[key];
    const value =
      typeof raw === "string" ? raw : Array.isArray(raw) ? raw[0] : undefined;
    if (value && isAbsurdRepoPath(value)) return true;
  }
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
