/**
 * Load every known `.gitignore` body for a repo from browser storage
 * (localStorage pointers + IndexedDB drafts + file-index content).
 */
import type { ExistingGitignoreBody } from "./gitignore-upload-filter";
import { resolveLocalOverrideBody } from "./resolve-local-override";
import { loadRepoFiles, loadRepoOverrides } from "./storage";

function isGitignoreFilePath(path: string): boolean {
  const clean = path.replace(/^\/+/, "");
  const base = clean.split("/").pop();
  return base === ".gitignore" && !clean.startsWith(".git/");
}

/**
 * Collect existing `.gitignore` contents so Upload can apply them when the
 * staged batch has no (or only nested) ignore files. Upload-batch bodies for
 * the same path should be passed separately and win via mergeGitignoreBodies.
 */
export async function loadExistingGitignoreBodies(
  entity: string,
  repo: string
): Promise<ExistingGitignoreBody[]> {
  if (typeof window === "undefined" || !entity || !repo) return [];

  const pathSet = new Set<string>();
  for (const f of loadRepoFiles(entity, repo)) {
    const p = (f.path || "").replace(/^\/+/, "");
    if (p && isGitignoreFilePath(p)) pathSet.add(p);
  }
  for (const key of Object.keys(loadRepoOverrides(entity, repo))) {
    const p = key.replace(/^\/+/, "");
    if (p && isGitignoreFilePath(p)) pathSet.add(p);
  }

  const out: ExistingGitignoreBody[] = [];
  for (const path of [...pathSet].sort()) {
    try {
      const content = await resolveLocalOverrideBody(entity, repo, path);
      if (typeof content === "string" && content.length > 0) {
        out.push({ path, content });
      }
    } catch {
      /* skip unreadable */
    }
  }
  return out;
}
