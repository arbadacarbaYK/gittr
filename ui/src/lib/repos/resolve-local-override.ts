/**
 * Resolve unpushed override bodies for display.
 * localStorage may hold `__gittr_idb__:mime` pointers for large/binary drafts.
 */
import {
  idbGetOverride,
  isOverrideIdbMarker,
  peekOverrideBlob,
} from "./overrides-idb";
import { normalizeRepoRelPath } from "./resolve-readme-markdown-image";
import { loadRepoOverrides } from "./storage";

function pickRaw(
  overrides: Record<string, string>,
  path: string
): { key: string; value: string } | null {
  const candidates = [
    path,
    normalizeRepoRelPath(path),
    path.replace(/^\/+/, ""),
  ].filter(Boolean);
  for (const key of candidates) {
    const value = overrides[key];
    if (typeof value === "string" && value.length > 0) {
      return { key, value };
    }
  }
  const lower = normalizeRepoRelPath(path).toLowerCase();
  for (const [key, value] of Object.entries(overrides)) {
    if (
      typeof value === "string" &&
      value.length > 0 &&
      normalizeRepoRelPath(key).toLowerCase() === lower
    ) {
      return { key, value };
    }
  }
  return null;
}

/**
 * Return the real override body (UTF-8 text or base64 for binaries).
 * Never returns an `__gittr_idb__:` pointer.
 */
export async function resolveLocalOverrideBody(
  entity: string,
  repo: string,
  path: string
): Promise<string | null> {
  if (!entity || !repo || !path) return null;
  const overrides = loadRepoOverrides(entity, repo);
  const picked = pickRaw(overrides, path);
  const norm = normalizeRepoRelPath(path) || path;

  if (!picked) {
    return (
      peekOverrideBlob(entity, repo, norm) ||
      peekOverrideBlob(entity, repo, path) ||
      (await idbGetOverride(entity, repo, norm)) ||
      (await idbGetOverride(entity, repo, path))
    );
  }

  if (!isOverrideIdbMarker(picked.value)) {
    return picked.value;
  }

  return (
    peekOverrideBlob(entity, repo, picked.key) ||
    peekOverrideBlob(entity, repo, norm) ||
    peekOverrideBlob(entity, repo, path) ||
    (await idbGetOverride(entity, repo, picked.key)) ||
    (await idbGetOverride(entity, repo, norm)) ||
    (await idbGetOverride(entity, repo, path))
  );
}

export { mimeForOverrideStorage } from "./overrides-idb";
