/**
 * Prefer unpushed local overrides for in-repo media (gif/png/…) so Upload
 * overwrites show before Push. Large/binary bodies may live in IndexedDB
 * (pointer in localStorage); memory cache is filled on upload + hydrate.
 */
import {
  isOverrideIdbMarker,
  mimeFromOverrideIdbMarker,
  peekOverrideBlob,
} from "./overrides-idb";
import {
  mimeForRepoImagePath,
  normalizeRepoRelPath,
} from "./resolve-readme-markdown-image";
import { isBinaryFile, loadRepoOverrides } from "./storage";

function pickOverrideContent(
  overrides: Record<string, string>,
  path: string
): string | null {
  const candidates = [
    path,
    normalizeRepoRelPath(path),
    path.replace(/^\/+/, ""),
  ].filter(Boolean);
  for (const key of candidates) {
    const value = overrides[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  // Case-insensitive fallback (folder picks sometimes differ in casing)
  const lower = normalizeRepoRelPath(path).toLowerCase();
  for (const [key, value] of Object.entries(overrides)) {
    if (
      typeof value === "string" &&
      value.length > 0 &&
      normalizeRepoRelPath(key).toLowerCase() === lower
    ) {
      return value;
    }
  }
  return null;
}

function toDisplayUrl(
  path: string,
  content: string,
  mimeHint?: string
): string {
  if (content.startsWith("data:") || content.startsWith("blob:")) {
    return content;
  }
  const normalized = normalizeRepoRelPath(path) || path;
  // Text paths must stay UTF-8 — never base64-wrap from a stale octet-stream marker.
  if (!isBinaryFile(normalized)) {
    return content;
  }
  const mime =
    (mimeHint && mimeHint !== "application/octet-stream" && mimeHint !== "file"
      ? mimeHint
      : null) ||
    mimeForRepoImagePath(normalized) ||
    "application/octet-stream";
  if (
    mime === "image/svg+xml" &&
    !/^[A-Za-z0-9+/=\s]+$/.test(content.slice(0, 80))
  ) {
    return `data:${mime};charset=utf-8,${encodeURIComponent(content)}`;
  }
  return `data:${mime};base64,${content.replace(/\s/g, "")}`;
}

/**
 * If the browser has an unpushed override for this path, return a displayable
 * URL (data: for binaries, raw text for svg text, etc.). Null = fall through
 * to forge/bridge.
 */
export function localOverrideDisplayUrl(
  entity: string,
  repo: string,
  path: string
): string | null {
  if (!entity || !repo || !path) return null;
  try {
    const overrides = loadRepoOverrides(entity, repo);
    const raw = pickOverrideContent(overrides, path);
    if (!raw) {
      // IDB-only memory (pointer not yet written / wiped)
      const mem = peekOverrideBlob(
        entity,
        repo,
        normalizeRepoRelPath(path) || path
      );
      if (mem) return toDisplayUrl(path, mem);
      return null;
    }
    if (isOverrideIdbMarker(raw)) {
      const mem =
        peekOverrideBlob(entity, repo, normalizeRepoRelPath(path) || path) ||
        peekOverrideBlob(entity, repo, path);
      if (!mem) return null;
      return toDisplayUrl(path, mem, mimeFromOverrideIdbMarker(raw));
    }
    return toDisplayUrl(path, raw);
  } catch {
    return null;
  }
}
