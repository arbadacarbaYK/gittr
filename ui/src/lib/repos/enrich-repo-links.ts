/**
 * Merge Settings docs links with forge homepage / Nostr Pages / Apps URLs
 * so Push, import, and refetch keep the sidebar Links section useful.
 *
 * Never invent owner.github.io/repo — only use GitHub's homepage field (or
 * explicit Settings / Nostr Pages / app links). Guessing caused mass 404s.
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
  /** Live or known Nostr Pages URL for this repo */
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
 */
export function enrichRepoLinks(
  input: EnrichRepoLinksInput
): EnrichableRepoLink[] {
  const existing = stripInventedGithubPagesLinks(
    input.existing,
    input.sourceUrl
  );
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
  // Intentionally never invent github.io from sourceUrl (guessGithubPages ignored).

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

  return mergeRepoLinks(existing, additions);
}
