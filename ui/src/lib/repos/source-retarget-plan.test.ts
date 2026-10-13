import { describe, expect, it } from "vitest";

import { parseLsRemoteHeads } from "../git/remote-has-git-refs";

import { branchTipsHeld, forgeAlreadyHasOurTips } from "./source-retarget-plan";

const main = "a".repeat(40);
const other = "b".repeat(40);

describe("forgeAlreadyHasOurTips", () => {
  it("refuses an empty server so it cannot replace the only copy", () => {
    const result = forgeAlreadyHasOurTips(
      [{ ref: "refs/heads/main", commit: main }],
      []
    );
    expect(result.ok).toBe(false);
  });

  it("allows a forge whose branch tips match", () => {
    const result = forgeAlreadyHasOurTips(
      [{ ref: "refs/heads/main", commit: main }],
      [
        { ref: "refs/heads/main", commit: main.toUpperCase() },
        { ref: "refs/heads/extra", commit: other },
      ]
    );
    expect(result.ok).toBe(true);
  });

  it("refuses when the same branch name has a different commit", () => {
    const result = forgeAlreadyHasOurTips(
      [{ ref: "refs/heads/main", commit: main }],
      [{ ref: "refs/heads/main", commit: other }]
    );
    expect(result.ok).toBe(false);
  });

  it("refuses when gittr has a branch the other server does not", () => {
    const result = forgeAlreadyHasOurTips(
      [
        { ref: "refs/heads/main", commit: main },
        { ref: "refs/heads/dev", commit: other },
      ],
      [{ ref: "refs/heads/main", commit: main }]
    );
    expect(result.ok).toBe(false);
  });
});

describe("branchTipsHeld", () => {
  it("is false when a tip moves", () => {
    expect(
      branchTipsHeld(
        [{ ref: "refs/heads/main", commit: main }],
        [{ ref: "refs/heads/main", commit: other }]
      )
    ).toBe(false);
  });

  it("stays true when an extra branch appears", () => {
    expect(
      branchTipsHeld(
        [{ ref: "refs/heads/main", commit: main }],
        [
          { ref: "refs/heads/main", commit: main },
          { ref: "refs/heads/extra", commit: other },
        ]
      )
    ).toBe(true);
  });
});

describe("parseLsRemoteHeads", () => {
  it("reads branch lines and ignores anything else", () => {
    expect(
      parseLsRemoteHeads(`${main}\trefs/heads/main\n${other}\trefs/tags/v1\n`)
    ).toEqual([{ commit: main, ref: "refs/heads/main" }]);
  });
});
