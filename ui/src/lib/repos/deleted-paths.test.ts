import { describe, expect, it } from "vitest";

import {
  appendRepoDeletedPath,
  isRepoPathDeleted,
  reconcileDeletedPathsAfterAdd,
} from "./deleted-paths";

describe("isRepoPathDeleted", () => {
  it("matches exact file paths", () => {
    expect(isRepoPathDeleted("src/a.ts", ["src/a.ts"])).toBe(true);
    expect(isRepoPathDeleted("src/b.ts", ["src/a.ts"])).toBe(false);
  });

  it("hides everything under a deleted folder", () => {
    expect(isRepoPathDeleted("src", ["src"])).toBe(true);
    expect(isRepoPathDeleted("src/a.ts", ["src"])).toBe(true);
    expect(isRepoPathDeleted("src/nested/b.ts", ["src"])).toBe(true);
    expect(isRepoPathDeleted("src2/a.ts", ["src"])).toBe(false);
  });
});

describe("appendRepoDeletedPath", () => {
  it("adds a folder and prunes redundant descendants", () => {
    expect(
      appendRepoDeletedPath(["src/a.ts", "src/b.ts", "readme.md"], "src")
    ).toEqual(["readme.md", "src"]);
  });

  it("is a no-op when an ancestor already covers the path", () => {
    expect(appendRepoDeletedPath(["src"], "src/a.ts")).toEqual(["src"]);
  });
});

describe("reconcileDeletedPathsAfterAdd", () => {
  it("clears an exact file tombstone on re-add", () => {
    expect(
      reconcileDeletedPathsAfterAdd(["src/a.ts", "other.ts"], ["src/a.ts"])
    ).toEqual(["other.ts"]);
  });

  it("clears a folder tombstone and keeps other known siblings deleted", () => {
    expect(
      reconcileDeletedPathsAfterAdd(
        ["src"],
        ["src/keep.ts"],
        ["src/keep.ts", "src/gone.ts", "src/nested/x.ts"]
      ).sort()
    ).toEqual(["src/gone.ts", "src/nested/x.ts"].sort());
  });
});
