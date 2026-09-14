/**
 * Latest official gittr Android APK from GitHub Releases (not Blossom).
 * GitHub download URLs leave the WebView; blossom.gittr.space would stay in-app.
 */
import { BoundedTtlCache } from "../utils/bounded-ttl-cache";

import { isApkAssetName } from "./forge-releases";
import { compareSemver } from "./gittr-android-shell";

export const GITTR_ANDROID_GITHUB_OWNER = "arbadacarbaYK";
export const GITTR_ANDROID_GITHUB_REPO = "gittr";

export const GITTR_ANDROID_GITHUB_LATEST_API = `https://api.github.com/repos/${GITTR_ANDROID_GITHUB_OWNER}/${GITTR_ANDROID_GITHUB_REPO}/releases/latest`;

export const GITTR_ANDROID_GITHUB_RELEASES_HTML = `https://github.com/${GITTR_ANDROID_GITHUB_OWNER}/${GITTR_ANDROID_GITHUB_REPO}/releases/latest`;

type GitHubAsset = {
  name?: string;
  content_type?: string;
  browser_download_url?: string;
};

export function versionFromReleaseTag(tag: string): string | null {
  const m = String(tag || "")
    .trim()
    .match(/^v?(\d+\.\d+\.\d+)/i);
  return m?.[1] ?? null;
}

/** Only GitHub release/object hosts — never blossom.gittr.space. */
export function isTrustedGittrApkDownloadUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;
    const host = u.hostname.toLowerCase();
    if (host === "github.com") {
      return /\/releases\/download\//i.test(u.pathname);
    }
    return (
      host === "objects.githubusercontent.com" ||
      host.endsWith(".githubusercontent.com")
    );
  } catch {
    return false;
  }
}

export function pickGittrAndroidApkAsset(
  assets: GitHubAsset[] | null | undefined
): { name: string; apkUrl: string } | null {
  const apks = (assets || []).filter((a) => {
    const name = String(a.name || "");
    const url = String(a.browser_download_url || "");
    if (!name || !url) return false;
    if (!isApkAssetName(name, a.content_type)) return false;
    if (!isTrustedGittrApkDownloadUrl(url)) return false;
    const n = name.toLowerCase();
    if (n.includes("unsigned") || n.endsWith(".asc")) return false;
    return true;
  });
  const preferred = apks.find((a) =>
    /^gittr-[\d.]+\.apk$/i.test(String(a.name))
  );
  const pick = preferred || apks[0];
  if (!pick?.name || !pick.browser_download_url) return null;
  return { name: String(pick.name), apkUrl: String(pick.browser_download_url) };
}

export type GittrAndroidLatestOk = {
  ok: true;
  tag: string;
  version: string;
  apkUrl: string;
  apkName: string;
  htmlUrl: string;
};

export type GittrAndroidLatestErr = {
  ok: false;
  code: string;
  message: string;
};

export type GittrAndroidLatestResult =
  | GittrAndroidLatestOk
  | GittrAndroidLatestErr;

export function parseGitHubLatestReleaseForGittrApk(
  payload: unknown
): GittrAndroidLatestResult {
  if (!payload || typeof payload !== "object") {
    return {
      ok: false,
      code: "invalid_release",
      message: "GitHub latest release was empty.",
    };
  }
  const r = payload as {
    draft?: boolean;
    tag_name?: string;
    html_url?: string;
    assets?: GitHubAsset[];
  };
  if (r.draft || !r.tag_name) {
    return {
      ok: false,
      code: "no_release",
      message: "No GitHub Release is published yet.",
    };
  }
  const version = versionFromReleaseTag(r.tag_name);
  if (!version) {
    return {
      ok: false,
      code: "invalid_tag",
      message: "Latest Release tag is not a version like v1.0.0.",
    };
  }
  const asset = pickGittrAndroidApkAsset(r.assets);
  if (!asset) {
    return {
      ok: false,
      code: "no_apk",
      message: "Latest GitHub Release has no APK to download.",
    };
  }
  return {
    ok: true,
    tag: String(r.tag_name),
    version,
    apkUrl: asset.apkUrl,
    apkName: asset.name,
    htmlUrl:
      String(r.html_url || "").trim() || GITTR_ANDROID_GITHUB_RELEASES_HTML,
  };
}

export type GittrAndroidUpdateDecision =
  | { kind: "unavailable"; message: string }
  | { kind: "current"; installed: string; latest: string }
  | { kind: "newer"; installed: string | null; latest: string; apkUrl: string };

export function decideGittrAndroidUpdate(args: {
  installed: string | null;
  latest: {
    ok?: boolean;
    version?: string;
    apkUrl?: string;
    message?: string;
  };
}): GittrAndroidUpdateDecision {
  if (!args.latest.ok || !args.latest.version || !args.latest.apkUrl) {
    return {
      kind: "unavailable",
      message:
        args.latest.message || "Could not check for a new app right now.",
    };
  }
  if (
    args.installed &&
    compareSemver(args.installed, args.latest.version) >= 0
  ) {
    return {
      kind: "current",
      installed: args.installed,
      latest: args.latest.version,
    };
  }
  return {
    kind: "newer",
    installed: args.installed,
    latest: args.latest.version,
    apkUrl: args.latest.apkUrl,
  };
}

function githubHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "gittr-space-android-latest",
  };
  const token = process.env.GITHUB_PLATFORM_TOKEN || "";
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

const latestCache = new BoundedTtlCache<GittrAndroidLatestOk>(5 * 60 * 1000, 1);

export async function fetchGittrAndroidLatestFromGitHub(): Promise<GittrAndroidLatestResult> {
  const cached = latestCache.get("latest");
  if (cached) return cached;
  let res: Response;
  try {
    res = await fetch(GITTR_ANDROID_GITHUB_LATEST_API, {
      headers: githubHeaders(),
    });
  } catch {
    return {
      ok: false,
      code: "github_error",
      message: "Could not reach GitHub to check for a new app.",
    };
  }
  if (res.status === 404) {
    return {
      ok: false,
      code: "no_release",
      message: "No GitHub Release is published yet.",
    };
  }
  if (!res.ok) {
    return {
      ok: false,
      code: "github_error",
      message: `GitHub returned ${res.status} while checking for a new app.`,
    };
  }
  let payload: unknown;
  try {
    payload = await res.json();
  } catch {
    return {
      ok: false,
      code: "invalid_release",
      message: "GitHub latest release was empty.",
    };
  }
  const parsed = parseGitHubLatestReleaseForGittrApk(payload);
  if (parsed.ok) latestCache.set("latest", parsed);
  return parsed;
}
