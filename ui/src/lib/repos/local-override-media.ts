/**
 * Prefer unpushed local overrides for in-repo media (gif/png/…) so Upload
 * overwrites show before Push. README and file viewers historically always hit
 * forge/bridge tip and looked like media "wasn't stored locally".
 */

import { isBinaryFile, loadRepoOverrides } from "./storage";
import {
  mimeForRepoImagePath,
  normalizeRepoRelPath,
} from "./resolve-readme-markdown-image";

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
    const content = pickOverrideContent(overrides, path);
    if (!content) return null;
    if (content.startsWith("data:") || content.startsWith("blob:")) {
      return content;
    }
    const normalized = normalizeRepoRelPath(path) || path;
    if (isBinaryFile(normalized)) {
      const mime = mimeForRepoImagePath(normalized);
      if (
        mime === "image/svg+xml" &&
        !/^[A-Za-z0-9+/=\s]+$/.test(content.slice(0, 80))
      ) {
        // SVG stored as text
        return `data:${mime};charset=utf-8,${encodeURIComponent(content)}`;
      }
      return `data:${mime};base64,${content.replace(/\s/g, "")}`;
    }
    return content;
  } catch {
    return null;
  }
}
