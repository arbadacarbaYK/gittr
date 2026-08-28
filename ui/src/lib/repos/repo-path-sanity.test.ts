import { describe, expect, it } from "vitest";

import {
  isAbsurdRepoPath,
  looksLikeRepoFileName,
  recordHasAbsurdRepoNav,
  sanitizeRepoNavPath,
  searchParamsHaveAbsurdRepoPath,
} from "./repo-path-sanity";

describe("repo-path-sanity", () => {
  it("allows normal nested package paths", () => {
    expect(
      isAbsurdRepoPath("docs/packaging/files/tollgate-captive-portal-site")
    ).toBe(false);
    expect(sanitizeRepoNavPath("src/cli/main.go")).toBe("src/cli/main.go");
  });

  it("rejects crawler nests with many src hops", () => {
    const nested =
      "docs/packaging/files/tollgate-captive-portal-site/src/merchant/src/wireless_gateway_manager/src/upstream_detector/src/.github/workflows";
    expect(isAbsurdRepoPath(nested)).toBe(true);
    expect(sanitizeRepoNavPath(nested)).toBeNull();
  });

  it("rejects consecutive duplicate segments (LICENSE/LICENSE)", () => {
    expect(
      isAbsurdRepoPath("src/config_manager/docs/LICENSE/LICENSE/src/lightning")
    ).toBe(true);
  });

  it("rejects over-deep and over-long paths", () => {
    const deep = Array.from({ length: 20 }, (_, i) => `seg${i}`).join("/");
    expect(isAbsurdRepoPath(deep)).toBe(true);
    expect(isAbsurdRepoPath("a".repeat(300))).toBe(true);
  });

  it("treats LICENSE / Makefile as file names", () => {
    expect(looksLikeRepoFileName("LICENSE")).toBe(true);
    expect(looksLikeRepoFileName("Makefile")).toBe(true);
    expect(looksLikeRepoFileName("src")).toBe(false);
    expect(looksLikeRepoFileName("readme.md")).toBe(true);
  });

  it("rejects crawler nips/nips/nips nests that src/docs special-case missed", () => {
    expect(
      isAbsurdRepoPath("nips/nip52/nips/nip02/nips/nip5f/nips/nip65/nips/nip58")
    ).toBe(true);
    expect(isAbsurdRepoPath("nips/nip52")).toBe(false);
    expect(
      isAbsurdRepoPath(
        "contributions/recovery-safety/contributions/mcu-io-firmware/contributions/control-app/docs/LICENSE"
      )
    ).toBe(true);
  });

  it("reads absurd path/file from query helpers", () => {
    expect(
      searchParamsHaveAbsurdRepoPath(
        new URLSearchParams("path=nips/a/nips/b/nips/c")
      )
    ).toBe(true);
    expect(
      searchParamsHaveAbsurdRepoPath(new URLSearchParams("path=nips"))
    ).toBe(false);
    expect(recordHasAbsurdRepoNav({ file: "src/a/src/b/src/c/main.go" })).toBe(
      true
    );
  });
});
