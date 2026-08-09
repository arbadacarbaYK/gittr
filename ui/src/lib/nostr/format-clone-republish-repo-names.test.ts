import { describe, expect, it } from "vitest";

import { formatCloneRepublishRepoNames } from "./format-clone-republish-repo-names";

describe("formatCloneRepublishRepoNames", () => {
  it("lists repo names", () => {
    expect(
      formatCloneRepublishRepoNames([
        { repositoryName: "lnbits-tabletown" },
        { repo: "doesitageverify.git" },
      ])
    ).toBe("lnbits-tabletown, doesitageverify");
  });

  it("truncates long lists", () => {
    const repos = Array.from({ length: 10 }, (_, i) => ({
      repositoryName: `repo-${i + 1}`,
    }));
    expect(formatCloneRepublishRepoNames(repos, 3)).toBe(
      "repo-1, repo-2, repo-3 (+7 more)"
    );
  });
});
