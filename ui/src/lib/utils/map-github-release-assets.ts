/**
 * Map GitHub (and similar forge) release asset rows into gittr Releases UI shape.
 */

export type GithubReleaseAssetLike = {
  name?: string;
  browser_download_url?: string;
  size?: number;
  content_type?: string;
  contentType?: string;
};

export type SyncedReleaseAsset = {
  name: string;
  platform: string;
  url: string;
  size?: number;
  contentType?: string;
};

/** Infer a short platform label from asset filename / content-type. */
export function inferReleaseAssetPlatform(
  name: string,
  contentType?: string
): string {
  const n = name.toLowerCase();
  const ct = (contentType || "").toLowerCase();

  if (
    n.includes("sha256sums") ||
    n.endsWith(".sig") ||
    n.endsWith(".asc") ||
    n.endsWith(".sum") ||
    ct.includes("pgp-signature")
  ) {
    return "checksums";
  }
  if (n.endsWith(".apk") || ct.includes("android.package")) {
    return "android";
  }
  if (
    n.endsWith(".msi") ||
    n.endsWith(".exe") ||
    n.includes("win-") ||
    n.includes("windows") ||
    n.includes("-win")
  ) {
    return "windows";
  }
  if (
    n.endsWith(".dmg") ||
    n.includes("macos") ||
    n.includes("darwin") ||
    n.includes("osx") ||
    n.includes("mac-")
  ) {
    return "macos";
  }
  if (
    n.endsWith(".appimage") ||
    n.endsWith(".deb") ||
    n.endsWith(".rpm") ||
    n.includes("linux") ||
    (n.includes("arm64") && (n.endsWith(".tar.gz") || n.endsWith(".tar.xz")))
  ) {
    return "linux";
  }
  if (n.includes("linux")) return "linux";
  if (n.endsWith(".ipa")) return "ios";
  return "file";
}

export function mapGithubReleaseAssets(raw: unknown): SyncedReleaseAsset[] {
  if (!Array.isArray(raw)) return [];
  const out: SyncedReleaseAsset[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const a = item as GithubReleaseAssetLike;
    const name = String(a.name || "").trim();
    const url = String(a.browser_download_url || "").trim();
    if (!name || !url) continue;
    const contentType = a.content_type || a.contentType;
    const size =
      typeof a.size === "number" && Number.isFinite(a.size)
        ? a.size
        : undefined;
    out.push({
      name,
      url,
      platform: inferReleaseAssetPlatform(name, contentType),
      size,
      contentType: contentType ? String(contentType) : undefined,
    });
  }
  return out;
}
