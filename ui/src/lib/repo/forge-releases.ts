/**
 * Fetch forge Releases (GitHub / Codeberg / GitLab) for Zapstore-compatible announce.
 * gittr does not host APKs — only returns public download URLs (+ optional sha256).
 */

export type ForgeHost = "github" | "codeberg" | "gitlab";

export type ForgeReleaseAsset = {
  name: string;
  size: number;
  contentType: string;
  downloadUrl: string;
  /** Present when the client requested hashing and the download succeeded. */
  sha256?: string;
};

export type ForgeRelease = {
  tag: string;
  name: string;
  body: string;
  publishedAt?: string;
  htmlUrl?: string;
  draft: boolean;
  prerelease: boolean;
  assets: ForgeReleaseAsset[];
  apkAssets: ForgeReleaseAsset[];
};

export type ForgeReleasesOk = {
  ok: true;
  forge: ForgeHost;
  owner: string;
  repo: string;
  repositoryUrl: string;
  release: ForgeRelease;
};

export type ForgeReleasesErr = {
  ok: false;
  code:
    | "missing_source"
    | "unsupported_forge"
    | "no_releases"
    | "no_apk"
    | "forge_error"
    | "invalid_request";
  message: string;
};

export type ForgeReleasesResult = ForgeReleasesOk | ForgeReleasesErr;

const MAX_APK_HASH_BYTES = 200 * 1024 * 1024;

export function isApkAssetName(name: string, contentType?: string): boolean {
  const n = (name || "").toLowerCase();
  if (n.endsWith(".apk")) return true;
  const ct = (contentType || "").toLowerCase();
  return (
    ct === "application/vnd.android.package-archive" ||
    ct.includes("android.package")
  );
}

/** Suggest a reverse-DNS style app id from a repo slug (user can override). */
export function suggestAppIdFromRepo(repo: string): string {
  const slug = (repo || "app")
    .replace(/\.git$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 48);
  return `space.gittr.${slug || "app"}`;
}

/** Normalize release tag to a version string for NIP-82 `version` / `d`. */
export function versionFromTag(tag: string): string {
  const t = (tag || "").trim();
  if (!t) return "0.0.0";
  return t.startsWith("v") || t.startsWith("V") ? t.slice(1) : t;
}

export function normalizeRepositoryHttpsUrl(raw: string): string {
  let u = raw.trim();
  const ssh = u.match(/^git@([^:]+):(.+)$/);
  if (ssh) u = `https://${ssh[1]}/${ssh[2]}`;
  else if (u.startsWith("git://")) u = u.replace(/^git:\/\//, "https://");
  else if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  try {
    const parsed = new URL(u);
    parsed.hash = "";
    parsed.search = "";
    let path = parsed.pathname.replace(/\/+$/, "").replace(/\.git$/i, "");
    return `${parsed.protocol}//${parsed.host}${path}`;
  } catch {
    return u.replace(/\.git$/i, "");
  }
}

export function resolveForgeFromSourceUrl(
  sourceUrl: string
):
  | {
      ok: true;
      forge: ForgeHost;
      owner: string;
      repo: string;
      repositoryUrl: string;
    }
  | {
      ok: false;
      code: "missing_source" | "unsupported_forge";
      message: string;
    } {
  if (!sourceUrl || typeof sourceUrl !== "string" || !sourceUrl.trim()) {
    return {
      ok: false,
      code: "missing_source",
      message:
        "Link a forge remote first (GitHub, Codeberg, or GitLab) on this repository’s source URL.",
    };
  }

  const repositoryUrl = normalizeRepositoryHttpsUrl(sourceUrl);
  let host = "";
  let parts: string[] = [];
  try {
    const parsed = new URL(repositoryUrl);
    host = parsed.hostname.toLowerCase();
    parts = parsed.pathname.split("/").filter(Boolean);
  } catch {
    return {
      ok: false,
      code: "unsupported_forge",
      message: "Could not parse the repository source URL.",
    };
  }

  if (parts.length < 2) {
    return {
      ok: false,
      code: "unsupported_forge",
      message: "Source URL must look like https://host/owner/repo.",
    };
  }

  const owner = parts[0] || "";
  const repoSeg = parts[1] || "";
  const repo = repoSeg.replace(/\.git$/i, "");
  if (!owner || !repo || /^npub1[a-z0-9]+$/i.test(owner)) {
    return {
      ok: false,
      code: "unsupported_forge",
      message:
        "Announce needs a public forge (GitHub / Codeberg / GitLab), not a Nostr-only clone URL.",
    };
  }

  let forge: ForgeHost | null = null;
  if (host === "github.com" || host === "www.github.com") forge = "github";
  else if (host === "codeberg.org" || host === "www.codeberg.org")
    forge = "codeberg";
  else if (host === "gitlab.com" || host === "www.gitlab.com") forge = "gitlab";

  if (!forge) {
    return {
      ok: false,
      code: "unsupported_forge",
      message:
        "Only GitHub, Codeberg, and GitLab release APIs are supported for announce in v1.",
    };
  }

  return { ok: true, forge, owner, repo, repositoryUrl };
}

function githubHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "gittr-space-forge-releases",
  };
  const token = process.env.GITHUB_PLATFORM_TOKEN || "";
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function sha256OfUrl(
  url: string,
  maxBytes = MAX_APK_HASH_BYTES
): Promise<string | undefined> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 120_000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: { "User-Agent": "gittr-space-forge-releases" },
    });
    if (!res.ok || !res.body) return undefined;
    const len = Number(res.headers.get("content-length") || 0);
    if (len > maxBytes) return undefined;

    const crypto = await import("crypto");
    const hash = crypto.createHash("sha256");
    const reader = res.body.getReader();
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        reader.cancel().catch(() => undefined);
        return undefined;
      }
      hash.update(value);
    }
    return hash.digest("hex");
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

async function maybeHashApks(
  assets: ForgeReleaseAsset[],
  includeHash: boolean
): Promise<ForgeReleaseAsset[]> {
  if (!includeHash) return assets;
  const out: ForgeReleaseAsset[] = [];
  for (const a of assets) {
    if (!isApkAssetName(a.name, a.contentType)) {
      out.push(a);
      continue;
    }
    const sha256 = await sha256OfUrl(a.downloadUrl);
    out.push(sha256 ? { ...a, sha256 } : a);
  }
  return out;
}

async function fetchGitHubRelease(
  owner: string,
  repo: string
): Promise<ForgeRelease | null> {
  const url = `https://api.github.com/repos/${encodeURIComponent(
    owner
  )}/${encodeURIComponent(repo)}/releases?per_page=20`;
  const res = await fetch(url, { headers: githubHeaders() });
  if (!res.ok) {
    throw new Error(`GitHub releases API returned ${res.status}`);
  }
  const list = (await res.json()) as Array<{
    tag_name?: string;
    name?: string;
    body?: string;
    published_at?: string;
    html_url?: string;
    draft?: boolean;
    prerelease?: boolean;
    assets?: Array<{
      name?: string;
      size?: number;
      content_type?: string;
      browser_download_url?: string;
    }>;
  }>;
  const pick = list.find((r) => !r.draft) || list[0];
  if (!pick?.tag_name) return null;
  const assets: ForgeReleaseAsset[] = (pick.assets || [])
    .filter((a) => a.name && a.browser_download_url)
    .map((a) => ({
      name: String(a.name),
      size: typeof a.size === "number" ? a.size : 0,
      contentType: a.content_type || "application/octet-stream",
      downloadUrl: String(a.browser_download_url),
    }));
  const apkAssets = assets.filter((a) => isApkAssetName(a.name, a.contentType));
  return {
    tag: pick.tag_name,
    name: pick.name || pick.tag_name,
    body: typeof pick.body === "string" ? pick.body : "",
    publishedAt: pick.published_at,
    htmlUrl: pick.html_url,
    draft: Boolean(pick.draft),
    prerelease: Boolean(pick.prerelease),
    assets,
    apkAssets,
  };
}

async function fetchCodebergRelease(
  owner: string,
  repo: string
): Promise<ForgeRelease | null> {
  const url = `https://codeberg.org/api/v1/repos/${encodeURIComponent(
    owner
  )}/${encodeURIComponent(repo)}/releases?limit=20`;
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "gittr-space-forge-releases",
    },
  });
  if (!res.ok) {
    throw new Error(`Codeberg releases API returned ${res.status}`);
  }
  const list = (await res.json()) as Array<{
    tag_name?: string;
    name?: string;
    body?: string;
    published_at?: string;
    html_url?: string;
    draft?: boolean;
    prerelease?: boolean;
    assets?: Array<{
      name?: string;
      size?: number;
      content_type?: string;
      browser_download_url?: string;
    }>;
  }>;
  const pick =
    (Array.isArray(list) ? list : []).find((r) => !r.draft) || list[0];
  if (!pick?.tag_name) return null;
  const assets: ForgeReleaseAsset[] = (pick.assets || [])
    .filter((a) => a.name && a.browser_download_url)
    .map((a) => ({
      name: String(a.name),
      size: typeof a.size === "number" ? a.size : 0,
      contentType: a.content_type || "application/octet-stream",
      downloadUrl: String(a.browser_download_url),
    }));
  const apkAssets = assets.filter((a) => isApkAssetName(a.name, a.contentType));
  return {
    tag: pick.tag_name,
    name: pick.name || pick.tag_name,
    body: typeof pick.body === "string" ? pick.body : "",
    publishedAt: pick.published_at,
    htmlUrl: pick.html_url,
    draft: Boolean(pick.draft),
    prerelease: Boolean(pick.prerelease),
    assets,
    apkAssets,
  };
}

async function fetchGitLabRelease(
  owner: string,
  repo: string
): Promise<ForgeRelease | null> {
  const project = encodeURIComponent(`${owner}/${repo}`);
  const url = `https://gitlab.com/api/v4/projects/${project}/releases`;
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "gittr-space-forge-releases",
    },
  });
  if (!res.ok) {
    throw new Error(`GitLab releases API returned ${res.status}`);
  }
  const list = (await res.json()) as Array<{
    tag_name?: string;
    name?: string;
    description?: string;
    released_at?: string;
    _links?: { self?: string };
    assets?: {
      links?: Array<{
        name?: string;
        url?: string;
        direct_asset_url?: string;
        link_type?: string;
      }>;
    };
  }>;
  const pick = Array.isArray(list) ? list[0] : null;
  if (!pick?.tag_name) return null;

  const assets: ForgeReleaseAsset[] = (pick.assets?.links || [])
    .filter((a) => a.name && (a.direct_asset_url || a.url))
    .map((a) => {
      const downloadUrl = String(a.direct_asset_url || a.url);
      const name = String(a.name);
      return {
        name,
        size: 0,
        contentType: isApkAssetName(name)
          ? "application/vnd.android.package-archive"
          : "application/octet-stream",
        downloadUrl,
      };
    });
  const apkAssets = assets.filter((a) => isApkAssetName(a.name, a.contentType));
  return {
    tag: pick.tag_name,
    name: pick.name || pick.tag_name,
    body: typeof pick.description === "string" ? pick.description : "",
    publishedAt: pick.released_at,
    htmlUrl: pick._links?.self,
    draft: false,
    prerelease: false,
    assets,
    apkAssets,
  };
}

/**
 * Resolve latest usable forge release with APK assets.
 * Throws structured ForgeReleasesErr via return value (never throws for expected empty cases).
 */
export async function fetchForgeReleasesForAnnounce(options: {
  sourceUrl: string;
  includeHash?: boolean;
}): Promise<ForgeReleasesResult> {
  const resolved = resolveForgeFromSourceUrl(options.sourceUrl);
  if (!resolved.ok) {
    return {
      ok: false,
      code: resolved.code,
      message: resolved.message,
    };
  }

  try {
    let release: ForgeRelease | null = null;
    if (resolved.forge === "github") {
      release = await fetchGitHubRelease(resolved.owner, resolved.repo);
    } else if (resolved.forge === "codeberg") {
      release = await fetchCodebergRelease(resolved.owner, resolved.repo);
    } else {
      release = await fetchGitLabRelease(resolved.owner, resolved.repo);
    }

    if (!release) {
      return {
        ok: false,
        code: "no_releases",
        message:
          "This forge repository has no Releases yet. Create a Release with an .apk asset on GitHub/Codeberg/GitLab first — announce uses forge Releases, not a git branch.",
      };
    }

    if (release.apkAssets.length === 0) {
      return {
        ok: false,
        code: "no_apk",
        message: `Your repo or latest release has no .apk assets.`,
      };
    }

    const apkAssets = await maybeHashApks(
      release.apkAssets,
      Boolean(options.includeHash)
    );
    const assets = release.assets.map((a) => {
      const hashed = apkAssets.find(
        (h) => h.downloadUrl === a.downloadUrl && h.sha256
      );
      return hashed ? { ...a, sha256: hashed.sha256 } : a;
    });

    return {
      ok: true,
      forge: resolved.forge,
      owner: resolved.owner,
      repo: resolved.repo,
      repositoryUrl: resolved.repositoryUrl,
      release: {
        ...release,
        assets,
        apkAssets,
      },
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Forge API request failed";
    return {
      ok: false,
      code: "forge_error",
      message: msg,
    };
  }
}
