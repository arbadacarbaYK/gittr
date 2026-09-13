import { describe, expect, it } from "vitest";

import { navItemShortTitle } from "./main-nav-labels";

describe("navItemShortTitle", () => {
  it("uses the short label when present", () => {
    expect(
      navItemShortTitle({ title: "Pull Requests", shortTitle: "PRs" })
    ).toBe("PRs");
  });

  it("falls back to the full title", () => {
    expect(navItemShortTitle({ title: "Issues" })).toBe("Issues");
  });
});
