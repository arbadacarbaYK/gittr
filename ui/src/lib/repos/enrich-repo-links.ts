/**
 * Repo docs / Repository Links — simple rules:
 *
 * 1. Import / refetch: if GitHub returns a homepage, merge it as docs ("Website").
 *    If empty, add nothing. Never invent owner.github.io.
 * 2. Settings: user-added links are stored on repo.links and always kept.
 * 3. Nostr Pages: only merge when the caller passes a confirmed live URL
 *    (e.g. gateway-listed). Never invent from owner+d-tag.
 * 4. Push / Settings publish: publish whatever is already on repo.links
 *    (plus optional App link after a real NIP-82 announce).
 *
 * `removeStaleAutoLinks` is a one-shot cleanup for older builds that wrongly
 * invented "GitHub Pages" / "Nostr Pages" rows — not part of the happy path.
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

/** Old auto-invent labels (do not use for new real links except confirmed Pages). */
export const STALE_GITHUB_PAGES_LABEL = "GitHub Pages";
export const NOSTR_PAGES_LINK_LABEL = "Nostr Pages";

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
      host === "pages.gittr.space" || host.endsWith(".pages.gittr.space")
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
 * Conventional github.io URL from source — only used to recognize/remove
 * stale auto-invent rows from older builds.
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
 * Remove only the old invented github.io rows:
 * label "GitHub Pages" + URL equals guessed owner.github.io/repo.
 *
 * Does NOT remove Nostr Pages links (those stay if the user/gateway added them).
 * Real homepage from GitHub is labeled "Website" and is kept.
 * User Settings links with any other label are kept.
 */
export function removeStaleAutoLinks(
  links: EnrichableRepoLink[] | undefined | null,
  sourceUrl?: string | null
): EnrichableRepoLink[] {
  const list = Array.isArray(links) ? links : [];
  const guessedKey = (() => {
    const g = guessGithubPagesUrl(sourceUrl);
    return g ? urlKey(g) : null;
  })();
  if (!guessedKey) return list.filter((l) => Boolean(l?.url));

  return list.filter((link) => {
    if (!link?.url) return false;
    const label = (link.label || "").trim();
    if (label !== STALE_GITHUB_PAGES_LABEL) return true;
    return urlKey(link.url) !== guessedKey;
  });
}

/** Drop auto "Nostr Pages" rows (pages.gittr.space) — used when gateway says not listed. */
export function removeAutoNostrPagesLinks(
  links: EnrichableRepoLink[] | undefined | null
): EnrichableRepoLink[] {
  const list = Array.isArray(links) ? links : [];
  return list.filter((link) => {
    if (!link?.url) return false;
    const label = (link.label || "").trim();
    if (label === NOSTR_PAGES_LINK_LABEL && isGittrPagesHost(link.url)) {
      return false;
    }
    return true;
  });
}

/** @deprecated use removeStaleAutoLinks */
export const stripInventedGithubPagesLinks = (
  links: EnrichableRepoLink[] | undefined | null,
  sourceUrl?: string | null
) => removeStaleAutoLinks(links, sourceUrl);

/** @deprecated use removeStaleAutoLinks */
export const stripInventedAnnouncementLinks = (
  links: EnrichableRepoLink[] | undefined | null,
  opts?: { sourceUrl?: string | null; confirmedNostrPagesUrl?: string | null }
) => {
  const cleaned = removeStaleAutoLinks(links, opts?.sourceUrl);
  const confirmed = opts?.confirmedNostrPagesUrl?.trim();
  if (
    confirmed &&
    (confirmed.startsWith("http://") || confirmed.startsWith("https://"))
  ) {
    return mergeRepoLinks(cleaned, [
      {
        type: "docs",
        url: confirmed.endsWith("/") ? confirmed : `${confirmed}/`,
        label: NOSTR_PAGES_LINK_LABEL,
      },
    ]);
  }
  return cleaned;
};

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
  /** GitHub API homepage — only when present */
  homepage?: string | null;
  sourceUrl?: string | null;
  /**
   * Confirmed live Nostr Pages URL only (gateway-listed / published).
   * Never pass a URL merely built from owner + d-tag.
   */
  nostrPagesUrl?: string | null;
  announcedAppId?: string | null;
  siteOrigin?: string | null;
  /** @deprecated ignored */
  guessGithubPages?: boolean;
  /**
   * When true (default), drop stale auto-invent rows from older builds before
   * merging. Push/Settings should pass false once storage is clean, or true
   * is fine — it only removes invent labels, not "Website" or custom labels.
   */
  cleanStaleAutoLinks?: boolean;
};

/**
 * Merge real link sources into repo.links. Does not invent URLs.
 */
export function enrichRepoLinks(
  input: EnrichRepoLinksInput
): EnrichableRepoLink[] {
  const clean = input.cleanStaleAutoLinks !== false;
  const base = clean
    ? removeStaleAutoLinks(input.existing, input.sourceUrl)
    : (Array.isArray(input.existing) ? input.existing : []).filter(
        (l) => l?.url
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

  const pagesUrl = input.nostrPagesUrl?.trim();
  if (
    pagesUrl &&
    (pagesUrl.startsWith("http://") || pagesUrl.startsWith("https://"))
  ) {
    additions.push({
      type: "docs",
      url: pagesUrl.endsWith("/") ? pagesUrl : `${pagesUrl}/`,
      label: NOSTR_PAGES_LINK_LABEL,
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

  return mergeRepoLinks(base, additions);
}
