/** True when the repo tree has a root index.html (same gate as Push Manifest). */
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
    return p === "index.html";
  });
}

export type GittrPagesReadinessCore = {
  files?: Array<{ path?: string }>;
  readme: string;
  autoReadmeOnPush: boolean;
  namedUrl: string;
};

/** Homepage file is required. A README pagelink is optional. */
export function gittrPagesPushPreconditionsMet(
  r: GittrPagesReadinessCore
): boolean {
  return hasGittrPagesEntryFile(r.files);
}
