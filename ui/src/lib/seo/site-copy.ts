/** Default site title (also used in Open Graph / Twitter). */
export const SITE_TITLE_DEFAULT =
  "gittr — Nostr git hosting, issues, PRs & Lightning bounties";

/** ~155 chars — good for Google snippets and social cards. */
export const SITE_DESCRIPTION_DEFAULT =
  "Host git on Nostr. Mirror repos to relays, run issues and PRs as signed events, publish Pages, discover Nostr apps, and fund work with Lightning bounties.";

/** Hub routes: keep these distinct from the homepage card so Telegram/X previews match the link. */
export const APPS_DESCRIPTION =
  "Discover Nostr apps (NIP-82 / Zapstore): Android installers and software announced from git repos. Browse apps on Nostr git, not a clone page.";

export const PAGES_DESCRIPTION =
  "Published static sites on Nostr (gittr Pages / nsite) — open each site on pages.gittr.space. Separate from git clone and the Apps catalog.";

export const LAB_DESCRIPTION =
  "Snapshot of an agent that maps ecosystem dependencies and their security, starting from gittr as the seed repo. Run local-agent yourself from the linked repo.";

export const EXPLORE_DESCRIPTION =
  "Explore public Nostr git repositories (NIP-34). Browse git on Nostr — clone hosts, issues, pull requests, and Lightning bounties.";

export const NEW_DESCRIPTION =
  "Create a repository on Nostr git, or batch-import and mirror repos from GitHub, GitLab, Codeberg, and other foreign git sources onto gittr.";

export const HELP_DESCRIPTION =
  "Help for gittr — Nostr git hosting. Mirror repos, clone over SSH or HTTPS, run issues and PRs, publish Pages, list apps, and pay Lightning bounties.";

export const NOSTR_GIT_DESCRIPTION =
  "What is Nostr git? NIP-34 publishes repos, issues, and pull requests as signed events. gittr is web hosting for git on Nostr, with clone servers, Pages, and apps.";

export const BOUNTY_HUNT_DESCRIPTION =
  "Lightning bounties on Nostr git issues. Hunt open gittr bounties and get paid in sats when a pull request is merged.";

export const ISSUES_DESCRIPTION =
  "Issues on Nostr git — signed tickets across public gittr repositories (NIP-34 / NIP-22 comments).";

export const PULLS_DESCRIPTION =
  "Pull requests on Nostr git — signed patches and reviews across public gittr repositories.";

export const SITE_KEYWORDS = [
  "nostr git",
  "git on nostr",
  "nostr git hosting",
  "NIP-34",
  "GRASP",
  "git hosting",
  "mirror repository",
  "git collaboration",
  "Lightning bounties",
  "nostr pages",
  "nostr apps",
  "decentralized git",
  "git over nostr",
  "issue bounties",
] as const;

export function buildRepoFallbackDescription(
  entity: string,
  repo: string
): string {
  return `Repository ${entity}/${repo} on gittr — Nostr git hosting with issues, pull requests, and optional Lightning bounties.`;
}

export function buildSoftwareAppDescription(
  name: string,
  appId: string,
  summary?: string
): string {
  const about = (summary || "").trim();
  if (about) {
    return about.length > 155 ? `${about.slice(0, 152)}...` : about;
  }
  return `${name} (${appId}) — a Nostr app listed on gittr. Browse the NIP-82 catalog, releases, and linked git repo.`;
}
