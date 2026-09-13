import { describe, expect, it } from "vitest";

import {
  decideGittrAndroidUpdate,
  isTrustedGittrApkDownloadUrl,
  parseGitHubLatestReleaseForGittrApk,
  pickGittrAndroidApkAsset,
  versionFromReleaseTag,
} from "./gittr-android-latest";

const GITHUB_APK =
  "https://github.com/arbadacarbaYK/gittr/releases/download/v0.3.2/gittr-0.3.2.apk";

describe("gittr Android latest GitHub APK", () => {
  it("strips a v prefix from Release tags", () => {
    expect(versionFromReleaseTag("v0.3.1")).toBe("0.3.1");
    expect(versionFromReleaseTag("0.3.1")).toBe("0.3.1");
    expect(versionFromReleaseTag("nightly")).toBeNull();
  });

  it("only trusts GitHub APK download URLs", () => {
    expect(isTrustedGittrApkDownloadUrl(GITHUB_APK)).toBe(true);
    expect(
      isTrustedGittrApkDownloadUrl(
        "https://objects.githubusercontent.com/github-production-release-asset-2e65be/gittr-0.3.2.apk"
      )
    ).toBe(true);
    expect(
      isTrustedGittrApkDownloadUrl("https://blossom.gittr.space/abc.apk")
    ).toBe(false);
    expect(
      isTrustedGittrApkDownloadUrl("https://evil.example/gittr-0.3.2.apk")
    ).toBe(false);
  });

  it("prefers gittr-x.y.z.apk over other APKs", () => {
    const picked = pickGittrAndroidApkAsset([
      {
        name: "other.apk",
        browser_download_url:
          "https://github.com/arbadacarbaYK/gittr/releases/download/v0.3.2/other.apk",
      },
      {
        name: "gittr-0.3.2.apk",
        browser_download_url: GITHUB_APK,
      },
    ]);
    expect(picked?.name).toBe("gittr-0.3.2.apk");
    expect(
      pickGittrAndroidApkAsset([
        {
          name: "gittr-0.3.2.apk",
          browser_download_url: "https://blossom.gittr.space/gittr-0.3.2.apk",
        },
      ])
    ).toBeNull();
  });

  it("parses a GitHub latest-release payload", () => {
    const parsed = parseGitHubLatestReleaseForGittrApk({
      tag_name: "v0.3.2",
      html_url: "https://github.com/arbadacarbaYK/gittr/releases/tag/v0.3.2",
      assets: [{ name: "gittr-0.3.2.apk", browser_download_url: GITHUB_APK }],
    });
    expect(parsed).toEqual({
      ok: true,
      tag: "v0.3.2",
      version: "0.3.2",
      apkUrl: GITHUB_APK,
      apkName: "gittr-0.3.2.apk",
      htmlUrl: "https://github.com/arbadacarbaYK/gittr/releases/tag/v0.3.2",
    });
  });

  it("decides current vs newer vs unavailable", () => {
    expect(
      decideGittrAndroidUpdate({
        installed: "0.3.2",
        latest: { ok: true, version: "0.3.2", apkUrl: GITHUB_APK },
      })
    ).toEqual({
      kind: "current",
      installed: "0.3.2",
      latest: "0.3.2",
    });
    expect(
      decideGittrAndroidUpdate({
        installed: "0.3.1",
        latest: { ok: true, version: "0.3.2", apkUrl: GITHUB_APK },
      })
    ).toEqual({
      kind: "newer",
      installed: "0.3.1",
      latest: "0.3.2",
      apkUrl: GITHUB_APK,
    });
    expect(
      decideGittrAndroidUpdate({
        installed: null,
        latest: { ok: true, version: "0.3.2", apkUrl: GITHUB_APK },
      }).kind
    ).toBe("newer");
    expect(
      decideGittrAndroidUpdate({
        installed: "0.3.1",
        latest: { ok: false, message: "down" },
      })
    ).toEqual({ kind: "unavailable", message: "down" });
  });
});
