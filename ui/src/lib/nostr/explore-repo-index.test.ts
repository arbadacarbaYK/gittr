import { describe, expect, it } from "vitest";

import { exploreRepoMatchKey } from "./explore-repo-index";

describe("exploreRepoMatchKey", () => {
  it("treats hyphen and underscore names as the same repository", () => {
    const owner = "ab".repeat(32);
    expect(exploreRepoMatchKey(owner, "gittr-p2p")).toBe(
      exploreRepoMatchKey(owner.toUpperCase(), "gittr_p2p")
    );
  });

  it("keeps different owners apart", () => {
    expect(exploreRepoMatchKey("aa".repeat(32), "gittr")).not.toBe(
      exploreRepoMatchKey("bb".repeat(32), "gittr")
    );
  });

  it("returns an empty key when the name is missing", () => {
    expect(exploreRepoMatchKey("aa".repeat(32), "  ")).toBe("");
  });
});
