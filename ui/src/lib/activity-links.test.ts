import { describe, expect, it } from "vitest";

import { getActivityDeepPath } from "./activity-links";

describe("getActivityDeepPath", () => {
  it("opens a PR by event id", () => {
    expect(
      getActivityDeepPath({
        type: "pr_created",
        id: "c14d7668846d1ae68b3e2d91275c96dbfd4bbd3c8e2572f051eb286f994ff940",
        metadata: {
          prId: "c14d7668846d1ae68b3e2d91275c96dbfd4bbd3c8e2572f051eb286f994ff940",
        },
      })
    ).toBe(
      "/pulls/c14d7668846d1ae68b3e2d91275c96dbfd4bbd3c8e2572f051eb286f994ff940"
    );
  });

  it("opens a git SHA commit page, not a Nostr event id", () => {
    expect(
      getActivityDeepPath({
        type: "commit_created",
        metadata: { commitId: "01b3e287781c007d8eefa1f3d21d3a762eb45bdd" },
      })
    ).toBe("/commits/01b3e287781c007d8eefa1f3d21d3a762eb45bdd");
    expect(
      getActivityDeepPath({
        type: "commit_created",
        metadata: {
          commitId:
            "a236c63d0f6b7eb189a3a2d8d169ba9931941225bf6576efbc340e56e48af7ef",
        },
      })
    ).toBe("/commits");
  });
});
