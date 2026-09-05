import { describe, expect, it } from "vitest";

import type { ForgeRelease } from "./forge-releases";
import {
  nip82MimeForAssetName,
  pickForgeReleaseForAnnounce,
} from "./forge-releases";

function release(tag: string, draft = false): ForgeRelease {
  return {
    tag,
    name: tag,
    body: "",
    draft,
    prerelease: false,
    assets: [],
    apkAssets: [],
  };
}

describe("pickForgeReleaseForAnnounce", () => {
  const list = [
    release("v2.0.0-beta", false),
    release("v1.2.3"),
    release("v1.0.0"),
  ];

  it("picks first non-draft when tag omitted", () => {
    expect(pickForgeReleaseForAnnounce(list)?.tag).toBe("v2.0.0-beta");
    expect(
      pickForgeReleaseForAnnounce([
        release("draft-only", true),
        release("v1.0.0"),
      ])?.tag
    ).toBe("v1.0.0");
  });

  it("matches exact then case-insensitive tag", () => {
    expect(pickForgeReleaseForAnnounce(list, "v1.2.3")?.tag).toBe("v1.2.3");
    expect(pickForgeReleaseForAnnounce(list, "V1.0.0")?.tag).toBe("v1.0.0");
  });

  it("returns null for missing tag or empty list", () => {
    expect(pickForgeReleaseForAnnounce(list, "v9.9.9")).toBeNull();
    expect(pickForgeReleaseForAnnounce([], "v1.0.0")).toBeNull();
    expect(pickForgeReleaseForAnnounce([])).toBeNull();
  });
});

describe("nip82MimeForAssetName", () => {
  it("maps APK / IPA / DMG / AppImage / MSI / EXE", () => {
    expect(nip82MimeForAssetName("app-arm64.apk")).toEqual({
      mime: "application/vnd.android.package-archive",
      f: "android-arm64-v8a",
    });
    expect(nip82MimeForAssetName("app-release.apk")?.mime).toBe(
      "application/vnd.android.package-archive"
    );
    expect(nip82MimeForAssetName("app-release.apk")?.f).toBeUndefined();

    expect(nip82MimeForAssetName("Thing.ipa")).toEqual({
      mime: "application/vnd.apple.ipa",
      f: "ios-arm64",
    });

    expect(nip82MimeForAssetName("Thing-arm64.dmg")).toEqual({
      mime: "application/x-apple-diskimage",
      f: "darwin-arm64",
    });
    expect(nip82MimeForAssetName("Thing.dmg")).toEqual({
      mime: "application/x-apple-diskimage",
      f: "darwin-amd64",
    });

    expect(nip82MimeForAssetName("Thing.AppImage")).toEqual({
      mime: "application/vnd.appimage",
      f: "linux-amd64",
    });
    expect(nip82MimeForAssetName("Thing-arm64.AppImage")).toEqual({
      mime: "application/vnd.appimage",
      f: "linux-arm64",
    });

    expect(nip82MimeForAssetName("Thing.msi")).toEqual({
      mime: "application/vnd.microsoft.portable-executable",
      f: "windows-amd64",
    });
    expect(nip82MimeForAssetName("Thing.exe")).toEqual({
      mime: "application/vnd.microsoft.portable-executable",
      f: "windows-amd64",
    });
  });

  it("maps linux tarballs and debs (Dan-style musl tar.gz)", () => {
    expect(
      nip82MimeForAssetName(
        "ngit-grasp-3.0.1-x86_64-unknown-linux-musl.tar.gz"
      )
    ).toEqual({
      mime: "application/gzip",
      f: "linux-amd64",
    });
    expect(
      nip82MimeForAssetName("tool-aarch64-unknown-linux-musl.tar.gz")
    ).toEqual({
      mime: "application/gzip",
      f: "linux-arm64",
    });
    expect(nip82MimeForAssetName("tool-arm64.tgz")).toEqual({
      mime: "application/gzip",
      f: "linux-arm64",
    });
    expect(nip82MimeForAssetName("tool-x86_64.tar.xz")).toEqual({
      mime: "application/x-xz",
      f: "linux-amd64",
    });
    expect(nip82MimeForAssetName("Thing_amd64.deb")).toEqual({
      mime: "application/vnd.debian.binary-package",
      f: "linux-amd64",
    });
  });

  it("returns null for display-only files (zip, source tarball, checksums)", () => {
    expect(nip82MimeForAssetName("source.zip")).toBeNull();
    expect(nip82MimeForAssetName("project-source.tar.gz")).toBeNull();
    expect(nip82MimeForAssetName("SHA256SUMS.txt")).toBeNull();
    expect(nip82MimeForAssetName("notes.md")).toBeNull();
  });
});
