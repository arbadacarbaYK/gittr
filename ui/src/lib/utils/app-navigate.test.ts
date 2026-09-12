import { describe, expect, it } from "vitest";

import {
  SOFT_NAV_HARD_FALLBACK_FROM_CODE_HOME_MS,
  SOFT_NAV_HARD_FALLBACK_MS,
  hrefLeavesCurrentPath,
  isHeavyDirectoryPath,
  isLiveCatalogPath,
  isProfileEntityPath,
  isRepoCodePath,
  isUrgentLeavePath,
  shouldApplySoftNavHardFallback,
  shouldHardNavigate,
  shouldPauseHeavyCatalogOnAnchorLeave,
  softNavHardFallbackMs,
} from "./app-navigate";

const CODE_PATH =
  "/npub1alptdev5srcw2hxg03567p4k6xs3lgj7f6545suc0rzp0xw98svse7rg94/cargo-limit";

describe("appNavigate Code path detection", () => {
  it("treats npub/repo as Code", () => {
    expect(isRepoCodePath(CODE_PATH)).toBe(true);
  });

  it("does not treat settings or explore as Code", () => {
    expect(isRepoCodePath("/settings/profile")).toBe(false);
    expect(isRepoCodePath("/explore")).toBe(false);
    expect(isRepoCodePath("/repositories")).toBe(false);
  });

  it("does not treat repo subtabs as Code", () => {
    expect(isRepoCodePath(`${CODE_PATH}/issues`)).toBe(false);
  });

  it("never forces hard navigate for browse (Amber warm stays click-only)", () => {
    expect(
      shouldHardNavigate("/npub1a/cargo-limit/issues", "/npub1a/cargo-limit")
    ).toBe(false);
    expect(shouldHardNavigate("/explore", "/")).toBe(false);
  });
});

describe("isHeavyDirectoryPath", () => {
  it("treats /apps and /pages as heavy hubs", () => {
    expect(isHeavyDirectoryPath("/apps")).toBe(true);
    expect(isHeavyDirectoryPath("/pages")).toBe(true);
    expect(isHeavyDirectoryPath("/explore")).toBe(false);
    expect(isHeavyDirectoryPath(CODE_PATH)).toBe(false);
  });
});

describe("isLiveCatalogPath", () => {
  it("treats home, Explore, Issues, Pulls, and Repositories as live catalogs", () => {
    expect(isLiveCatalogPath("/")).toBe(true);
    expect(isLiveCatalogPath("/explore")).toBe(true);
    expect(isLiveCatalogPath("/explore?q=gittr")).toBe(true);
    expect(isLiveCatalogPath("/issues")).toBe(true);
    expect(isLiveCatalogPath("/pulls")).toBe(true);
    expect(isLiveCatalogPath("/repositories")).toBe(true);
    expect(isLiveCatalogPath("/settings")).toBe(false);
    expect(isLiveCatalogPath(CODE_PATH)).toBe(false);
  });
});

describe("isUrgentLeavePath", () => {
  it("includes live catalogs so chrome clicks are not starved", () => {
    expect(isUrgentLeavePath("/explore")).toBe(true);
    expect(isUrgentLeavePath("/")).toBe(true);
    expect(isUrgentLeavePath("/issues")).toBe(true);
    expect(isUrgentLeavePath("/apps")).toBe(true);
    expect(isUrgentLeavePath(CODE_PATH)).toBe(true);
    expect(isUrgentLeavePath("/settings")).toBe(false);
  });
});

describe("isProfileEntityPath", () => {
  it("treats npub and hex profile URLs as heavy", () => {
    expect(
      isProfileEntityPath(
        "/npub1q3sle0kvfsehgsuexttt3ugjd8xdklxfwwkh559wxckmzddywnws6cd26p"
      )
    ).toBe(true);
    expect(isProfileEntityPath("/" + "a".repeat(64))).toBe(true);
    expect(isProfileEntityPath("/settings")).toBe(false);
    expect(isProfileEntityPath(CODE_PATH)).toBe(false);
  });
});

describe("shouldApplySoftNavHardFallback", () => {
  it("hard-assigns home when the Code tab never left (stalled logo click)", () => {
    expect(shouldApplySoftNavHardFallback("/", CODE_PATH, CODE_PATH)).toBe(
      true
    );
    expect(shouldApplySoftNavHardFallback("/", CODE_PATH)).toBe(true);
  });

  it("does not yank home after the user already left for a different repo", () => {
    expect(
      shouldApplySoftNavHardFallback("/", "/npub1other/elsewhere", CODE_PATH)
    ).toBe(false);
  });

  it("does not hard-assign when the URL already matches", () => {
    expect(shouldApplySoftNavHardFallback("/explore", "/explore")).toBe(false);
    expect(shouldApplySoftNavHardFallback("/", "/", CODE_PATH)).toBe(false);
  });

  it("still hard-assigns when soft nav to a different app route stalls", () => {
    expect(shouldApplySoftNavHardFallback("/explore", "/")).toBe(true);
    expect(
      shouldApplySoftNavHardFallback("/explore", CODE_PATH, CODE_PATH)
    ).toBe(true);
  });
});

describe("softNavHardFallbackMs", () => {
  it("recovers home from Code in about a second, not eight", () => {
    expect(softNavHardFallbackMs("/", CODE_PATH)).toBe(
      SOFT_NAV_HARD_FALLBACK_FROM_CODE_HOME_MS
    );
  });

  it("recovers home from Apps and Pages the same way", () => {
    expect(softNavHardFallbackMs("/", "/apps")).toBe(
      SOFT_NAV_HARD_FALLBACK_FROM_CODE_HOME_MS
    );
    expect(softNavHardFallbackMs("/", "/pages")).toBe(
      SOFT_NAV_HARD_FALLBACK_FROM_CODE_HOME_MS
    );
  });

  it("recovers home from a profile URL the same way", () => {
    expect(
      softNavHardFallbackMs(
        "/",
        "/npub1q3sle0kvfsehgsuexttt3ugjd8xdklxfwwkh559wxckmzddywnws6cd26p"
      )
    ).toBe(SOFT_NAV_HARD_FALLBACK_FROM_CODE_HOME_MS);
  });

  it("recovers home from Explore / Issues the same way", () => {
    expect(softNavHardFallbackMs("/", "/explore")).toBe(
      SOFT_NAV_HARD_FALLBACK_FROM_CODE_HOME_MS
    );
    expect(softNavHardFallbackMs("/", "/issues")).toBe(
      SOFT_NAV_HARD_FALLBACK_FROM_CODE_HOME_MS
    );
  });

  it("recovers owner-profile and other leaves from Apps/Pages in about a second", () => {
    expect(softNavHardFallbackMs("/npub1abc", "/apps")).toBe(
      SOFT_NAV_HARD_FALLBACK_FROM_CODE_HOME_MS
    );
    expect(softNavHardFallbackMs("/explore", "/apps")).toBe(
      SOFT_NAV_HARD_FALLBACK_FROM_CODE_HOME_MS
    );
    expect(softNavHardFallbackMs("/settings", "/pages")).toBe(
      SOFT_NAV_HARD_FALLBACK_FROM_CODE_HOME_MS
    );
  });

  it("keeps the long stall window when staying on /apps", () => {
    expect(softNavHardFallbackMs("/apps", "/apps")).toBe(
      SOFT_NAV_HARD_FALLBACK_MS
    );
    expect(softNavHardFallbackMs("/apps?q=zap", "/apps")).toBe(
      SOFT_NAV_HARD_FALLBACK_MS
    );
  });

  it("keeps the long stall window for other routes (avoid remount freeze)", () => {
    expect(softNavHardFallbackMs("/explore", CODE_PATH)).toBe(
      SOFT_NAV_HARD_FALLBACK_MS
    );
    expect(softNavHardFallbackMs("/", "/")).toBe(SOFT_NAV_HARD_FALLBACK_MS);
  });
});

describe("shouldPauseHeavyCatalogOnAnchorLeave", () => {
  it("pauses when an in-app link leaves /apps", () => {
    expect(
      shouldPauseHeavyCatalogOnAnchorLeave({
        href: "/npub1abc",
        currentPathname: "/apps",
      })
    ).toBe(true);
    expect(
      shouldPauseHeavyCatalogOnAnchorLeave({
        href: "/explore",
        currentPathname: "/apps",
      })
    ).toBe(true);
  });

  it("does not pause same-hub, new-tab, or download clicks", () => {
    expect(
      shouldPauseHeavyCatalogOnAnchorLeave({
        href: "/apps?q=zapstore",
        currentPathname: "/apps",
      })
    ).toBe(false);
    expect(
      shouldPauseHeavyCatalogOnAnchorLeave({
        href: "https://github.com/foo/bar",
        currentPathname: "/apps",
        target: "_blank",
      })
    ).toBe(false);
    expect(
      shouldPauseHeavyCatalogOnAnchorLeave({
        href: "/npub1abc",
        currentPathname: "/apps",
        download: true,
      })
    ).toBe(false);
  });

  it("does not pause on light pages", () => {
    expect(
      shouldPauseHeavyCatalogOnAnchorLeave({
        href: "/explore",
        currentPathname: "/settings",
      })
    ).toBe(false);
  });
});

describe("hrefLeavesCurrentPath", () => {
  it("treats a profile URL as leaving /apps", () => {
    expect(hrefLeavesCurrentPath("/npub1abc", "/apps")).toBe(true);
    expect(hrefLeavesCurrentPath("/apps?q=one", "/apps")).toBe(false);
  });
});
