import { describe, expect, it } from "vitest";

import {
  SOFT_NAV_HARD_FALLBACK_FROM_CODE_HOME_MS,
  SOFT_NAV_HARD_FALLBACK_MS,
  isHeavyDirectoryPath,
  isRepoCodePath,
  shouldApplySoftNavHardFallback,
  shouldHardNavigate,
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

  it("keeps the long stall window for other routes (avoid remount freeze)", () => {
    expect(softNavHardFallbackMs("/explore", CODE_PATH)).toBe(
      SOFT_NAV_HARD_FALLBACK_MS
    );
    expect(softNavHardFallbackMs("/", "/")).toBe(SOFT_NAV_HARD_FALLBACK_MS);
  });
});
