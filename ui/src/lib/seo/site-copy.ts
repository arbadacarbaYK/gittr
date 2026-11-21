/**
 * Homepage picture URL. Telegram caches `/opengraph-image` by path and ignores
 * Next’s `?hash`, so a tagline change must use a path that bot has never fetched.
 */
export const HOME_CARD_PATH = "/og/home-card";

/** Default site title (also used in Open Graph / Twitter). */
export const SITE_TITLE_DEFAULT = "gittr — gits announced to Nostr";

/** ~155 chars — good for Google snippets and social cards. */
export const SITE_DESCRIPTION_DEFAULT =
  "Announce gits to Nostr from any forge and make them discoverable in one place — issues, pull requests, pages, apps, and bounties.";

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

/** ~155 chars. Plain language: why the page exists. Protocol names stay in the page body. */
export const NOSTR_GIT_DESCRIPTION =
  "GitHub can go down or take a repo offline. A home git server is hard to find. Nostr git keeps your repos, pages, and apps findable, backed up, and yours.";

/**
 * Visible on /nostr-git and copied into FAQPage JSON-LD.
 * Answers stay in everyday language; NIP names live in the page’s developer section.
 */
export const NOSTR_GIT_FAQ: readonly { name: string; text: string }[] = [
  {
    name: "Why is Nostr git needed?",
    text: "Big git hosts go down, and they can take a repository offline. When that happens the code, the issues, and the project page disappear together. Nostr git keeps the project findable in every compatible client, with a copy written to Nostr git servers on each push.",
  },
  {
    name: "Why isn't a Forgejo or Gitea server enough?",
    text: "A Forgejo or Gitea server you run yourself keeps the files on hardware you control. It does not put the project on a map other people can search, and visitors have no public way to support the person who built it.",
  },
  {
    name: "How can I tell an app is really from someone I trust?",
    text: "App stores do not show your web of trust. On Nostr, a logged-in visitor sees how close the author is to people they already follow, and the listing links back to the repository so the app can be checked against the code. No central store has to approve the listing.",
  },
  {
    name: "If I use gittr, is my project stuck on gittr?",
    text: "Repos, pages, and apps stay visible in any Nostr git, pages, or apps client. The same Nostr key opens them everywhere. gittr is one of those clients, and the software is free and open source.",
  },
];

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
