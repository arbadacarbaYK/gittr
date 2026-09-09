import { describe, expect, it } from "vitest";

import {
  compareExploreReposWithHomepagePins,
  homepageRecentPinRank,
} from "./explore-homepage-pins";

const pins = [
  {
    entity: "npub1xtz",
    repo: "ngit-ci-dashboard",
    ownerPubkey: "aa".repeat(32),
  },
  {
    entity: "npub1iris",
    repo: "iris-drive",
    ownerPubkey: "bb".repeat(32),
  },
  { entity: "npub1gittr", repo: "gittr", ownerPubkey: "cc".repeat(32) },
];

describe("homepageRecentPinRank", () => {
  it("matches Home order by pubkey even when Explore stored a display name", () => {
    expect(
      homepageRecentPinRank(
        {
          entity: "Sirius Business Ltd",
          repo: "iris-drive",
          ownerPubkey: "bb".repeat(32),
        },
        pins
      )
    ).toBe(1);
    expect(
      homepageRecentPinRank(
        { entity: "npub1xtz", repo: "ngit-ci-dashboard" },
        pins
      )
    ).toBe(0);
  });

  it("does not pin junk that is only in the Explore cache", () => {
    expect(
      homepageRecentPinRank({ entity: "ben", repo: "adventofcode-2025" }, pins)
    ).toBe(-1);
  });
});

describe("compareExploreReposWithHomepagePins", () => {
  it("puts the homepage list first even when junk has a newer stamp", () => {
    const junk = {
      entity: "ben",
      repo: "adventofcode-2025",
      lastActivity: 9_999,
    };
    const iris = {
      entity: "npub1iris",
      repo: "iris-drive",
      ownerPubkey: "bb".repeat(32),
      lastActivity: 1,
    };
    const dash = {
      entity: "npub1xtz",
      repo: "ngit-ci-dashboard",
      lastActivity: 2,
    };
    const list = [junk, iris, dash].sort((a, b) =>
      compareExploreReposWithHomepagePins(
        a,
        b,
        pins,
        (x, y) => y.lastActivity - x.lastActivity
      )
    );
    expect(list.map((r) => r.repo)).toEqual([
      "ngit-ci-dashboard",
      "iris-drive",
      "adventofcode-2025",
    ]);
  });
});
