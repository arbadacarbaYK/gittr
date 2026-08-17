import { describe, expect, it } from "vitest";

import {
  filterByAggregateSource,
  groupAggregateItemsByRepo,
  repoIsFork,
  repoKeyForAggregateItem,
} from "./global-issues-pr-list";

describe("repoIsFork", () => {
  it("detects a real parent URL as a fork", () => {
    expect(
      repoIsFork({
        forkedFrom: "https://github.com/a/b",
        sourceUrl: "https://github.com/me/b",
      })
    ).toBe(true);
    expect(repoIsFork({ forkedFrom: "" })).toBe(false);
    expect(repoIsFork({})).toBe(false);
  });

  it("does not treat a self-import GitHub URL as a fork", () => {
    expect(
      repoIsFork({
        forkedFrom: "https://github.com/me/gittr",
        sourceUrl: "https://github.com/me/gittr",
      })
    ).toBe(false);
  });

  it("treats a gittr /npub/repo pointer as a fork", () => {
    expect(
      repoIsFork({
        forkedFrom:
          "/npub1n2ph08n4pqz4d3jk6n2p35p2f4ldhc5g5tu7dhftfpueajf4rpxqfjhzmc/gittr",
      })
    ).toBe(true);
  });
});

describe("filterByAggregateSource", () => {
  const items = [
    { id: "1", isFork: false },
    { id: "2", isFork: true },
    { id: "3" },
  ];

  it("hides forks for originals", () => {
    expect(
      filterByAggregateSource(items, "originals").map((i) => i.id)
    ).toEqual(["1", "3"]);
  });

  it("keeps only forks", () => {
    expect(filterByAggregateSource(items, "forks").map((i) => i.id)).toEqual([
      "2",
    ]);
  });
});

describe("groupAggregateItemsByRepo", () => {
  it("groups and sorts by entity/repo", () => {
    const groups = groupAggregateItemsByRepo([
      { entity: "npub1b", repo: "z", id: "1" },
      { entity: "npub1a", repo: "a", id: "2" },
      { entity: "npub1a", repo: "a", id: "3" },
    ]);
    expect(groups.map((g) => g.key)).toEqual(["npub1a/a", "npub1b/z"]);
    expect(groups[0]?.items).toHaveLength(2);
  });
});

describe("repoKeyForAggregateItem", () => {
  it("lowercases entity/repo", () => {
    expect(repoKeyForAggregateItem({ entity: "Npub", repo: "Wok" })).toBe(
      "npub/wok"
    );
  });
});
