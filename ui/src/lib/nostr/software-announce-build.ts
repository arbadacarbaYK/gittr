/**
 * Pure NIP-82 announce event builders (no relay / signer / storage deps).
 * Primary asset can be any hashed NIP-82 MIME file. Prefer APK when present
 * (Zapstore Android). Extra siblings on the same forge tag are optional.
 */
import type {
  ForgeReleaseAsset,
  ForgeReleasesOk,
} from "../repo/forge-releases";
import {
  announceableForgeAssets,
  isApkAssetName,
  nip82MimeForAssetName,
  suggestAppIdFromRepo,
  versionFromTag,
} from "../repo/forge-releases";

import { allowedNip82BlossomAssetUrl } from "./nip82-blossom-hosts";
import {
  KIND_SOFTWARE_APPLICATION,
  KIND_SOFTWARE_ASSET,
  KIND_SOFTWARE_RELEASE,
} from "./nip82-software";

/** Same host as software-catalog-relays — kept here so unit tests stay alias-free. */
export const RELAY_ZAPSTORE_HINT = "wss://relay.zapstore.dev";

/** Loose unsigned event — nostr-tools Kind enum lags NIP-82 kinds. */
export type UnsignedAnnounceEvent = {
  kind: number;
  created_at: number;
  content: string;
  tags: string[][];
  pubkey: string;
};

export type SoftwareAnnounceInput = {
  forge: ForgeReleasesOk;
  appId: string;
  appName: string;
  summary?: string;
  /** Optional SPDX license */
  license?: string;
  /** Optional NIP-34 pointer: 30617:pubkey:repo */
  nip34Address?: string;
  /** Prefer this download URL; default = APK if any, else first announceable file */
  selectedAssetUrl?: string;
  /** Alias of selectedAssetUrl (older callers). */
  selectedApkUrl?: string;
  topics?: string[];
  /**
   * When true (default), also publish other NIP-82 MIME binaries from the same
   * forge release (msi/dmg/appimage/tar.gz/…) that already have sha256.
   */
  includeSiblingAssets?: boolean;
  /**
   * Optional HTTPS overrides for kind 3063 `url` (public Blossom pins only).
   * Keyed by the original forge downloadUrl. gittr Blossom URLs are ignored.
   */
  assetUrlOverrides?: Record<string, string>;
};

export type BuiltSoftwareAnnounce = {
  app: UnsignedAnnounceEvent;
  /** Primary asset (APK when the release has one). */
  asset: UnsignedAnnounceEvent;
  /** Extra platform assets (may be empty). */
  extraAssets: UnsignedAnnounceEvent[];
  release: UnsignedAnnounceEvent;
  version: string;
  appId: string;
  primary: ForgeReleaseAsset;
  /** Same as `primary` — kept for older callers. */
  apk: ForgeReleaseAsset;
  extraAssetFiles: ForgeReleaseAsset[];
};

function assertValidAppId(appId: string): string {
  const id = appId.trim();
  if (!id || id.length > 200) {
    throw new Error("Enter a package id (e.g. com.example.app).");
  }
  if (/\s/.test(id)) {
    throw new Error("Package id cannot contain spaces.");
  }
  return id;
}

function isApkFile(file: ForgeReleaseAsset): boolean {
  return isApkAssetName(file.name, file.contentType);
}

/**
 * Prefer an APK (arm64 when several exist). Otherwise first announceable file.
 * `selectedUrl` wins when it is announceable.
 */
export function pickAnnouncePrimaryAsset(
  forge: ForgeReleasesOk,
  selectedUrl?: string
): ForgeReleaseAsset {
  const all = announceableForgeAssets(forge.release.assets);
  if (all.length === 0) {
    throw new Error("No announceable binaries on this release.");
  }
  if (selectedUrl) {
    const hit = all.find((a) => a.downloadUrl === selectedUrl);
    if (hit) return hit;
  }
  const apks = all.filter((a) => isApkFile(a));
  if (apks.length > 0) {
    const arm64 = apks.find((a) => /arm64|aarch64/i.test(a.name));
    return arm64 || apks[0]!;
  }
  return all[0]!;
}

/** APK-only picker. Throws if the release has no APK. */
export function pickAnnounceApk(
  forge: ForgeReleasesOk,
  selectedApkUrl?: string
): ForgeReleaseAsset {
  const apks = forge.release.apkAssets;
  if (apks.length === 0) {
    throw new Error("No APK assets on this release.");
  }
  if (selectedApkUrl) {
    const hit = apks.find((a) => a.downloadUrl === selectedApkUrl);
    if (hit) return hit;
  }
  const arm64 = apks.find((a) => /arm64|aarch64/i.test(a.name));
  const picked = arm64 || apks[0];
  if (!picked) {
    throw new Error("No APK assets on this release.");
  }
  return picked;
}

/** Other forge files on the same tag that NIP-82 can carry (not the chosen primary). */
export function pickSiblingNip82Assets(
  forge: ForgeReleasesOk,
  primary: ForgeReleaseAsset
): ForgeReleaseAsset[] {
  const out: ForgeReleaseAsset[] = [];
  for (const a of forge.release.assets) {
    if (a.downloadUrl === primary.downloadUrl) continue;
    if (isSameApkFamily(a, primary)) continue;
    const nip = nip82MimeForAssetName(a.name);
    if (!nip) continue;
    if (!a.sha256 || !/^[0-9a-f]{64}$/i.test(a.sha256)) continue;
    out.push(a);
  }
  return out;
}

function isSameApkFamily(
  a: ForgeReleaseAsset,
  primary: ForgeReleaseAsset
): boolean {
  return isApkFile(a) && isApkFile(primary);
}

function buildAssetEvent(
  appId: string,
  version: string,
  file: ForgeReleaseAsset,
  now: number,
  urlOverride?: string
): UnsignedAnnounceEvent {
  const nip = nip82MimeForAssetName(file.name);
  if (!nip) {
    throw new Error(`Cannot announce ${file.name}: unknown binary type.`);
  }
  const url = (urlOverride || file.downloadUrl).trim();
  const tags: string[][] = [
    ["i", appId],
    ["x", String(file.sha256).toLowerCase()],
    ["m", nip.mime],
    ["url", url],
    ["version", version],
  ];
  if (nip.f) tags.push(["f", nip.f]);
  if (file.size > 0) tags.push(["size", String(file.size)]);
  return {
    kind: KIND_SOFTWARE_ASSET,
    created_at: now,
    content: "",
    tags,
    pubkey: "",
  };
}

/**
 * Build unsigned NIP-82 events. Primary asset requires sha256 (`x`).
 * `t=android` / default android `f` only when an APK is in the published set.
 */
export function buildSoftwareAnnounceEvents(
  input: SoftwareAnnounceInput
): BuiltSoftwareAnnounce {
  const appId = assertValidAppId(
    input.appId || suggestAppIdFromRepo(input.forge.repo)
  );
  const version = versionFromTag(input.forge.release.tag);
  const selectedUrl = input.selectedAssetUrl || input.selectedApkUrl;
  const primary = pickAnnouncePrimaryAsset(input.forge, selectedUrl);
  if (!primary.sha256 || !/^[0-9a-f]{64}$/i.test(primary.sha256)) {
    throw new Error(
      "Missing file sha256. Reload the release with hashing enabled before publishing."
    );
  }

  const includeSiblings = input.includeSiblingAssets !== false;
  const extraAssetFiles = includeSiblings
    ? pickSiblingNip82Assets(input.forge, primary)
    : [];

  const name = (input.appName || input.forge.repo).trim() || input.forge.repo;
  const summary = (input.summary || "").trim().slice(0, 280);
  const now = Math.floor(Date.now() / 1000);

  const published = [primary, ...extraAssetFiles];
  const hasApk = published.some((f) => isApkFile(f));

  const platformFs = new Set<string>();
  for (const file of published) {
    const nip = nip82MimeForAssetName(file.name);
    if (nip?.f) platformFs.add(nip.f);
  }
  if (hasApk && ![...platformFs].some((f) => f.startsWith("android-"))) {
    platformFs.add("android-arm64-v8a");
  }

  const appTags: string[][] = [
    ["d", appId],
    ["name", name],
    ["repository", input.forge.repositoryUrl],
  ];
  if (hasApk) appTags.push(["t", "android"]);
  for (const f of platformFs) appTags.push(["f", f]);
  if (summary) appTags.push(["summary", summary]);
  if (input.license?.trim()) appTags.push(["license", input.license.trim()]);
  for (const t of input.topics || []) {
    if (t?.trim()) appTags.push(["t", t.trim()]);
  }
  if (input.nip34Address?.trim()) {
    appTags.push(["a", input.nip34Address.trim(), RELAY_ZAPSTORE_HINT]);
  }

  const app: UnsignedAnnounceEvent = {
    kind: KIND_SOFTWARE_APPLICATION,
    created_at: now,
    content: input.forge.release.body || summary || name,
    tags: appTags,
    pubkey: "",
  };

  const urlFor = (file: ForgeReleaseAsset) => {
    const raw = input.assetUrlOverrides?.[file.downloadUrl];
    if (!raw) return undefined;
    return allowedNip82BlossomAssetUrl(raw) ?? undefined;
  };

  const asset = buildAssetEvent(appId, version, primary, now, urlFor(primary));
  const extraAssets = extraAssetFiles.map((f) =>
    buildAssetEvent(appId, version, f, now, urlFor(f))
  );

  // Release `e` tags filled after assets are signed (need event ids).
  const release: UnsignedAnnounceEvent = {
    kind: KIND_SOFTWARE_RELEASE,
    created_at: now,
    content: input.forge.release.body || "",
    tags: [
      ["d", `${appId}@${version}`],
      ["i", appId],
      ["version", version],
      ["c", "main"],
    ],
    pubkey: "",
  };

  return {
    app,
    asset,
    extraAssets,
    release,
    version,
    appId,
    primary,
    apk: primary,
    extraAssetFiles,
  };
}
