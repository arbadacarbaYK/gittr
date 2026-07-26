/**
 * Cheap, offline checks for NIP-34 `clone` tags on discovery surfaces
 * (homepage recent, explore/search, sitemap). No network / bridge probes.
 *
 * Policy: if an announce lists clone URLs and every one is unusable
 * (localhost, loopback, private LAN, *.local), hide it from discovery.
 * Announces with zero clone tags stay visible (legacy / GRASP-only).
 */
import { isHexPathGitHost } from "@/lib/utils/grasp-servers";

/**
 * NIP-34 `d` must be a bare repo identifier (e.g. "gamestr"), not
 * "hexPubkey/gamestr" or other path forms. Local forges sometimes publish
 * the latter; homepage links then become /npub/hex/repo → 404.
 */
export function normalizeNip34RepoIdentifier(
  dTag: string | undefined | null,
  nameTag?: string | undefined | null
): string {
  const raw = (dTag || "").trim();
  const name = (nameTag || "").trim();
  if (!raw && name) return name;

  const hexPrefixed = raw.match(/^([0-9a-f]{64})\/(.+)$/i);
  if (hexPrefixed?.[2]) {
    return hexPrefixed[2].replace(/^\/+|\/+$/g, "") || name || raw;
  }

  if (raw.includes("/")) {
    if (name && !name.includes("/")) return name;
    const leaf = raw.split("/").filter(Boolean).pop();
    return leaf || name || raw;
  }

  return raw || name;
}

export function collectCloneUrlsFromTags(
  tags: unknown[] | undefined | null
): string[] {
  if (!Array.isArray(tags)) return [];
  const out: string[] = [];
  for (const tag of tags) {
    if (!Array.isArray(tag) || tag[0] !== "clone") continue;
    for (let i = 1; i < tag.length; i++) {
      const v = tag[i];
      if (typeof v === "string" && v.trim()) out.push(v.trim());
    }
  }
  return out;
}

function hostnameLooksPrivateOrLocal(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, "");
  if (!h) return true;
  if (
    h === "localhost" ||
    h === "0.0.0.0" ||
    h === "::1" ||
    h.endsWith(".localhost") ||
    h.endsWith(".local") ||
    h.endsWith(".internal")
  ) {
    return true;
  }
  if (h === "127.0.0.1" || h.startsWith("127.")) return true;
  // IPv4 private / link-local
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  if (/^169\.254\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  return false;
}

/**
 * True when the URL is only a git host with no `/owner/repo.git` path.
 * gitworkshop and other NIP-34 clients treat this as the clone target and fail
 * (often as “proxy error”) even when the bare repo exists on that host.
 */
export function isHostOnlyCloneUrl(url: string): boolean {
  const raw = String(url || "").trim();
  if (!raw) return true;
  try {
    if (/^git@/i.test(raw)) {
      // git@host:path — host-only if no path after ':'
      const path = raw.slice(4).split(":")[1] || "";
      return !path.trim();
    }
    const withProto =
      raw.startsWith("http://") ||
      raw.startsWith("https://") ||
      raw.startsWith("ssh://") ||
      raw.startsWith("nostr://")
        ? raw
        : `https://${raw}`;
    const u = new URL(withProto);
    const path = u.pathname.replace(/\/+$/, "");
    return !path || path === "";
  } catch {
    return false;
  }
}

/** Expand `https://git.host` → `https://git.host/<npub|hex>/<repo>.git`. */
export function expandHostOnlyCloneUrl(
  url: string,
  ownerNpubOrHex: string,
  repoName: string
): string {
  const raw = String(url || "").trim();
  const owner = String(ownerNpubOrHex || "").trim();
  const repo = String(repoName || "")
    .trim()
    .replace(/\.git$/i, "")
    .replace(/^\/+|\/+$/g, "");
  if (!raw || !owner || !repo || !isHostOnlyCloneUrl(raw)) return raw;

  try {
    if (/^git@/i.test(raw)) {
      const host = raw.slice(4).split(":")[0] || "";
      if (!host) return raw;
      return `git@${host}:${owner}/${repo}.git`;
    }
    const withProto =
      raw.startsWith("http://") ||
      raw.startsWith("https://") ||
      raw.startsWith("ssh://")
        ? raw
        : `https://${raw}`;
    const u = new URL(withProto);
    return `${u.protocol}//${u.host}/${owner}/${repo}.git`;
  } catch {
    return raw;
  }
}

/**
 * Normalize clone URLs for a kind-30617 announcement:
 * expand host-only values, drop empties, optionally add a primary GRASP URL.
 * Owner path segment should be **npub** (NIP-34 / other clients). Bridge storage
 * is hex underneath; npub→hex symlinks make HTTPS work.
 */
export function normalizeCloneUrlsForNip34Announcement(opts: {
  cloneUrls?: string[] | null;
  ownerNpub: string;
  /** Unused for path shape (kept for callers); disk layout is hex + symlinks */
  ownerHex?: string | null;
  repoName: string;
  fallbackGitServerUrl?: string | null;
}): string[] {
  const owner = String(opts.ownerNpub || "").trim();
  const repo = String(opts.repoName || "")
    .trim()
    .replace(/\.git$/i, "");
  const out: string[] = [];
  const add = (url: string | null | undefined) => {
    if (!url || typeof url !== "string") return;
    let next = url.trim();
    if (!next) return;
    if (isHostOnlyCloneUrl(next) && owner && repo) {
      next = expandHostOnlyCloneUrl(next, owner, repo);
    }
    if (isHostOnlyCloneUrl(next) || isUnusableCloneUrl(next)) return;
    if (!out.includes(next)) out.push(next);
  };

  for (const u of opts.cloneUrls || []) add(u);

  if (out.length === 0 && opts.fallbackGitServerUrl && owner && repo) {
    add(opts.fallbackGitServerUrl);
  }

  return out;
}

/** True when a single clone URL cannot help remote clients / browsers. */
export function isUnusableCloneUrl(url: string): boolean {
  const raw = String(url || "").trim();
  if (!raw) return true;
  if (isHostOnlyCloneUrl(raw)) return true;
  const lower = raw.toLowerCase();
  if (
    lower.includes("localhost") ||
    lower.includes("127.0.0.1") ||
    lower.includes("[::1]") ||
    lower.includes("0.0.0.0")
  ) {
    return true;
  }

  try {
    if (/^git@/i.test(raw)) {
      const host = raw.slice(4).split(":")[0] || "";
      return hostnameLooksPrivateOrLocal(host);
    }
    const withProto =
      raw.startsWith("http://") ||
      raw.startsWith("https://") ||
      raw.startsWith("ssh://") ||
      raw.startsWith("nostr://")
        ? raw
        : `https://${raw}`;
    const u = new URL(withProto);
    return hostnameLooksPrivateOrLocal(u.hostname);
  } catch {
    // Opaque / malformed — treat as unusable for discovery
    return true;
  }
}

export function usableCloneUrls(urls: string[] | undefined | null): string[] {
  if (!Array.isArray(urls)) return [];
  return urls.filter((u) => u && !isUnusableCloneUrl(u));
}

const UPSTREAM_FORGE_HOSTS = [
  "github.com",
  "gitlab.com",
  "codeberg.org",
] as const;

function hostnameOfCloneUrl(url: string): string {
  const raw = String(url || "").trim();
  if (!raw) return "";
  try {
    if (/^git@/i.test(raw)) {
      return (raw.slice(4).split(":")[0] || "").toLowerCase();
    }
    const withProto =
      raw.startsWith("http://") ||
      raw.startsWith("https://") ||
      raw.startsWith("ssh://") ||
      raw.startsWith("nostr://")
        ? raw
        : `https://${raw}`;
    return new URL(withProto).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function isUpstreamForgeUrl(url: string): boolean {
  const host = hostnameOfCloneUrl(url);
  return UPSTREAM_FORGE_HOSTS.some((d) => host === d || host.endsWith(`.${d}`));
}

function ensureDotGit(url: string): string {
  const t = url.trim();
  if (!t || t.endsWith(".git") || t.endsWith("/")) return t;
  return `${t}.git`;
}

/**
 * Rewrite helper for operators / probes only.
 * Prefer publishing **npub** paths (NIP-34). Do not wire this into Push/announce.
 * Bridge storage is hex; npub→hex symlinks make npub HTTPS work.
 */
export function rewriteHexPathGitHostCloneUrl(
  url: string,
  ownerHexPubkey: string
): string {
  const raw = String(url || "").trim();
  const hex = String(ownerHexPubkey || "")
    .trim()
    .toLowerCase();
  if (!raw || !/^[0-9a-f]{64}$/.test(hex)) return raw;

  try {
    if (/^git@/i.test(raw)) {
      const rest = raw.slice(4);
      const colon = rest.indexOf(":");
      if (colon < 0) return raw;
      const host = rest.slice(0, colon);
      const path = rest.slice(colon + 1).replace(/^\/+/, "");
      if (!isHexPathGitHost(host)) return raw;
      const repoLeaf = path.split("/").filter(Boolean).pop() || path;
      const repo = ensureDotGit(repoLeaf.replace(/\.git$/i, ""));
      return `git@${host}:${hex}/${repo}`;
    }

    const withProto =
      raw.startsWith("http://") || raw.startsWith("https://")
        ? raw
        : `https://${raw}`;
    const u = new URL(withProto);
    if (!isHexPathGitHost(u.hostname)) return raw;

    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length < 2) {
      const repo = parts[0] || "repo";
      u.pathname = `/${hex}/${ensureDotGit(repo)}`;
      return u.toString().replace(/\/$/, "");
    }
    const repoLeaf = parts[parts.length - 1] || "repo";
    u.pathname = `/${hex}/${ensureDotGit(repoLeaf)}`;
    return u.toString().replace(/\/$/, "");
  } catch {
    return raw;
  }
}

/**
 * Pick what "Copy clone URL" should put on the clipboard for humans.
 * Prefer real forge HTTPS (GitHub/…), then NIP-34 HTTPS (usually npub path),
 * then SSH. Do **not** rewrite announce URLs to hex — other clients expect npub.
 */
export function pickUserFacingCloneUrl(opts: {
  cloneUrls?: string[] | null;
  sourceUrl?: string | null;
  ownerHexPubkey?: string | null;
  repoName?: string | null;
  gitSshBase?: string | null;
  originFallback?: string | null;
}): string | null {
  const clones = Array.isArray(opts.cloneUrls) ? opts.cloneUrls : [];
  const hex = String(opts.ownerHexPubkey || "")
    .trim()
    .toLowerCase();
  const repo = String(opts.repoName || "")
    .trim()
    .replace(/\.git$/i, "");
  const sshBase = String(opts.gitSshBase || "git.gittr.space").trim();

  const candidates: string[] = [];
  const add = (u: string | null | undefined) => {
    if (!u || typeof u !== "string") return;
    const t = u.trim();
    if (!t || t.startsWith("nostr://")) return;
    if (t.includes("localhost") || t.includes("127.0.0.1")) return;
    candidates.push(t);
  };

  add(opts.sourceUrl || undefined);
  for (const u of clones) add(u);

  // 1) Upstream forge HTTPS
  for (const u of candidates) {
    if (
      isUpstreamForgeUrl(u) &&
      (u.startsWith("http://") || u.startsWith("https://") || /^git@/i.test(u))
    ) {
      if (/^git@/i.test(u)) {
        const m = u.match(/^git@([^:]+):(.+)$/);
        if (m) return ensureDotGit(`https://${m[1]}/${m[2]}`);
      }
      return ensureDotGit(u);
    }
  }

  // 2) Any HTTPS from the announce (npub-path GRASP / gittr — keep as published)
  for (const u of candidates) {
    if (u.startsWith("http://") || u.startsWith("https://")) {
      return ensureDotGit(u);
    }
  }

  // 3) SSH for our git host
  if (hex && repo && /^[0-9a-f]{64}$/.test(hex)) {
    return `git@${sshBase}:${hex}/${repo}.git`;
  }

  if (opts.originFallback) return opts.originFallback;
  return null;
}

/**
 * Hide from homepage / explore / sitemap when the announce *has* clone tags
 * but none are publicly usable. No clone tags → keep (not our problem).
 */
export function shouldHideAnnounceForUnusableClones(
  cloneUrls: string[] | undefined | null
): boolean {
  if (!Array.isArray(cloneUrls) || cloneUrls.length === 0) return false;
  return usableCloneUrls(cloneUrls).length === 0;
}

export function shouldHideNip34EventForUnusableClones(event: {
  tags?: unknown[];
}): boolean {
  return shouldHideAnnounceForUnusableClones(
    collectCloneUrlsFromTags(event.tags)
  );
}
