/**
 * Shared repo-card / repo-header icon URL.
 *
 * Explore stacks layers so a broken overlay still shows the owner picture.
 * The repo header used a single <img> and, for Nostr-only / GRASP repos,
 * pointed it at JSON `/api/nostr/repo/file-content` — the browser cannot
 * render that, so onError jumped to /logo.svg and skipped the owner pic.
 */

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "ico"]);

const FORMAT_PRIORITY: Record<string, number> = {
  png: 0,
  svg: 1,
  webp: 2,
  jpg: 3,
  jpeg: 3,
  gif: 4,
  ico: 5,
};

export type KnownForgeHost = "github.com" | "gitlab.com" | "codeberg.org";

export type KnownForgeRepo = {
  owner: string;
  repo: string;
  hostname: KnownForgeHost;
};

export function logoUrlFromNip34Tags(
  tags: string[][] | null | undefined
): string | null {
  if (!Array.isArray(tags)) return null;
  for (const tag of tags) {
    if (!Array.isArray(tag) || tag[0] !== "image") continue;
    const u = typeof tag[1] === "string" ? tag[1].trim() : "";
    if (/^https?:\/\//i.test(u)) return u;
  }
  return null;
}

export type RepoDisplayIconInput = {
  logoUrl?: string | null;
  files?: Array<{ path?: string } | string> | null;
  sourceUrl?: string | null;
  clone?: string[] | null;
  defaultBranch?: string | null;
  ownerPubkey?: string | null;
  repoName?: string | null;
  ownerPicture?: string | null;
  /**
   * Header: try bridge logo even when the tree is still empty (GRASP-only).
   * Explore cards: false — only hit `/api/og/repo-image` when a logo file is listed.
   */
  nativeEvenWithoutFiles?: boolean;
};

function filePath(entry: { path?: string } | string): string {
  if (typeof entry === "string") return entry;
  return typeof entry?.path === "string" ? entry.path : "";
}

export function isKnownForgeHostname(host: string): host is KnownForgeHost {
  const h = (host || "").toLowerCase().replace(/^www\./, "");
  return h === "github.com" || h === "gitlab.com" || h === "codeberg.org";
}

/**
 * Only GitHub / GitLab / Codeberg. Custom schemes (`ai:user@host/…`), GRASP
 * clones, and self-hosted git must not count as a successful forge parse —
 * that blocked Explore's native logo URL and made the header use JSON.
 */
export function extractKnownForgeRepo(
  urlString: string | null | undefined
): KnownForgeRepo | null {
  const raw = (urlString || "").trim();
  if (!raw) return null;

  const ssh = raw.match(/^git@([^:]+):([^/]+)\/([^/]+?)(?:\.git)?$/i);
  if (ssh && ssh[1] && ssh[2] && ssh[3]) {
    const hostname = ssh[1].toLowerCase();
    if (!isKnownForgeHostname(hostname)) return null;
    return {
      hostname,
      owner: ssh[2],
      repo: ssh[3].replace(/\.git$/, ""),
    };
  }

  let href = raw;
  if (!/^https?:\/\//i.test(href)) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) && !/^git:\/\//i.test(href)) {
      return null;
    }
    href = `https://${href}`;
  }

  try {
    const u = new URL(href);
    const hostname = u.hostname.toLowerCase().replace(/^www\./, "");
    if (!isKnownForgeHostname(hostname)) return null;
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length < 2 || !parts[0] || !parts[1]) return null;
    return {
      hostname,
      owner: parts[0],
      repo: parts[1].replace(/\.git$/, ""),
    };
  } catch {
    return null;
  }
}

export function forgeRawLogoUrl(
  forge: KnownForgeRepo,
  logoPath: string,
  branch: string
): string {
  const encodedPath = logoPath
    .split("/")
    .map((p) => encodeURIComponent(p))
    .join("/");
  const b = encodeURIComponent(branch || "main");
  if (forge.hostname === "github.com") {
    return `https://raw.githubusercontent.com/${forge.owner}/${forge.repo}/${b}/${encodedPath}`;
  }
  if (forge.hostname === "gitlab.com") {
    return `https://gitlab.com/${forge.owner}/${forge.repo}/-/raw/${b}/${encodedPath}`;
  }
  return `https://codeberg.org/${forge.owner}/${forge.repo}/raw/branch/${b}/${encodedPath}`;
}

export function pickRepoLogoFilePath(
  files: RepoDisplayIconInput["files"],
  repoName?: string | null
): string | null {
  if (!Array.isArray(files) || files.length === 0) return null;
  const normalizedRepo = (repoName || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

  const candidates = files
    .map(filePath)
    .filter((p) => {
      if (!p) return false;
      const fileName = p.split("/").pop() || "";
      const baseName = fileName.replace(/\.[^.]+$/, "").toLowerCase();
      const extension = fileName.split(".").pop()?.toLowerCase() || "";
      const isRoot = p.split("/").length === 1;
      if (!IMAGE_EXTS.has(extension)) return false;
      if (
        baseName.includes("logo") &&
        !baseName.includes("logo-alby") &&
        !baseName.includes("alby-logo")
      ) {
        return true;
      }
      if (normalizedRepo && baseName === normalizedRepo) return true;
      if (
        isRoot &&
        (baseName === "repo" || baseName === "icon" || baseName === "favicon")
      ) {
        return true;
      }
      return false;
    })
    .sort((a, b) => {
      const aParts = a.split("/");
      const bParts = b.split("/");
      const aName =
        aParts[aParts.length - 1]?.replace(/\.[^.]+$/, "").toLowerCase() || "";
      const bName =
        bParts[bParts.length - 1]?.replace(/\.[^.]+$/, "").toLowerCase() || "";
      const aIsRoot = aParts.length === 1;
      const bIsRoot = bParts.length === 1;
      if (aName === "logo" && bName !== "logo") return -1;
      if (bName === "logo" && aName !== "logo") return 1;
      if (
        normalizedRepo &&
        aName === normalizedRepo &&
        bName !== normalizedRepo &&
        bName !== "logo"
      )
        return -1;
      if (
        normalizedRepo &&
        bName === normalizedRepo &&
        aName !== normalizedRepo &&
        aName !== "logo"
      )
        return 1;
      if (aIsRoot && !bIsRoot) return -1;
      if (!aIsRoot && bIsRoot) return 1;
      const aPrio =
        FORMAT_PRIORITY[a.split(".").pop()?.toLowerCase() || ""] ?? 10;
      const bPrio =
        FORMAT_PRIORITY[b.split(".").pop()?.toLowerCase() || ""] ?? 10;
      return aPrio - bPrio;
    });

  return candidates[0] || null;
}

export function nativeRepoAvatarUrl(
  ownerPubkey: string,
  repoName: string
): string {
  return `/api/og/repo-image?ownerPubkey=${encodeURIComponent(
    ownerPubkey
  )}&repo=${encodeURIComponent(repoName)}&avatar=1`;
}

function firstHttpUrl(value: string | null | undefined): string | null {
  const t = (value || "").trim();
  if (!t) return null;
  if (
    t.startsWith("https://") ||
    t.startsWith("http://") ||
    t.startsWith("data:") ||
    t.startsWith("/")
  ) {
    return t;
  }
  return null;
}

function coerceLogoUrl(value: string | null | undefined): string | null {
  const direct = firstHttpUrl(value);
  if (direct) return direct;
  const t = (value || "").trim();
  if (t.includes(".") && !t.includes("@") && !t.includes("://")) {
    return `https://${t}`;
  }
  return null;
}

function cleanRepoName(name: string | null | undefined): string {
  let n = (name || "").trim();
  if (!n) return "";
  if (n.includes("/")) {
    const parts = n.split("/");
    n = parts[parts.length - 1] || n;
  }
  return n.replace(/\.git$/, "");
}

export function resolveRepoDisplayIcon(
  input: RepoDisplayIconInput
): string | null {
  const stored = coerceLogoUrl(input.logoUrl);
  if (stored) return stored;

  const repoName = cleanRepoName(input.repoName);
  const logoPath = pickRepoLogoFilePath(input.files, repoName);
  const branch = input.defaultBranch || "main";

  const urls: string[] = [];
  if (input.sourceUrl) urls.push(input.sourceUrl);
  if (Array.isArray(input.clone)) {
    for (const c of input.clone) {
      if (typeof c === "string" && c.trim()) urls.push(c.trim());
    }
  }

  let forge: KnownForgeRepo | null = null;
  for (const u of urls) {
    forge = extractKnownForgeRepo(u);
    if (forge) break;
  }

  if (forge && logoPath) {
    return forgeRawLogoUrl(forge, logoPath, branch);
  }

  const owner = (input.ownerPubkey || "").trim();
  const canNative =
    !!owner &&
    /^[0-9a-f]{64}$/i.test(owner) &&
    !!repoName &&
    !forge &&
    (logoPath || input.nativeEvenWithoutFiles);

  if (canNative) {
    return nativeRepoAvatarUrl(owner, repoName);
  }

  const picture = (input.ownerPicture || "").trim();
  if (
    picture.startsWith("http://") ||
    picture.startsWith("https://") ||
    /^data:image\/[a-z0-9.+-]+/i.test(picture)
  ) {
    return picture;
  }

  return null;
}
