import { describe, expect, it } from "vitest";

import {
  applyHomepagePinsToFront,
  compareExploreReposWithHomepagePins,
  homepageRecentPinRank,
  sanitizeHomepagePins,
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

describe("applyHomepagePinsToFront", () => {
  it("puts Home order first even when the cache ranks junk newer", () => {
    const junk = { entity: "ben", repo: "adventofcode-2025" };
    const coop = { entity: "npub1coop", repo: "coop" };
    const iris = {
      entity: "npub1iris",
      repo: "iris-drive",
      ownerPubkey: "bb".repeat(32),
    };
    const list = applyHomepagePinsToFront([junk, coop, iris], pins);
    expect(list.map((r) => r.repo)).toEqual([
      "ngit-ci-dashboard",
      "iris-drive",
      "gittr",
      "adventofcode-2025",
      "coop",
    ]);
  });

  it("inserts a stub when Home has a repo Explore has not cached yet", () => {
    const list = applyHomepagePinsToFront(
      [{ entity: "ben", repo: "adventofcode-2025" }],
      pins
    );
    expect(list[0]?.repo).toBe("ngit-ci-dashboard");
    expect(list[1]?.repo).toBe("iris-drive");
    expect(list.map((r) => r.repo)).toContain("adventofcode-2025");
  });
});

describe("sanitizeHomepagePins", () => {
  it("keeps at most 12 valid pins", () => {
    const raw = Array.from({ length: 20 }, (_, i) => ({
      entity: `npub${i}`,
      repo: `repo-${i}`,
    }));
    expect(sanitizeHomepagePins(raw)).toHaveLength(12);
    expect(sanitizeHomepagePins([{ repo: "only-name" }])).toEqual([]);
  });
});
