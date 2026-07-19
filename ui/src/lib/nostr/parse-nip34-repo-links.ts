/**
 * Parse gittr/NIP-34 repo links from kind 30617 tags into the shape used by
 * the Code sidebar (`RepoLinks` / `StoredRepo.links`).
 *
 * Format published by Settings / Push:
 *   ["link", type, url, label?]
 * Also accepts NIP-34 ["web", url, ...] when no matching link tag exists.
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

  // Fallback: web tags with no dedicated link row
  for (const tag of tags) {
    if (!Array.isArray(tag) || tag[0] !== "web") continue;
    for (let i = 1; i < tag.length; i++) {
      const raw = tag[i];
      const url = typeof raw === "string" ? raw.trim() : "";
      if (!url.startsWith("http://") && !url.startsWith("https://")) continue;
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
