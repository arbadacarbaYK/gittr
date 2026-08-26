import { describe, expect, it } from "vitest";

import {
  isRepoCodePath,
  shouldApplySoftNavHardFallback,
  shouldHardNavigate,
} from "./app-navigate";

describe("appNavigate Code path detection", () => {
  it("treats npub/repo as Code", () => {
    expect(
      isRepoCodePath(
        "/npub1alptdev5srcw2hxg03567p4k6xs3lgj7f6545suc0rzp0xw98svse7rg94/cargo-limit"
      )
    ).toBe(true);
  });

  it("does not treat settings or explore as Code", () => {
    expect(isRepoCodePath("/settings/profile")).toBe(false);
    expect(isRepoCodePath("/explore")).toBe(false);
    expect(isRepoCodePath("/repositories")).toBe(false);
  });

  it("does not treat repo subtabs as Code", () => {
    expect(
      isRepoCodePath(
        "/npub1alptdev5srcw2hxg03567p4k6xs3lgj7f6545suc0rzp0xw98svse7rg94/cargo-limit/issues"
      )
    ).toBe(false);
  });

  it("never forces hard navigate for browse (Amber warm stays click-only)", () => {
    expect(
      shouldHardNavigate("/npub1a/cargo-limit/issues", "/npub1a/cargo-limit")
    ).toBe(false);
    expect(shouldHardNavigate("/explore", "/")).toBe(false);
  });
});

describe("shouldApplySoftNavHardFallback", () => {
  it("does not hard-assign home when already on a repo Code tab", () => {
    expect(
      shouldApplySoftNavHardFallback(
        "/",
        "/npub1alptdev5srcw2hxg03567p4k6xs3lgj7f6545suc0rzp0xw98svse7rg94/cargo-limit"
      )
    ).toBe(false);
  });

  it("still hard-assigns when soft nav to a different app route stalls", () => {
    expect(shouldApplySoftNavHardFallback("/explore", "/")).toBe(true);
  });

  it("does not hard-assign when the URL already matches", () => {
    expect(shouldApplySoftNavHardFallback("/explore", "/explore")).toBe(false);
  });
});
