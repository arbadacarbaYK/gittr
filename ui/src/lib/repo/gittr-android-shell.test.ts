import { describe, expect, it } from "vitest";

import {
  GITTR_ANDROID_SHELL_STORAGE_KEY,
  compareSemver,
  installedGittrAppVersion,
  isGittrAndroidShell,
  parseSemverParts,
  rememberGittrAndroidShellFromLocation,
} from "./gittr-android-shell";

describe("gittr Android shell detection", () => {
  it("parses GittrApp/x.y.z from the WebView user-agent", () => {
    expect(
      installedGittrAppVersion("Mozilla/5.0 Linux Android GittrApp/1.0.0")
    ).toBe("1.0.0");
    expect(installedGittrAppVersion("Mozilla/5.0")).toBeNull();
  });

  it("treats GittrApp UA or ?source=apk as the Android shell", () => {
    expect(
      isGittrAndroidShell({
        userAgent: "GittrApp/1.0.0",
        search: "",
        storage: { getItem: () => null },
      })
    ).toBe(true);
    expect(
      isGittrAndroidShell({
        userAgent: "Mozilla/5.0",
        search: "?source=apk",
        storage: { getItem: () => null },
      })
    ).toBe(true);
    expect(
      isGittrAndroidShell({
        userAgent: "Mozilla/5.0",
        search: "",
        storage: { getItem: () => null },
      })
    ).toBe(false);
  });

  it("remembers ?source=apk in session storage", () => {
    const store: Record<string, string> = {};
    rememberGittrAndroidShellFromLocation("?foo=1", {
      setItem: (k, v) => {
        store[k] = v;
      },
    });
    expect(store[GITTR_ANDROID_SHELL_STORAGE_KEY]).toBeUndefined();
    rememberGittrAndroidShellFromLocation("?source=apk", {
      setItem: (k, v) => {
        store[k] = v;
      },
    });
    expect(store[GITTR_ANDROID_SHELL_STORAGE_KEY]).toBe("1");
    expect(
      isGittrAndroidShell({
        userAgent: "Mozilla/5.0",
        search: "",
        storage: { getItem: (k) => store[k] ?? null },
      })
    ).toBe(true);
  });

  it("compares installer versions numerically", () => {
    expect(parseSemverParts("v0.10.0")).toEqual([0, 10, 0]);
    expect(compareSemver("0.3.1", "0.3.1")).toBe(0);
    expect(compareSemver("0.3.1", "0.3.2")).toBeLessThan(0);
    expect(compareSemver("0.10.0", "0.3.2")).toBeGreaterThan(0);
    expect(compareSemver("0.3.1", "1.0.0")).toBeLessThan(0);
    expect(compareSemver(null, "0.3.1")).toBeLessThan(0);
  });
});
