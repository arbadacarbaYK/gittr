import { describe, expect, it } from "vitest";

import {
  branchesToTryForCommits,
  branchesToTryForContent,
  commitBelongsToBranch,
  fetchedTreeBranchesCompatible,
  joinRepoHref,
  nestedFilePathCount,
  preferLiveBranchSearchParams,
  preserveAddressBarBranch,
  resolveSharedRepoBranch,
  resolveTabBranch,
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

describe("preserveAddressBarBranch", () => {
  it("keeps a named branch when the refreshed list is only the default", () => {
    expect(
      preserveAddressBarBranch("fix/readme-relative-images", {
        defaultBranch: "main",
        branches: ["main"],
      })
    ).toBe("fix/readme-relative-images");
  });

  it("maps main to master when the list only has master", () => {
    expect(
      preserveAddressBarBranch("main", {
        defaultBranch: "master",
        branches: ["master"],
      })
    ).toBe("master");
  });
});

describe("resolveTabBranch", () => {
  const params = (branch: string | null) => ({
    get: (name: string) => (name === "branch" ? branch : null),
  });

  it("follows the address bar when Next is still on master", () => {
    expect(
      resolveTabBranch(
        params("master"),
        { defaultBranch: "master", branches: ["master"] },
        { entity: "npub1", repo: "demo" },
        "?branch=dev"
      )
    ).toBe("dev");
  });

  it("still maps main onto master when that is the only stored tip", () => {
    expect(
      resolveTabBranch(
        params("main"),
        { defaultBranch: "master", branches: ["master"] },
        null,
        "?branch=main"
      )
    ).toBe("master");
  });
});

describe("preferLiveBranchSearchParams", () => {
  const next = {
    get: (name: string) => (name === "branch" ? "master" : null),
  };

  it("keeps Next params until the address bar is readable", () => {
    expect(preferLiveBranchSearchParams(next, null).get("branch")).toBe(
      "master"
    );
  });

  it("uses the address-bar branch when Next is still on master", () => {
    expect(
      preferLiveBranchSearchParams(next, "?branch=dev&file=README.md").get(
        "branch"
      )
    ).toBe("dev");
    expect(
      preferLiveBranchSearchParams(next, "?branch=dev&file=README.md").get(
        "file"
      )
    ).toBe("README.md");
  });

  it("keeps Next when the address bar has no branch", () => {
    expect(
      preferLiveBranchSearchParams(next, "?file=README.md").get("branch")
    ).toBe("master");
  });
});

describe("joinRepoHref", () => {
  it("keeps an existing branch when adding a file", () => {
    expect(joinRepoHref("/npub1a/repo?branch=dev", { file: "README.md" })).toBe(
      "/npub1a/repo?branch=dev&file=README.md"
    );
  });
});

describe("branchesToTryForCommits", () => {
  it("does not fall through to master for a named branch", () => {
    expect(branchesToTryForCommits("dev", { defaultBranch: "master" })).toEqual(
      ["dev"]
    );
  });

  it("still tries the main/master alias", () => {
    expect(
      branchesToTryForCommits("main", { defaultBranch: "master" })
    ).toEqual(["main", "master"]);
  });
});

describe("commitBelongsToBranch", () => {
  it("rejects master commits when the viewer asked for a feature branch", () => {
    expect(commitBelongsToBranch("master", "dev")).toBe(false);
    expect(commitBelongsToBranch("dev", "dev")).toBe(true);
  });

  it("treats main and master as the same default tip", () => {
    expect(commitBelongsToBranch("master", "main")).toBe(true);
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
