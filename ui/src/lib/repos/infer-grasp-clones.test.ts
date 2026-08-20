import { describe, expect, it } from "vitest";

import {
  announcementCloneStatusFromEvent,
  shouldInferGraspCloneUrls,
} from "./infer-grasp-clones";

describe("shouldInferGraspCloneUrls", () => {
  it("never infers when any clone URL was already collected", () => {
    expect(
      shouldInferGraspCloneUrls({
        collectedCloneCount: 1,
        announcementStatus: "unknown",
        allowLastResort: true,
      })
    ).toBe(false);
  });

  it("infers only after a 30617 with empty clone tags", () => {
    expect(
      shouldInferGraspCloneUrls({
        collectedCloneCount: 0,
        announcementStatus: "empty",
      })
    ).toBe(true);
  });

  it("does not invent GRASP while the announcement is still in flight", () => {
    expect(
      shouldInferGraspCloneUrls({
        collectedCloneCount: 0,
        announcementStatus: "unknown",
      })
    ).toBe(false);
  });

  it("allows a last-resort guess only when still unknown", () => {
    expect(
      shouldInferGraspCloneUrls({
        collectedCloneCount: 0,
        announcementStatus: "unknown",
        allowLastResort: true,
      })
    ).toBe(true);
  });
});

describe("announcementCloneStatusFromEvent", () => {
  it("marks present when clone tags exist", () => {
    expect(
      announcementCloneStatusFromEvent([
        "https://friendly-machines.com/git/LiE.git",
      ]).status
    ).toBe("present");
  });

  it("marks empty when the announcement has no clones", () => {
    expect(announcementCloneStatusFromEvent([]).status).toBe("empty");
  });
});
