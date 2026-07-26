/**
 * Parse gittr/NIP-34 repo links from kind 30617 tags into the shape used by
 * the Code sidebar (`RepoLinks` / `StoredRepo.links`).
 *
 * Format published by Settings / Push:
 *   ["link", type, url, label?]
 * Also accepts NIP-34 ["web", url, ...] when no matching link tag exists —
 * but only for real documentation/website URLs (not forge browse / clone mirrors).
 */

export type Nip34RepoLinkType =
  | "docs"
  | "discord"
  | "slack"
  | "youtube"
  | "twitter"
  | "github"
  | "other";

export type Nip34RepoLink = {
  type: Nip34RepoLinkType;
  url: string;
  label?: string;
};

const KNOWN_TYPES = new Set<string>([
  "docs",
  "discord",
  "slack",
  "youtube",
  "twitter",
  "github",
  "other",
]);

/** Nostr-git forge UIs that put browse URLs in `web` (not project docs). */
const FORGE_BROWSE_HOSTS = new Set([
  "gitworkshop.dev",
  "www.gitworkshop.dev",
]);

/**
 * Hosts that serve GRASP/Nostr-git clones. A `web` URL on these with an npub
 * path is a repo mirror/browse endpoint, not documentation.
 */
const GRASP_OR_GIT_HOST_HINTS = [
  "relay.ngit.dev",
  "ngit-relay.nostrver.se",
  "gitnostr.com",
  "ngit.danconwaydev.com",
  "git.shakespeare.diy",
  "git-01.uid.ovh",
  "git-02.uid.ovh",
  "git.jb55.com",
  "git.gittr.space",
  "gittr.space",
];

const IMAGE_EXT_RE =
  /\.(png|jpe?g|gif|webp|svg|ico|bmp|avif)(\?|#|$)/i;

const NPUB_PATH_RE = /\/npub1[a-z0-9]+(\/|$)/i;

function normalizeType(raw: string): Nip34RepoLinkType {
  const t = (raw || "other").toLowerCase().trim();
  return (KNOWN_TYPES.has(t) ? t : "other") as Nip34RepoLinkType;
}

/** Iris Hashtree browser UI (hash-routed SPA on git.iris.to). */
export function isIrisGitBrowseUrl(url: string): boolean {
  if (!url || typeof url !== "string") return false;
  try {
    const u = new URL(url.trim());
    return u.hostname === "git.iris.to";
  } catch {
    return false;
  }
}

function isGraspOrGitHost(hostname: string): boolean {
  return GRASP_OR_GIT_HOST_HINTS.some(
    (h) => hostname === h || hostname.endsWith(`.${h}`)
  );
}

/**
 * True for forge browse / clone-shaped / logo URLs that must not become
 * sidebar "Documentation" via the `web` fallback.
 * Iris (`git.iris.to`) is eligible (shown as Iris Git).
 */
export function isNostrForgeBrowseOrCloneWebUrl(url: string): boolean {
  if (!url || typeof url !== "string") return false;
  const trimmed = url.trim();
  if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) {
    return true;
  }
  if (isIrisGitBrowseUrl(trimmed)) return false;

  try {
    const u = new URL(trimmed);
    const host = u.hostname.toLowerCase();
    const path = u.pathname || "";

    if (FORGE_BROWSE_HOSTS.has(host)) return true;
    if (IMAGE_EXT_RE.test(path) || IMAGE_EXT_RE.test(trimmed)) return true;
    if (/\.git$/i.test(path)) return true;

    // GRASP/git hosts with npub path = clone/browse mirror, not a project site
    if (isGraspOrGitHost(host) && NPUB_PATH_RE.test(path)) return true;

    // gitworkshop-style: /npub1…/<grasp-host>/repo
    if (NPUB_PATH_RE.test(path) && /\/[a-z0-9.-]+\.[a-z]{2,}\//i.test(path)) {
      return true;
    }

    return false;
  } catch {
    return true;
  }
}

/** `web` URLs eligible to show as docs / Iris Git in the sidebar. */
export function isDocumentationEligibleWebUrl(url: string): boolean {
  if (!url || typeof url !== "string") return false;
  const trimmed = url.trim();
  if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) {
    return false;
  }
  if (isIrisGitBrowseUrl(trimmed)) return true;
  return !isNostrForgeBrowseOrCloneWebUrl(trimmed);
}

function irisLabelIfNeeded(
  url: string,
  existingLabel?: string
): string | undefined {
  if (existingLabel?.trim()) return existingLabel.trim();
  if (isIrisGitBrowseUrl(url)) return "Iris Git";
  return existingLabel;
}

export function parseRepoLinksFromNip34Tags(
  tags: string[][] | undefined | null
): Nip34RepoLink[] {
  if (!Array.isArray(tags)) return [];
  const out: Nip34RepoLink[] = [];
  const seenUrls = new Set<string>();

  for (const tag of tags) {
    if (!Array.isArray(tag) || tag[0] !== "link") continue;
    // ["link", type, url, label?] — type may be missing on bad clients
    let typeRaw = "other";
    let url = "";
    let label: string | undefined;
    if (tag.length >= 3 && typeof tag[2] === "string") {
      typeRaw = String(tag[1] || "other");
      url = tag[2].trim();
      if (typeof tag[3] === "string" && tag[3].trim()) label = tag[3].trim();
    } else if (tag.length >= 2 && typeof tag[1] === "string") {
      // ["link", url]
      url = tag[1].trim();
    }
    if (!url.startsWith("http://") && !url.startsWith("https://")) continue;
    // Explicit link tags from Settings always win — even if URL looks forge-like
    const key = url.toLowerCase();
    if (seenUrls.has(key)) continue;
    seenUrls.add(key);
    const resolvedLabel = irisLabelIfNeeded(url, label);
    out.push({
      type: normalizeType(typeRaw),
      url,
      ...(resolvedLabel ? { label: resolvedLabel } : {}),
    });
  }

  // Fallback: web tags with no dedicated link row — real sites / Iris only
  for (const tag of tags) {
    if (!Array.isArray(tag) || tag[0] !== "web") continue;
    for (let i = 1; i < tag.length; i++) {
      const raw = tag[i];
      const url = typeof raw === "string" ? raw.trim() : "";
      if (!url.startsWith("http://") && !url.startsWith("https://")) continue;
      if (!isDocumentationEligibleWebUrl(url)) continue;
      const key = url.toLowerCase();
      if (seenUrls.has(key)) continue;
      seenUrls.add(key);
      const resolvedLabel = irisLabelIfNeeded(url);
      out.push({
        type: "docs",
        url,
        ...(resolvedLabel ? { label: resolvedLabel } : {}),
      });
    }
  }

  return out;
}

/** Drop forge-browse / clone-shaped / image rows previously stored as docs. */
export function stripNonDocumentationWebLinks<
  T extends { url: string; label?: string; type?: string },
>(links: T[] | undefined | null): T[] {
  const list = Array.isArray(links) ? links : [];
  return list.filter((link) => {
    if (!link?.url) return false;
    const label = (link.label || "").trim();
    // Keep explicitly labeled product links even if URL shape is odd
    if (
      label === "Website" ||
      label === "Nostr Pages" ||
      label === "Iris Git"
    ) {
      return true;
    }
    // Explicit Settings types other than unlabeled forge docs
    if (link.type && link.type !== "docs") return true;
    if (label && label !== "Documentation") return true;
    // Unlabeled / "Documentation" forge browse → drop
    if (isNostrForgeBrowseOrCloneWebUrl(link.url)) return false;
    return true;
  });
}
