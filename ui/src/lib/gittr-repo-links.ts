/** Operator repos on gittr — canonical browse URLs (see docs/gittr-repo-links.md). */
export const GITTR_OWNER_NPUB =
  "npub1n2ph08n4pqz4d3jk6n2p35p2f4ldhc5g5tu7dhftfpueajf4rpxqfjhzmc";

const GITTR_OWNER_BASE = `https://gittr.space/${GITTR_OWNER_NPUB}`;

export function gittrRepoBrowse(repo: string, branch = "main"): string {
  return `${GITTR_OWNER_BASE}/${repo}?branch=${branch}`;
}

export function gittrRepoFile(
  repo: string,
  file: string,
  branch = "main"
): string {
  return `${GITTR_OWNER_BASE}/${repo}?file=${encodeURIComponent(file)}&branch=${branch}`;
}

export const GITTR_REPO_GITTR = gittrRepoBrowse("gittr");
export const GITTR_REPO_GITNOSTR = gittrRepoBrowse("gitnostr");
export const GITTR_REPO_HELPER_TOOLS = gittrRepoBrowse("gittr-helper-tools");
export const GITTR_REPO_NSITE_GATEWAY = gittrRepoBrowse("nsite-gateway");

export const GITTR_DOC_GITNOSTR_ARCHITECTURE = gittrRepoFile(
  "gitnostr",
  "docs/ARCHITECTURE.md"
);
export const GITTR_DOC_FILE_FETCHING = gittrRepoFile(
  "gittr",
  "docs/FILE_FETCHING_INSIGHTS.md"
);
export const GITTR_DOC_SSH_GIT = gittrRepoFile("gittr", "docs/SSH_GIT_GUIDE.md");
export const GITTR_DOC_GITNOSTR_SSH = gittrRepoFile("gitnostr", "SSH_GIT_GUIDE.md");
