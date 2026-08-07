import { describe, expect, it } from "vitest";

import {
  nestedFilePathCount,
  shouldApplyFetchedFileTree,
} from "./repo-file-tree-branch";

describe("nestedFilePathCount", () => {
  it("counts nested files and ignores root dirs", () => {
    expect(
      nestedFilePathCount([
        { type: "dir", path: "scripts" },
        { type: "file", path: "README.md" },
        { type: "file", path: "scripts/a.sh" },
        { type: "file", path: "scripts/b.sh" },
      ])
    ).toBe(2);
  });
});

describe("shouldApplyFetchedFileTree", () => {
  it("allows first load", () => {
    expect(shouldApplyFetchedFileTree("main", 0, "main", 6)).toBe(true);
  });

  it("blocks smaller remote trees", () => {
    expect(
      shouldApplyFetchedFileTree("main", 10, "main", 4, { allowShrink: false })
    ).toBe(false);
  });

  it("blocks equal-count flat remote when local still has nested paths", () => {
    expect(
      shouldApplyFetchedFileTree("main", 6, "main", 6, {
        allowShrink: false,
        existingNestedCount: 2,
        incomingNestedCount: 0,
      })
    ).toBe(false);
  });

  it("allows nested remote to replace flat local", () => {
    expect(
      shouldApplyFetchedFileTree("main", 6, "main", 6, {
        allowShrink: false,
        existingNestedCount: 0,
        incomingNestedCount: 2,
      })
    ).toBe(true);
  });

  it("allows smaller remote when allowShrink is true (forge refetch)", () => {
    expect(
      shouldApplyFetchedFileTree("main", 64, "main", 62, { allowShrink: true })
    ).toBe(true);
  });
});
