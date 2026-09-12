/**
 * Which repo paths belong on a Nostr Page (Blossom + kind 35128).
 * Keep helper-tools snippets (`.ts` / `.tsx` next to index.html). Skip forge
 * trees so the gittr monorepo does not upload `ui/` as a Page.
 */

function normalizePath(path: string): string {
  return String(path || "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/^\/+/, "")
    .trim();
}

const SKIP_PATH_PREFIXES = [
  "node_modules/",
  ".git/",
  "dist/",
  "build/",
  ".next/",
  "target/",
  "__tests__/",
  "coverage/",
  "ui/",
  "android-app/",
  "infra/",
  "scripts/",
  "data/",
  "_local-only-backup/",
  "_hetzner_backup/",
  ".github/",
];

const SKIP_PATH_SEGMENTS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "target",
  "coverage",
  "__tests__",
  "vendor",
  ".turbo",
]);

const STATIC_EXT = new Set([
  ".html",
  ".htm",
  ".css",
  ".js",
  ".mjs",
  ".json",
  ".txt",
  ".md",
  ".ts",
  ".tsx",
  ".svg",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".map",
  ".xml",
  ".webmanifest",
  ".wasm",
]);

function extOf(path: string): string {
  const i = path.lastIndexOf(".");
  return i >= 0 ? path.slice(i).toLowerCase() : "";
}

export function isGittrPagesManifestPath(path: string): boolean {
  const n = normalizePath(path).toLowerCase();
  if (!n) return false;
  for (const p of SKIP_PATH_PREFIXES) {
    if (n.startsWith(p)) return false;
  }
  const segments = n.split("/").filter(Boolean);
  for (const seg of segments) {
    if (SKIP_PATH_SEGMENTS.has(seg)) return false;
  }
  const ext = extOf(n);
  if (ext && STATIC_EXT.has(ext)) return true;
  return n === "robots.txt" || n.endsWith("/robots.txt");
}
