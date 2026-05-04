import { normalizeFilePath } from "@/lib/repos/storage";

function extOf(path: string): string {
  const n = normalizeFilePath(path);
  const i = n.lastIndexOf(".");
  return i >= 0 ? n.slice(i).toLowerCase() : "";
}

function utf8DecodeLenient(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
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
  const text = utf8DecodeLenient(bytes);
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

/**
 * File bytes were sometimes pasted as a full **GitHub contents API** JSON object
 * (`{ "encoding": "base64", "content": "..." }`). That is valid JSON; nostr.build
 * then expects `application/json` unless we decode to the real file bytes.
 */
export function unwrapGitHubContentsApiJsonBlob(bytes: Uint8Array): Uint8Array {
  const text = utf8DecodeLenient(bytes);
  const t = trimBom(text).trim();
  if (!t.startsWith("{")) return bytes;
  let o: unknown;
  try {
    o = JSON.parse(t);
  } catch {
    return bytes;
  }
  if (!o || typeof o !== "object" || Array.isArray(o)) return bytes;
  const rec = o as Record<string, unknown>;
  if (rec.type === "dir") return bytes;
  if (rec.encoding !== "base64" || typeof rec.content !== "string") return bytes;
  const raw = rec.content as string;
  if (!raw.length) return bytes;
  try {
    const clean = raw.replace(/\s/g, "");
    const bin = atob(clean);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) {
      out[i] = bin.charCodeAt(i) & 0xff;
    }
    return out.length > 0 ? out : bytes;
  } catch {
    return bytes;
  }
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Undo common double-wrapping (GitHub API JSON → optional JSON.stringify(script))
 * before hashing and uploading to Blossom.
 */
export function normalizeBlossomUploadBytes(
  filePath: string,
  bytes: Uint8Array
): Uint8Array {
  let b = bytes;
  for (let i = 0; i < 6; i++) {
    const step = unwrapJsonEncodedUtf8ArtifactIfNeeded(
      filePath,
      unwrapGitHubContentsApiJsonBlob(b)
    );
    if (sameBytes(step, b)) break;
    b = step;
  }
  return b;
}

/** True when the whole buffer is one JSON value (object, array, string, number, bool, null). */
export function isStrictJsonUtf8Document(bytes: Uint8Array): boolean {
  const text = utf8DecodeLenient(bytes);
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
 * sniffed bytes: JSON bodies must use application/json. Real scripts: use legacy
 * text/javascript — some public Blossoms allowlist that type but return 415 for
 * application/javascript (seen in production after switching away from text/javascript).
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
  const text = utf8DecodeLenient(bytes);
  if (
    text &&
    (main === "application/json" || main === "text/json") &&
    looksLikeJavaScriptOrModuleText(text)
  ) {
    return "text/javascript";
  }
  // nostr.build: allowlist often includes text/javascript but rejects application/javascript.
  if (
    text &&
    (main === "application/javascript" || main === "text/ecmascript") &&
    looksLikeJavaScriptOrModuleText(text)
  ) {
    return "text/javascript";
  }
  return sanitizedMime;
}

/**
 * Path-based MIME fallback (after JSON sniff misses).
 * Scripts: text/javascript — matches common Blossom allowlists (nostr.build 415s on application/javascript).
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
      return "text/javascript";
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
