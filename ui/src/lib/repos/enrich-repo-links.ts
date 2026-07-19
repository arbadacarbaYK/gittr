/**
 * Merge Settings docs links with forge homepage / confirmed Nostr Pages / Apps
 * URLs so Push, import, and refetch keep the sidebar Links section useful.
 *
 * Never invent owner.github.io/repo or *.pages.gittr.space — only real GitHub
 * homepage, Settings links, or a Nostr Pages URL the caller confirmed is live.
 */

export type EnrichableRepoLink = {
  type:
    | "docs"
    | "discord"
    | "slack"
    | "youtube"
    | "twitter"
    | "github"
    | "other";
  url: string;
  label?: string;
};

/** Label used by the old invent path — used to strip dead guessed links. */
export const INVENTED_GITHUB_PAGES_LABEL = "GitHub Pages";

/** Label used when auto-adding a live Nostr Pages URL (and by the invent path). */
export const INVENTED_NOSTR_PAGES_LABEL = "Nostr Pages";

function normalizeUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, "");
}

function urlKey(url: string): string {
  return normalizeUrl(url).toLowerCase();
}

function isGittrPagesHost(url: string): boolean {
  try {
    const host = new URL(url.trim()).hostname.toLowerCase();
    return (
      host === "pages.gittr.space" ||
      host.endsWith(".pages.gittr.space")
    );
  } catch {
    return /pages\.gittr\.space/i.test(url);
  }
}

/** Merge without dupes (by URL). Later entries win on label/type when same URL. */
export function mergeRepoLinks(
  existing: EnrichableRepoLink[] | undefined | null,
  additions: EnrichableRepoLink[]
): EnrichableRepoLink[] {
  const map = new Map<string, EnrichableRepoLink>();
  for (const link of existing || []) {
    if (!link?.url || typeof link.url !== "string") continue;
    const u = link.url.trim();
    if (!u.startsWith("http://") && !u.startsWith("https://")) continue;
    map.set(urlKey(u), { ...link, url: u });
  }
  for (const link of additions) {
    if (!link?.url || typeof link.url !== "string") continue;
    const u = link.url.trim();
    if (!u.startsWith("http://") && !u.startsWith("https://")) continue;
    const key = urlKey(u);
    const prev = map.get(key);
    map.set(key, {
      type: link.type || prev?.type || "other",
      url: u,
      label: link.label?.trim() || prev?.label,
    });
  }
  return Array.from(map.values());
}

/**
 * Derive the conventional GitHub Pages URL from a github.com source URL.
 * Used only to strip previously invented dead links — never to add new ones.
 */
export function guessGithubPagesUrl(sourceUrl?: string | null): string | null {
  if (!sourceUrl || typeof sourceUrl !== "string") return null;
  try {
    const u = new URL(sourceUrl.trim());
    if (!/(^|\.)github\.com$/i.test(u.hostname)) return null;
    const parts = u.pathname.replace(/^\/+|\/+$/g, "").split("/");
    const owner = parts[0];
    const repoPart = parts[1];
    if (!owner || !repoPart) return null;
    const repo = repoPart.replace(/\.git$/i, "");
    if (!repo) return null;
    return `https://${owner}.github.io/${repo}/`;
  } catch {
    return null;
  }
}

/**
 * Drop auto-invented github.io docs links matching the conventional guess.
 * Removes: label "GitHub Pages", or unlabeled docs (from `web` tag fallback).
 * Keeps Settings links with a custom label (e.g. "Page") and real homepage
 * URLs re-added via `homepage` (labeled "Website").
 */
export function stripInventedGithubPagesLinks(
  links: EnrichableRepoLink[] | undefined | null,
  sourceUrl?: string | null
): EnrichableRepoLink[] {
  const list = Array.isArray(links) ? links : [];
  const guessed = guessGithubPagesUrl(sourceUrl);
  if (!guessed) return list.filter(Boolean) as EnrichableRepoLink[];
  const guessedKey = urlKey(guessed);
  return list.filter((link) => {
    if (!link?.url) return false;
    if (urlKey(link.url) !== guessedKey) return true;
    const label = (link.label || "").trim();
    if (label === INVENTED_GITHUB_PAGES_LABEL) return false;
    if (!label && (link.type === "docs" || !link.type)) return false;
    return true;
  });
}

/**
 * Drop auto-invented Nostr Pages docs links (label "Nostr Pages" or unlabeled
 * docs on *.pages.gittr.space). Keeps a confirmed live URL when provided, and
 * Settings links with a custom label on a pages host.
 */
export function stripInventedNostrPagesLinks(
  links: EnrichableRepoLink[] | undefined | null,
  confirmedPagesUrl?: string | null
): EnrichableRepoLink[] {
  const list = Array.isArray(links) ? links : [];
  const confirmedKey = confirmedPagesUrl?.trim()
    ? urlKey(confirmedPagesUrl)
    : null;
  return list.filter((link) => {
    if (!link?.url) return false;
    const label = (link.label || "").trim();
    const onPagesHost = isGittrPagesHost(link.url);
    const inventedLabel = label === INVENTED_NOSTR_PAGES_LABEL;
    if (!inventedLabel && !(onPagesHost && !label && (link.type === "docs" || !link.type))) {
      return true;
    }
    if (confirmedKey && urlKey(link.url) === confirmedKey) return true;
    if (inventedLabel) return false;
    if (onPagesHost && !label) return false;
    return true;
  });
}

/** Strip both classes of invented docs links (GitHub Pages + Nostr Pages). */
export function stripInventedAnnouncementLinks(
  links: EnrichableRepoLink[] | undefined | null,
  opts?: {
    sourceUrl?: string | null;
    confirmedNostrPagesUrl?: string | null;
  }
): EnrichableRepoLink[] {
  return stripInventedNostrPagesLinks(
    stripInventedGithubPagesLinks(links, opts?.sourceUrl),
    opts?.confirmedNostrPagesUrl
  );
}

export function siteOriginFallback(origin?: string | null): string {
  const fromEnv =
    typeof process !== "undefined"
      ? process.env.NEXT_PUBLIC_SITE_URL ||
        process.env.NEXT_PUBLIC_APP_URL ||
        ""
      : "";
  const raw = (origin || fromEnv || "https://gittr.space").trim();
  return raw.replace(/\/+$/, "") || "https://gittr.space";
}

export type EnrichRepoLinksInput = {
  existing?: EnrichableRepoLink[] | undefined | null;
  /** Forge homepage / website field (GitHub API `homepage` only — never guessed) */
  homepage?: string | null;
  sourceUrl?: string | null;
  /**
   * Only pass when the site is confirmed live (e.g. gateway-listed).
   * Never pass a URL merely constructed from owner+d-tag.
   */
  nostrPagesUrl?: string | null;
  /** App id from a prior NIP-82 announce (optional) */
  announcedAppId?: string | null;
  /** Browser origin or https://gittr.space */
  siteOrigin?: string | null;
  /**
   * @deprecated Always ignored. Inventing owner.github.io caused mass 404s.
   * Kept so call sites compile until cleaned up.
   */
  guessGithubPages?: boolean;
};

/**
 * Build the full links list for sidebar + NIP-34 `link`/`web` tags.
 * Settings links in `existing` are kept; forge homepage is added only when
 * GitHub (or another forge) actually returned a homepage URL.
 * Nostr Pages is added only when the caller passes a confirmed live URL.
 */
export function enrichRepoLinks(
  input: EnrichRepoLinksInput
): EnrichableRepoLink[] {
  const pagesUrl = input.nostrPagesUrl?.trim() || null;
  const confirmedPages =
    pagesUrl &&
    (pagesUrl.startsWith("http://") || pagesUrl.startsWith("https://"))
      ? pagesUrl
      : null;

  const existing = stripInventedAnnouncementLinks(input.existing, {
    sourceUrl: input.sourceUrl,
    confirmedNostrPagesUrl: confirmedPages,
  });
  const additions: EnrichableRepoLink[] = [];

  const homepage = input.homepage?.trim();
  if (
    homepage &&
    (homepage.startsWith("http://") || homepage.startsWith("https://"))
  ) {
    additions.push({
      type: "docs",
      url: homepage,
      label: "Website",
    });
  }

  if (confirmedPages) {
    additions.push({
      type: "docs",
      url: confirmedPages.endsWith("/")
        ? confirmedPages
        : `${confirmedPages}/`,
      label: INVENTED_NOSTR_PAGES_LABEL,
    });
  }

  const appId = input.announcedAppId?.trim();
  if (appId) {
    const origin = siteOriginFallback(input.siteOrigin);
    additions.push({
      type: "other",
      url: `${origin}/apps`,
      label: `App (${appId})`,
    });
  }

  return mergeRepoLinks(existing, additions);
}
