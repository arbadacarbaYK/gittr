import { describe, expect, it } from "vitest";

import type { ForgeReleasesOk } from "../repo/forge-releases";

import { KIND_SOFTWARE_ASSET } from "./nip82-software";
import {
  buildSoftwareAnnounceEvents,
  pickSiblingNip82Assets,
} from "./software-announce-build";

const SHA_APK = "a".repeat(64);
const SHA_MSI = "b".repeat(64);
const SHA_ZIP = "c".repeat(64);

function sampleForge(opts?: {
  includeMsi?: boolean;
  includeZip?: boolean;
  includeSecondApk?: boolean;
  msiHashed?: boolean;
}): ForgeReleasesOk {
  const includeMsi = opts?.includeMsi !== false;
  const assets: ForgeReleasesOk["release"]["assets"] = [
    {
      name: "app-release.apk",
      size: 10,
      contentType: "application/vnd.android.package-archive",
      downloadUrl: "https://example.com/app-release.apk",
      sha256: SHA_APK,
    },
  ];
  if (opts?.includeSecondApk) {
    assets.push({
      name: "app-debug.apk",
      size: 11,
      contentType: "application/vnd.android.package-archive",
      downloadUrl: "https://example.com/app-debug.apk",
      sha256: "d".repeat(64),
    });
  }
  if (includeMsi) {
    assets.push({
      name: "App.msi",
      size: 20,
      contentType: "application/octet-stream",
      downloadUrl: "https://example.com/App.msi",
      ...(opts?.msiHashed === false ? {} : { sha256: SHA_MSI }),
    });
  }
  if (opts?.includeZip) {
    assets.push({
      name: "source.zip",
      size: 30,
      contentType: "application/zip",
      downloadUrl: "https://example.com/source.zip",
      sha256: SHA_ZIP,
    });
  }
  const apkAssets = assets.filter((a) => a.name.endsWith(".apk"));
  return {
    ok: true,
    forge: "github",
    owner: "acme",
    repo: "demo",
    repositoryUrl: "https://github.com/acme/demo",
    release: {
      tag: "v1.2.3",
      name: "1.2.3",
      body: "notes",
      draft: false,
      prerelease: false,
      assets,
      apkAssets,
    },
  };
}

describe("pickSiblingNip82Assets", () => {
  it("includes hashed MSI and skips zip + other APKs", () => {
    const forge = sampleForge({ includeZip: true, includeSecondApk: true });
    const apk = forge.release.apkAssets[0]!;
    const siblings = pickSiblingNip82Assets(forge, apk);
    expect(siblings.map((s) => s.name)).toEqual(["App.msi"]);
  });

  it("omits siblings without sha256", () => {
    const forge = sampleForge({ msiHashed: false });
    const apk = forge.release.apkAssets[0]!;
    expect(pickSiblingNip82Assets(forge, apk)).toEqual([]);
  });
});

describe("buildSoftwareAnnounceEvents", () => {
  it("builds primary APK plus extra MSI asset events", () => {
    const built = buildSoftwareAnnounceEvents({
      forge: sampleForge({ includeZip: true }),
      appId: "space.gittr.demo",
      appName: "Demo",
    });
    expect(built.version).toBe("1.2.3");
    expect(built.asset.kind).toBe(KIND_SOFTWARE_ASSET);
    expect(built.asset.tags.find((t) => t[0] === "m")?.[1]).toBe(
      "application/vnd.android.package-archive"
    );
    expect(built.extraAssets).toHaveLength(1);
    expect(built.extraAssets[0]!.tags.find((t) => t[0] === "m")?.[1]).toBe(
      "application/vnd.microsoft.portable-executable"
    );
    expect(built.extraAssetFiles.map((f) => f.name)).toEqual(["App.msi"]);
    const appFs = built.app.tags.filter((t) => t[0] === "f").map((t) => t[1]);
    expect(appFs).toContain("android-arm64-v8a");
    expect(appFs).toContain("windows-amd64");
  });

  it("skips siblings when includeSiblingAssets is false", () => {
    const built = buildSoftwareAnnounceEvents({
      forge: sampleForge(),
      appId: "space.gittr.demo",
      appName: "Demo",
      includeSiblingAssets: false,
    });
    expect(built.extraAssets).toHaveLength(0);
    expect(built.extraAssetFiles).toHaveLength(0);
  });
});
