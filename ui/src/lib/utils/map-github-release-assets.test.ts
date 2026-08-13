import { describe, expect, it } from "vitest";

import {
  inferReleaseAssetPlatform,
  mapGithubReleaseAssets,
} from "./map-github-release-assets";

describe("inferReleaseAssetPlatform", () => {
  it("labels common desktop / mobile / checksum names", () => {
    expect(inferReleaseAssetPlatform("Wasabi-2.8.1.1.AppImage")).toBe("linux");
    expect(inferReleaseAssetPlatform("Wasabi-2.8.1.1.deb")).toBe("linux");
    expect(inferReleaseAssetPlatform("Wasabi-2.8.1.1.dmg")).toBe("macos");
    expect(inferReleaseAssetPlatform("Wasabi-2.8.1.1.msi")).toBe("windows");
    expect(inferReleaseAssetPlatform("Wasabi-2.8.1.1-win-x64.zip")).toBe(
      "windows"
    );
    expect(inferReleaseAssetPlatform("Wasabi-2.8.1.1-macOS-arm64.zip")).toBe(
      "macos"
    );
    expect(inferReleaseAssetPlatform("Wasabi-2.8.1.1-linux-x64.zip")).toBe(
      "linux"
    );
    expect(inferReleaseAssetPlatform("app-release.apk")).toBe("android");
    expect(inferReleaseAssetPlatform("SHA256SUMS.txt")).toBe("checksums");
    expect(inferReleaseAssetPlatform("SHA256SUMS.txt.sig")).toBe("checksums");
  });
});

describe("mapGithubReleaseAssets", () => {
  it("maps browser_download_url assets and skips incomplete rows", () => {
    const assets = mapGithubReleaseAssets([
      {
        name: "Wasabi-2.8.1.1.msi",
        browser_download_url:
          "https://github.com/kravens/WalletWasabi/releases/download/v2.8.1.1/Wasabi-2.8.1.1.msi",
        size: 97832100,
        content_type: "application/octet-stream",
      },
      {
        name: "SHA256SUMS.txt",
        browser_download_url:
          "https://github.com/kravens/WalletWasabi/releases/download/v2.8.1.1/SHA256SUMS.txt",
        size: 1300,
      },
      { name: "broken-no-url" },
      null,
    ]);
    expect(assets).toHaveLength(2);
    expect(assets[0]).toMatchObject({
      name: "Wasabi-2.8.1.1.msi",
      platform: "windows",
      size: 97832100,
    });
    expect(assets[1]?.platform).toBe("checksums");
  });
});
