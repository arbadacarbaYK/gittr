import { normalizeFilePath } from "@/lib/repos/storage";

function extOf(path: string): string {
  const n = normalizeFilePath(path);
  const i = n.lastIndexOf(".");
  return i >= 0 ? n.slice(i).toLowerCase() : "";
}

function utf8DecodeStrict(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function trimBom(s: string): string {
  if (s.length && s.charCodeAt(0) === 0xfeff) return s.slice(1);
  return s;
}

/** Heuristic: inner payload is likely JS/TS source, not a short JSON string literal. */
function looksLikeJavaScriptOrModuleText(s: string): boolean {
  if (s.length < 8) return false;
  return /(?:^|\n|;|\)\s*)\s*(?:\/\/|\/\*|import\s|export\s|function\b|class\b|const\b|let\b|var\b|console\.|await\b|async\b|\(function)/m.test(
    s
  );
}

/**
 * Some browsers/storage paths end up with `JSON.stringify(source)` as the stored "file"
 * (valid JSON document whose root is a string). Blossom then sniffs JSON while we send
 * `text/javascript` → 400 "expected application/json". Unwrap to raw source bytes.
 */
export function unwrapJsonEncodedUtf8ArtifactIfNeeded(
  filePath: string,
  bytes: Uint8Array
): Uint8Array {
  const ext = extOf(filePath);
  if (ext !== ".js" && ext !== ".mjs" && ext !== ".cjs") return bytes;
  const text = utf8DecodeStrict(bytes);
  if (!text) return bytes;
  const trimmed = trimBom(text).trim();
  // JSON.stringify(script) produces a JSON document whose first non-whitespace char is ".
  if (!trimmed.startsWith('"')) return bytes;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return bytes;
  }
  if (typeof parsed !== "string" || parsed.length < 8) return bytes;
  if (!looksLikeJavaScriptOrModuleText(parsed)) return bytes;
  return new TextEncoder().encode(parsed);
}

/** True when the whole buffer is one JSON value (object, array, string, number, bool, null). */
export function isStrictJsonUtf8Document(bytes: Uint8Array): boolean {
  const text = utf8DecodeStrict(bytes);
  if (!text) return false;
  const t = trimBom(text).trim();
  if (!t) return false;
  try {
    JSON.parse(t);
    return true;
  } catch {
    return false;
  }
}

/**
 * Content-Type for upstream Blossom PUT. Hosts (e.g. nostr.build) validate MIME against
 * sniffed bytes: JSON bodies must use application/json; real scripts use application/javascript.
 */
export function manifestUploadContentType(
  filePath: string,
  bytes: Uint8Array
): string {
  if (isStrictJsonUtf8Document(bytes)) {
    return "application/json";
  }
  return guessManifestFileContentType(filePath);
}

/**
 * Align declared Content-Type with sniffed bytes (nostr.build validates both match).
 * Call with the same sanitized MIME as upstream fetch (e.g. after upstreamContentType()).
 */
export function reconcileBlossomUpstreamContentType(
  sanitizedMime: string,
  bytes: Uint8Array
): string {
  const head = sanitizedMime.split(";")[0];
  const main = (head ?? "").trim().toLowerCase();
  if (isStrictJsonUtf8Document(bytes)) {
    if (
      main === "text/javascript" ||
      main === "application/javascript" ||
      main === "text/ecmascript"
    ) {
      return "application/json";
    }
    return sanitizedMime;
  }
  const text = utf8DecodeStrict(bytes);
  if (
    text &&
    (main === "application/json" || main === "text/json") &&
    looksLikeJavaScriptOrModuleText(text)
  ) {
    return "application/javascript; charset=utf-8";
  }
  return sanitizedMime;
}

/**
 * Path-based MIME fallback (after JSON sniff misses).
 * Use application/javascript for .js (IANA / libmagic), not legacy text/javascript.
 */
export function guessManifestFileContentType(filePath: string): string {
  const n = normalizeFilePath(filePath).toLowerCase();
  if (n === "robots.txt" || n.endsWith("/robots.txt")) {
    return "text/plain; charset=utf-8";
  }
  const ext = extOf(n);
  switch (ext) {
    case ".html":
    case ".htm":
      return "text/html; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
    case ".mjs":
    case ".cjs":
      return "application/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".map":
      return "application/json";
    case ".webmanifest":
      return "application/manifest+json";
    case ".txt":
      return "text/plain; charset=utf-8";
    case ".md":
      return "text/markdown; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".ico":
      return "image/vnd.microsoft.icon";
    case ".woff":
      return "font/woff";
    case ".woff2":
      return "font/woff2";
    case ".ttf":
      return "font/ttf";
    case ".otf":
      return "font/otf";
    case ".xml":
      return "application/xml; charset=utf-8";
    case ".wasm":
      return "application/wasm";
    default:
      return "application/octet-stream";
  }
}
