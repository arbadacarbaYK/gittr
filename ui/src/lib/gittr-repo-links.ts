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
  return `${GITTR_OWNER_BASE}/${repo}?file=${encodeURIComponent(
    file
  )}&branch=${branch}`;
}

export const GITTR_REPO_GITTR = gittrRepoBrowse("gittr");
export const GITTR_REPO_GITNOSTR = gittrRepoBrowse("gitnostr");
export const GITTR_REPO_HELPER_TOOLS = gittrRepoBrowse("gittr-helper-tools");
export const GITTR_REPO_NSITE_GATEWAY = gittrRepoBrowse("nsite-gateway");

/** Pages / Apps blob host (not a gittr git repo). */
export const GITTR_BLOSSOM_ORIGIN = "https://blossom.gittr.space";

/** Upstream nsite-gateway we forked/adapted (hzrd146). */
export const HZRD146_NSITE_GATEWAY =
  "https://gittr.space/npub1ye5ptcxfyyxl5vjvdjar2ua3f0hynkjzpx552mu5snj3qmx5pzjscpknpr/nsite-gateway";

/** Zapstore on gittr — Android app catalog / publish flow companion. */
export const ZAPSTORE_ON_GITTR =
  "https://gittr.space/npub10r8xl2njyepcw2zwv3a6dyufj4e4ajx86hz6v4ehu4gnpupxxp7stjt2p8/zapstore";

export const ZAPSTORE_PUBLISH_DOCS = "https://zapstore.dev/docs/publish";

export const GITTR_DOC_GITNOSTR_ARCHITECTURE = gittrRepoFile(
  "gitnostr",
  "docs/ARCHITECTURE.md"
);
export const GITTR_DOC_FILE_FETCHING = gittrRepoFile(
  "gittr",
  "docs/FILE_FETCHING_INSIGHTS.md"
);
export const GITTR_DOC_SSH_GIT = gittrRepoFile(
  "gittr",
  "docs/SSH_GIT_GUIDE.md"
);
export const GITTR_DOC_GITNOSTR_SSH = gittrRepoFile(
  "gitnostr",
  "SSH_GIT_GUIDE.md"
);
