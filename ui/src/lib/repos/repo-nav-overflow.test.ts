import { describe, expect, it } from "vitest";

import { countVisibleRepoNavItems } from "./repo-nav-overflow";

describe("countVisibleRepoNavItems", () => {
  it("shows every tab when they fit without an overflow button", () => {
    expect(
      countVisibleRepoNavItems({
        availableWidth: 1400,
        itemWidths: [80, 90, 140, 100, 100, 120, 130, 70, 120, 90, 90],
        overflowButtonWidth: 40,
        gap: 16,
      })
    ).toBe(11);
  });

  it("does not park trailing tabs in the menu when there is spare room", () => {
    expect(
      countVisibleRepoNavItems({
        availableWidth: 1100,
        itemWidths: [80, 80, 80, 80, 80, 80, 80, 80, 80, 80, 80],
        overflowButtonWidth: 40,
        gap: 16,
      })
    ).toBe(11);
  });

  it("keeps an overflow button only when labels would wrap", () => {
    expect(
      countVisibleRepoNavItems({
        availableWidth: 400,
        itemWidths: [90, 90, 90, 90, 90, 90],
        overflowButtonWidth: 40,
        gap: 16,
      })
    ).toBe(3);
  });

  it("always keeps at least the first tab on a narrow bar", () => {
    expect(
      countVisibleRepoNavItems({
        availableWidth: 50,
        itemWidths: [80, 80, 80],
        overflowButtonWidth: 40,
        gap: 16,
      })
    ).toBe(1);
  });

  it("returns 0 for an empty tab list", () => {
    expect(
      countVisibleRepoNavItems({
        availableWidth: 800,
        itemWidths: [],
        overflowButtonWidth: 40,
        gap: 16,
      })
    ).toBe(0);
  });
});
