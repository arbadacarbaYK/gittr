import { describe, expect, it } from "vitest";

import { headCommitIdFromRepoStateTags } from "./repo-state-head";

describe("headCommitIdFromRepoStateTags", () => {
  it("reads the SHA for the HEAD symbolic ref", () => {
    expect(
      headCommitIdFromRepoStateTags([
        ["d", "cipherchat"],
        ["HEAD", "ref: refs/heads/main"],
        ["refs/heads/main", "01b3e287781c007d8eefa1f3d21d3a762eb45bdd"],
        ["refs/heads/dev", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
      ])
    ).toBe("01b3e287781c007d8eefa1f3d21d3a762eb45bdd");
  });

  it("falls back to the first refs/heads SHA", () => {
    expect(
      headCommitIdFromRepoStateTags([
        ["refs/heads/master", "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"],
      ])
    ).toBe("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
  });
});
