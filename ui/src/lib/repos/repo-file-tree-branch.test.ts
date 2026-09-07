import { describe, expect, it } from "vitest";

import {
  branchesToTryForContent,
  fetchedTreeBranchesCompatible,
  nestedFilePathCount,
  resolveSharedRepoBranch,
  shouldApplyFetchedFileTree,
  shouldWipeCachedFileTreeOnBranchChange,
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

describe("resolveSharedRepoBranch", () => {
  const params = (branch: string | null) => ({
    get: (name: string) => (name === "branch" ? branch : null),
  });

  it("keeps URL tip when it exists on the mirror", () => {
    expect(
      resolveSharedRepoBranch(params("develop"), {
        defaultBranch: "main",
        branches: ["main", "develop"],
      })
    ).toBe("develop");
  });

  it("maps ?branch=main to master when only master exists", () => {
    expect(
      resolveSharedRepoBranch(params("main"), {
        defaultBranch: "master",
        branches: ["master", "release/0.3.0"],
      })
    ).toBe("master");
  });

  it("keeps URL tip when branch list is still unknown", () => {
    expect(
      resolveSharedRepoBranch(params("main"), {
        defaultBranch: "master",
        branches: [],
      })
    ).toBe("main");
  });
});

describe("branchesToTryForContent", () => {
  it("leads with successfulSources resolvedBranch before main", () => {
    expect(
      branchesToTryForContent(
        {
          defaultBranch: "main",
          successfulSources: [{ resolvedBranch: "master" }],
        },
        "main",
        null
      )[0]
    ).toBe("master");
  });
});

describe("fetchedTreeBranchesCompatible", () => {
  it("accepts any git HEAD name when the viewer did not pick a branch", () => {
    expect(fetchedTreeBranchesCompatible("master", "main")).toBe(true);
    expect(fetchedTreeBranchesCompatible("develop", "main")).toBe(true);
    expect(fetchedTreeBranchesCompatible("gittr", "main")).toBe(true);
  });

  it("requires an exact match when the viewer picked a branch", () => {
    expect(
      fetchedTreeBranchesCompatible("dev", "main", { userPickedBranch: true })
    ).toBe(false);
    expect(
      fetchedTreeBranchesCompatible("main", "dev", { userPickedBranch: true })
    ).toBe(false);
    expect(
      fetchedTreeBranchesCompatible("dev", "dev", { userPickedBranch: true })
    ).toBe(true);
  });
});

describe("shouldWipeCachedFileTreeOnBranchChange", () => {
  it("does not wipe on remount when the viewer is still on the default tip", () => {
    expect(
      shouldWipeCachedFileTreeOnBranchChange({
        cachedFilesBranch: "develop",
        currentBranch: "main",
        userPickedBranch: false,
        hasFiles: true,
      })
    ).toBe(false);
  });

  it("wipes when the viewer picked a different named branch", () => {
    expect(
      shouldWipeCachedFileTreeOnBranchChange({
        cachedFilesBranch: "main",
        currentBranch: "dev",
        userPickedBranch: true,
        hasFiles: true,
      })
    ).toBe(true);
  });
});

describe("shouldApplyFetchedFileTree", () => {
  it("allows first load", () => {
    expect(shouldApplyFetchedFileTree("main", 0, "main", 6)).toBe(true);
  });

  it("allows first load when git resolved master and the UI is still on main", () => {
    expect(shouldApplyFetchedFileTree("master", 0, "main", 51)).toBe(true);
  });

  it("allows replacing an existing main tree with a master listing of the same size", () => {
    expect(shouldApplyFetchedFileTree("master", 51, "main", 51)).toBe(true);
  });

  it("applies git HEAD of any name onto an existing default-tip tree", () => {
    expect(shouldApplyFetchedFileTree("develop", 51, "main", 51)).toBe(true);
  });

  it("still blocks a feature-branch listing when the viewer picked another branch", () => {
    expect(
      shouldApplyFetchedFileTree("dev", 2, "main", 1, {
        userPickedBranch: true,
      })
    ).toBe(false);
  });

  it("applies a listing when the cached tree is present but not displayable", () => {
    expect(
      shouldApplyFetchedFileTree("develop", 80, "main", 41, {
        visibleExistingCount: 0,
      })
    ).toBe(true);
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
