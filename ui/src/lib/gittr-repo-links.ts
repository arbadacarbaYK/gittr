import { pubkeyHexToPubkeyB36 } from "./nsite/pubkey-base36";

/** Operator repos on gittr — canonical browse URLs (see docs/gittr-repo-links.md). */
export const GITTR_OWNER_NPUB =
  "npub1n2ph08n4pqz4d3jk6n2p35p2f4ldhc5g5tu7dhftfpueajf4rpxqfjhzmc";

/** Same identity as {@link GITTR_OWNER_NPUB} (kind-0 / NIP-5A author). */
export const GITTR_OWNER_PUBKEY_HEX =
  "9a83779e75080556c656d4d418d02a4d7edbe288a2f9e6dd2b48799ec935184c";

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
export const GITTR_REPO_PYRAMID = gittrRepoBrowse("pyramid");
export const GITTR_REPO_MCP = gittrRepoBrowse("gittr-mcp");

/** Pages nsite blob host — never pin Apps / APKs here. */
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

/**
 * Public NIP-5A `d` tags for platform repos (1–13 chars). Repo slugs like
 * `gittr-helper-tools` cannot be the Pages name as-is.
 */
export const GITTR_PAGES_CANONICAL_D_TAGS: Readonly<Record<string, string>> = {
  gittr: "gittr-docu",
  "gittr-helper-tools": "gittr-snips",
  gitnostr: "gitnostr",
  "gittr-mcp": "gittr-mcp",
  pyramid: "pyramid",
  "nsite-gateway": "nsite-gateway",
};

/** Older names still listed on the gateway, matched so Links stay honest. */
export const GITTR_PAGES_ALIAS_D_TAGS: Readonly<
  Record<string, readonly string[]>
> = {
  gittr: ["gittr"],
  "gittr-helper-tools": ["gittr-helper", "helper-tools"],
};

/** Invert canonical + alias Pages names → repo slug (platform map only). */
export function gittrRepoSlugForPagesDTag(dTag: string): string | null {
  const d = dTag.trim().toLowerCase();
  if (!d) return null;
  for (const [repo, canonical] of Object.entries(
    GITTR_PAGES_CANONICAL_D_TAGS
  )) {
    if (canonical.toLowerCase() === d) return repo;
  }
  for (const [repo, aliases] of Object.entries(GITTR_PAGES_ALIAS_D_TAGS)) {
    if (aliases.some((alias) => alias.toLowerCase() === d)) return repo;
  }
  return null;
}

export function gittrOwnerPagesNamedUrl(dTag: string): string {
  const b36 = pubkeyHexToPubkeyB36(GITTR_OWNER_PUBKEY_HEX);
  return `https://${b36}${dTag}.pages.gittr.space/`;
}

/** Docs hub (this repo’s root index.html). */
export const GITTR_PAGES_HUB_URL = gittrOwnerPagesNamedUrl("gittr-docu");

/** Client cookbook (gittr-helper-tools repo). */
export const GITTR_PAGES_SNIPS_URL = gittrOwnerPagesNamedUrl("gittr-snips");

export const GITTR_PAGES_GITNOSTR_URL = gittrOwnerPagesNamedUrl("gitnostr");
export const GITTR_PAGES_MCP_URL = gittrOwnerPagesNamedUrl("gittr-mcp");
export const GITTR_PAGES_NSITE_URL = gittrOwnerPagesNamedUrl("nsite-gateway");
export const GITTR_PAGES_PYRAMID_URL = gittrOwnerPagesNamedUrl("pyramid");
