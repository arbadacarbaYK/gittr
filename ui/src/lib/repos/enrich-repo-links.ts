/**
 * Merge Settings docs links with auto-discovered website / Nostr Pages / Apps
 * URLs so Push, import, and refetch keep the sidebar Links section useful.
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

function normalizeUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, "");
}

function urlKey(url: string): string {
  return normalizeUrl(url).toLowerCase();
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
 * Guess GitHub Pages from a github.com source URL when the forge homepage
 * field is empty: https://github.com/owner/repo → https://owner.github.io/repo/
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
  existing?: EnrichableRepoLink[] | null;
  /** Forge homepage / website field (GitHub API `homepage`, etc.) */
  homepage?: string | null;
  sourceUrl?: string | null;
  /** Live or known Nostr Pages URL for this repo */
  nostrPagesUrl?: string | null;
  /** App id from a prior NIP-82 announce (optional) */
  announcedAppId?: string | null;
  /** Browser origin or https://gittr.space */
  siteOrigin?: string | null;
  /** When true, also guess owner.github.io/repo from sourceUrl if no homepage */
  guessGithubPages?: boolean;
};

/**
 * Build the full links list for sidebar + NIP-34 `link`/`web` tags.
 * Settings links in `existing` are kept; auto links are added when missing.
 */
export function enrichRepoLinks(
  input: EnrichRepoLinksInput
): EnrichableRepoLink[] {
  const additions: EnrichableRepoLink[] = [];

  const homepage = input.homepage?.trim();
  if (homepage && (homepage.startsWith("http://") || homepage.startsWith("https://"))) {
    const isGhPages = /\.github\.io\//i.test(homepage);
    additions.push({
      type: "docs",
      url: homepage,
      label: isGhPages ? "GitHub Pages" : "Website",
    });
  } else if (input.guessGithubPages !== false) {
    const guessed = guessGithubPagesUrl(input.sourceUrl);
    if (guessed) {
      additions.push({
        type: "docs",
        url: guessed,
        label: "GitHub Pages",
      });
    }
  }

  const pagesUrl = input.nostrPagesUrl?.trim();
  if (
    pagesUrl &&
    (pagesUrl.startsWith("http://") || pagesUrl.startsWith("https://"))
  ) {
    additions.push({
      type: "docs",
      url: pagesUrl.endsWith("/") ? pagesUrl : `${pagesUrl}/`,
      label: "Nostr Pages",
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

  return mergeRepoLinks(input.existing, additions);
}
