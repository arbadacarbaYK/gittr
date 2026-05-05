import { validateReadmeGittrPagesBlock } from "@/lib/gittr-pages/readme-section";

/** True when the repo tree has a root entry file for static Pages. */
export function hasGittrPagesEntryFile(
  files: Array<{ path?: string }> | undefined
): boolean {
  if (!files?.length) return false;
  return files.some((f) => {
    const p = (f.path || "")
      .replace(/^[./]+/, "")
      .replace(/^\//, "")
      .trim()
      .toLowerCase();
    // Root-level only: nested docs/site index files must not unlock Pages actions.
    if (!p || p.includes("/")) return false;
    return p === "index.html" || p === "404.html" || p === "index.md";
  });
}

export type GittrPagesReadinessCore = {
  files?: Array<{ path?: string }>;
  readme: string;
  autoReadmeOnPush: boolean;
  namedUrl: string;
};

/** README block valid or auto-maintain on push; site has entry file. */
export function gittrPagesPushPreconditionsMet(
  r: GittrPagesReadinessCore
): boolean {
  const readmeOk =
    r.autoReadmeOnPush ||
    validateReadmeGittrPagesBlock(r.readme, r.namedUrl).ok;
  const siteOk = hasGittrPagesEntryFile(r.files);
  return readmeOk && siteOk;
}
