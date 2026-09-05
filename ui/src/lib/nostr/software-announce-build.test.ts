import { describe, expect, it } from "vitest";

import type {
  ForgeReleaseAsset,
  ForgeReleasesOk,
} from "../repo/forge-releases";

import { KIND_SOFTWARE_ASSET } from "./nip82-software";
import {
  buildSoftwareAnnounceEvents,
  pickAnnouncePrimaryAsset,
  pickSiblingNip82Assets,
} from "./software-announce-build";

const SHA_APK = "a".repeat(64);
const SHA_MSI = "b".repeat(64);
const SHA_ZIP = "c".repeat(64);
const SHA_TGZ = "e".repeat(64);

function asset(
  name: string,
  downloadUrl: string,
  sha256?: string,
  size = 10
): ForgeReleaseAsset {
  return {
    name,
    size,
    contentType: "application/octet-stream",
    downloadUrl,
    ...(sha256 ? { sha256 } : {}),
  };
}

function sampleForge(opts?: {
  includeMsi?: boolean;
  includeZip?: boolean;
  includeSecondApk?: boolean;
  includeTarball?: boolean;
  apk?: boolean;
  msiHashed?: boolean;
}): ForgeReleasesOk {
  const includeMsi = opts?.includeMsi !== false;
  const includeApk = opts?.apk !== false;
  const assets: ForgeReleaseAsset[] = [];
  if (includeApk) {
    assets.push(
      asset("app-release.apk", "https://example.com/app-release.apk", SHA_APK)
    );
  }
  if (opts?.includeSecondApk) {
    assets.push(
      asset(
        "app-debug.apk",
        "https://example.com/app-debug.apk",
        "d".repeat(64),
        11
      )
    );
  }
  if (includeMsi) {
    assets.push(
      asset(
        "App.msi",
        "https://example.com/App.msi",
        opts?.msiHashed === false ? undefined : SHA_MSI,
        20
      )
    );
  }
  if (opts?.includeZip) {
    assets.push(
      asset("source.zip", "https://example.com/source.zip", SHA_ZIP, 30)
    );
  }
  if (opts?.includeTarball) {
    assets.push(
      asset(
        "ngit-grasp-3.0.1-x86_64-unknown-linux-musl.tar.gz",
        "https://example.com/ngit-grasp.tar.gz",
        SHA_TGZ,
        40
      )
    );
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

describe("pickAnnouncePrimaryAsset", () => {
  it("prefers APK when APK and tarball both exist", () => {
    const forge = sampleForge({ includeTarball: true });
    expect(pickAnnouncePrimaryAsset(forge).name).toBe("app-release.apk");
  });

  it("picks linux tarball when there is no APK", () => {
    const forge = sampleForge({
      apk: false,
      includeMsi: false,
      includeTarball: true,
    });
    expect(pickAnnouncePrimaryAsset(forge).name).toContain("linux-musl.tar.gz");
  });

  it("honors selectedAssetUrl over APK preference", () => {
    const forge = sampleForge({ includeTarball: true });
    const tgz = forge.release.assets.find((a) => a.name.endsWith(".tar.gz"))!;
    expect(pickAnnouncePrimaryAsset(forge, tgz.downloadUrl).name).toBe(
      tgz.name
    );
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
    expect(built.primary.name).toBe("app-release.apk");
    expect(built.apk).toBe(built.primary);
    expect(built.asset.kind).toBe(KIND_SOFTWARE_ASSET);
    expect(built.asset.tags.find((t) => t[0] === "m")?.[1]).toBe(
      "application/vnd.android.package-archive"
    );
    expect(built.extraAssets).toHaveLength(1);
    expect(built.extraAssets[0]!.tags.find((t) => t[0] === "m")?.[1]).toBe(
      "application/vnd.microsoft.portable-executable"
    );
    expect(built.extraAssetFiles.map((f) => f.name)).toEqual(["App.msi"]);
    const appTs = built.app.tags.filter((t) => t[0] === "t").map((t) => t[1]);
    expect(appTs).toContain("android");
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

  it("announces a linux tarball without android tags", () => {
    const built = buildSoftwareAnnounceEvents({
      forge: sampleForge({
        apk: false,
        includeMsi: false,
        includeTarball: true,
      }),
      appId: "space.gittr.ngit",
      appName: "ngit-grasp",
    });
    expect(built.primary.name).toContain("linux-musl.tar.gz");
    expect(built.asset.tags.find((t) => t[0] === "m")?.[1]).toBe(
      "application/gzip"
    );
    expect(built.asset.tags.find((t) => t[0] === "f")?.[1]).toBe("linux-amd64");
    expect(built.asset.tags.find((t) => t[0] === "url")?.[1]).toBe(
      "https://example.com/ngit-grasp.tar.gz"
    );
    const appTs = built.app.tags.filter((t) => t[0] === "t").map((t) => t[1]);
    expect(appTs).not.toContain("android");
    const appFs = built.app.tags.filter((t) => t[0] === "f").map((t) => t[1]);
    expect(appFs).toEqual(["linux-amd64"]);
  });

  it("puts a public Blossom override on kind 3063 url when provided", () => {
    const forge = sampleForge({
      apk: false,
      includeMsi: false,
      includeTarball: true,
    });
    const tgz = forge.release.assets.find((a) => a.name.endsWith(".tar.gz"))!;
    const blossom = `https://blossom.primal.net/${SHA_TGZ}`;
    const built = buildSoftwareAnnounceEvents({
      forge,
      appId: "space.gittr.ngit",
      appName: "ngit-grasp",
      assetUrlOverrides: { [tgz.downloadUrl]: blossom },
    });
    expect(built.asset.tags.find((t) => t[0] === "url")?.[1]).toBe(blossom);
  });

  it("ignores gittr Pages Blossom overrides so APKs are not announced there", () => {
    const forge = sampleForge({
      apk: false,
      includeMsi: false,
      includeTarball: true,
    });
    const tgz = forge.release.assets.find((a) => a.name.endsWith(".tar.gz"))!;
    const built = buildSoftwareAnnounceEvents({
      forge,
      appId: "space.gittr.ngit",
      appName: "ngit-grasp",
      assetUrlOverrides: {
        [tgz.downloadUrl]: `https://blossom.gittr.space/${SHA_TGZ}`,
      },
    });
    expect(built.asset.tags.find((t) => t[0] === "url")?.[1]).toBe(
      tgz.downloadUrl
    );
  });
});
