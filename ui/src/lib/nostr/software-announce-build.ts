/**
 * Pure NIP-82 announce event builders (no relay / signer / storage deps).
 * Zapstore (Android) still requires an APK; extra NIP-82 MIME siblings are optional.
 */
import type {
  ForgeReleaseAsset,
  ForgeReleasesOk,
} from "../repo/forge-releases";
import {
  nip82MimeForAssetName,
  suggestAppIdFromRepo,
  versionFromTag,
} from "../repo/forge-releases";

import {
  KIND_SOFTWARE_APPLICATION,
  KIND_SOFTWARE_ASSET,
  KIND_SOFTWARE_RELEASE,
  MIME_ANDROID_APK,
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
  /** Prefer one APK; default = first apk asset */
  selectedApkUrl?: string;
  topics?: string[];
  /**
   * When true (default), also publish other NIP-82 MIME binaries from the same
   * forge release (msi/dmg/appimage/…) that already have sha256.
   */
  includeSiblingAssets?: boolean;
};

export type BuiltSoftwareAnnounce = {
  app: UnsignedAnnounceEvent;
  /** Primary APK asset (Zapstore). */
  asset: UnsignedAnnounceEvent;
  /** Extra platform assets (may be empty). */
  extraAssets: UnsignedAnnounceEvent[];
  release: UnsignedAnnounceEvent;
  version: string;
  appId: string;
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

/** Other forge files on the same tag that NIP-82 can carry (not the chosen APK). */
export function pickSiblingNip82Assets(
  forge: ForgeReleasesOk,
  apk: ForgeReleaseAsset
): ForgeReleaseAsset[] {
  const out: ForgeReleaseAsset[] = [];
  for (const a of forge.release.assets) {
    if (a.downloadUrl === apk.downloadUrl) continue;
    if (isSameApkFamily(a, apk)) continue;
    const nip = nip82MimeForAssetName(a.name);
    if (!nip) continue;
    if (!a.sha256 || !/^[0-9a-f]{64}$/i.test(a.sha256)) continue;
    out.push(a);
  }
  return out;
}

function isSameApkFamily(
  a: ForgeReleaseAsset,
  apk: ForgeReleaseAsset
): boolean {
  return (
    a.name.toLowerCase().endsWith(".apk") &&
    apk.name.toLowerCase().endsWith(".apk")
  );
}

function buildAssetEvent(
  appId: string,
  version: string,
  file: ForgeReleaseAsset,
  now: number
): UnsignedAnnounceEvent {
  const nip = nip82MimeForAssetName(file.name) || {
    mime: MIME_ANDROID_APK,
    f: "android-arm64-v8a",
  };
  const tags: string[][] = [
    ["i", appId],
    ["x", String(file.sha256).toLowerCase()],
    ["m", nip.mime],
    ["url", file.downloadUrl],
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
 * Build unsigned NIP-82 events. Primary APK requires sha256 (`x`).
 */
export function buildSoftwareAnnounceEvents(
  input: SoftwareAnnounceInput
): BuiltSoftwareAnnounce {
  const appId = assertValidAppId(
    input.appId || suggestAppIdFromRepo(input.forge.repo)
  );
  const version = versionFromTag(input.forge.release.tag);
  const apk = pickAnnounceApk(input.forge, input.selectedApkUrl);
  if (!apk.sha256 || !/^[0-9a-f]{64}$/i.test(apk.sha256)) {
    throw new Error(
      "Missing APK sha256. Reload the release with hashing enabled before publishing."
    );
  }

  const includeSiblings = input.includeSiblingAssets !== false;
  const extraAssetFiles = includeSiblings
    ? pickSiblingNip82Assets(input.forge, apk)
    : [];

  const name = (input.appName || input.forge.repo).trim() || input.forge.repo;
  const summary = (input.summary || "").trim().slice(0, 280);
  const now = Math.floor(Date.now() / 1000);

  const platformFs = new Set<string>(["android-arm64-v8a"]);
  for (const extra of extraAssetFiles) {
    const nip = nip82MimeForAssetName(extra.name);
    if (nip?.f) platformFs.add(nip.f);
  }

  const appTags: string[][] = [
    ["d", appId],
    ["name", name],
    ["repository", input.forge.repositoryUrl],
    ["t", "android"],
  ];
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

  const asset = buildAssetEvent(appId, version, apk, now);
  const extraAssets = extraAssetFiles.map((f) =>
    buildAssetEvent(appId, version, f, now)
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
    apk,
    extraAssetFiles,
  };
}
