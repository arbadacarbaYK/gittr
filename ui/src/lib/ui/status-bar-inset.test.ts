import { describe, expect, it } from "vitest";

import {
  GITTR_STATUS_BAR_GAP_CLASS,
  applyGittrStatusBarGapClass,
  displayModeNeedsStatusBarGap,
  needsStatusBarGap,
} from "./status-bar-inset";

describe("status bar inset gap", () => {
  it("does not pad a normal mobile browser tab", () => {
    expect(
      needsStatusBarGap({
        userAgent: "Mozilla/5.0 Linux Android Chrome/120",
        search: "",
        storage: { getItem: () => null },
      })
    ).toBe(false);
  });

  it("pads the gittr Android WebView shell", () => {
    expect(
      needsStatusBarGap({
        userAgent: "Mozilla/5.0 Linux Android GittrApp/0.3.1",
        search: "",
        storage: { getItem: () => null },
      })
    ).toBe(true);
    expect(
      needsStatusBarGap({
        userAgent: "Mozilla/5.0",
        search: "?source=apk",
        storage: { getItem: () => null },
      })
    ).toBe(true);
    expect(
      needsStatusBarGap({
        userAgent: "Mozilla/5.0",
        search: "",
        storage: { getItem: (k) => (k === "gittr_android_shell" ? "1" : null) },
      })
    ).toBe(true);
  });

  it("pads installed PWA / fullscreen / iOS standalone chrome", () => {
    expect(needsStatusBarGap({ displayStandalone: true })).toBe(true);
    expect(needsStatusBarGap({ iosStandalone: true })).toBe(true);
    expect(
      displayModeNeedsStatusBarGap((q) => ({
        matches: q.includes("standalone"),
      }))
    ).toBe(true);
    expect(
      displayModeNeedsStatusBarGap((q) => ({
        matches: q.includes("fullscreen"),
      }))
    ).toBe(true);
    expect(displayModeNeedsStatusBarGap(() => ({ matches: false }), true)).toBe(
      true
    );
    expect(displayModeNeedsStatusBarGap(() => ({ matches: false }))).toBe(
      false
    );
  });

  it("toggles the html class used by CSS", () => {
    const classes = new Set<string>();
    const root = {
      classList: {
        toggle: (name: string, force?: boolean) => {
          if (force) classes.add(name);
          else classes.delete(name);
          return force === true;
        },
      },
    };
    expect(
      applyGittrStatusBarGapClass(root, {
        userAgent: "GittrApp/0.3.1",
        search: "",
        storage: { getItem: () => null },
        displayStandalone: false,
        iosStandalone: false,
      })
    ).toBe(true);
    expect(classes.has(GITTR_STATUS_BAR_GAP_CLASS)).toBe(true);

    applyGittrStatusBarGapClass(root, {
      userAgent: "Mozilla/5.0",
      search: "",
      storage: { getItem: () => null },
      displayStandalone: false,
      iosStandalone: false,
    });
    expect(classes.has(GITTR_STATUS_BAR_GAP_CLASS)).toBe(false);
  });
});
