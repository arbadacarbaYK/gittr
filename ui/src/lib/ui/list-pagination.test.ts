import { describe, expect, it } from "vitest";

import { REPO_LIST_PAGE_SIZE, clampVisibleCount } from "./list-pagination";

describe("clampVisibleCount", () => {
  it("defaults to page size when empty or unset", () => {
    expect(clampVisibleCount(0, 0)).toBe(REPO_LIST_PAGE_SIZE);
    expect(clampVisibleCount(0, 100)).toBe(REPO_LIST_PAGE_SIZE);
  });

  it("does not exceed total", () => {
    expect(clampVisibleCount(96, 30)).toBe(30);
    expect(clampVisibleCount(48, 10)).toBe(10);
  });

  it("keeps an expanded window when still within total", () => {
    expect(clampVisibleCount(96, 100)).toBe(96);
  });
});
