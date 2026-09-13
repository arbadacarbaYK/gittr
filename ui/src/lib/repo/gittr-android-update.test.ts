import { describe, expect, it } from "vitest";

import { runGittrAndroidUpdateCheck } from "./gittr-android-update";

const GITHUB_APK =
  "https://github.com/arbadacarbaYK/gittr/releases/download/v0.3.2/gittr-0.3.2.apk";

describe("runGittrAndroidUpdateCheck", () => {
  it("opens GitHub when a newer APK exists and the user confirms", async () => {
    const opened: string[] = [];
    const outcome = await runGittrAndroidUpdateCheck({
      installed: "0.3.1",
      fetchImpl: async () =>
        ({
          json: async () => ({
            ok: true,
            version: "0.3.2",
            apkUrl: GITHUB_APK,
          }),
        } as Response),
      alertFn: async () => undefined,
      confirmFn: async () => true,
      openUrl: (url) => opened.push(url),
    });
    expect(outcome).toBe("opened");
    expect(opened).toEqual([GITHUB_APK]);
  });

  it("stops when the user is already current", async () => {
    const opened: string[] = [];
    const alerts: string[] = [];
    const outcome = await runGittrAndroidUpdateCheck({
      installed: "0.3.2",
      fetchImpl: async () =>
        ({
          json: async () => ({
            ok: true,
            version: "0.3.2",
            apkUrl: GITHUB_APK,
          }),
        } as Response),
      alertFn: async (message) => {
        alerts.push(message);
      },
      confirmFn: async () => true,
      openUrl: (url) => opened.push(url),
    });
    expect(outcome).toBe("current");
    expect(opened).toEqual([]);
    expect(alerts[0]).toMatch(/latest/i);
  });

  it("does not open GitHub when the user cancels", async () => {
    const opened: string[] = [];
    const outcome = await runGittrAndroidUpdateCheck({
      installed: "0.3.1",
      fetchImpl: async () =>
        ({
          json: async () => ({
            ok: true,
            version: "0.3.2",
            apkUrl: GITHUB_APK,
          }),
        } as Response),
      alertFn: async () => undefined,
      confirmFn: async () => false,
      openUrl: (url) => opened.push(url),
    });
    expect(outcome).toBe("cancelled");
    expect(opened).toEqual([]);
  });
});
