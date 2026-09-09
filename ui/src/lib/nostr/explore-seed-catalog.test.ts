import { describe, expect, it } from "vitest";

import {
  EXPLORE_SEED_SKIP_IF_SEO_ROWS,
  mergeExploreSeedIntoCatalog,
  seoSeedRowCount,
  shouldFetchExploreSeed,
} from "./explore-seed-catalog";

describe("shouldFetchExploreSeed", () => {
  it("still fetches when localStorage is a large locals-only list", () => {
    const locals = Array.from({ length: 2200 }, (_, i) => ({
      entity: "npub1local",
      repo: `bridge-${i}`,
    }));
    expect(seoSeedRowCount(locals)).toBe(0);
    expect(shouldFetchExploreSeed(locals)).toBe(true);
  });

  it("skips only after the SEO snapshot is already in the catalog", () => {
    const seeded = Array.from(
      { length: EXPLORE_SEED_SKIP_IF_SEO_ROWS },
      (_, i) => ({
        entity: "npub1seo",
        repo: `snap-${i}`,
        fromSeoSnapshot: true,
      })
    );
    expect(shouldFetchExploreSeed(seeded)).toBe(false);
  });
});

describe("mergeExploreSeedIntoCatalog", () => {
  it("adds snapshot rows that locals do not have, so search can match them", () => {
    const existing = [
      { entity: "npub1aaa", repo: "gittr", ownerPubkey: "aa".repeat(32) },
    ];
    const { list, added } = mergeExploreSeedIntoCatalog(existing, [
      {
        entity: "npub1aaa",
        repo: "gittr",
        ownerPubkey: "aa".repeat(32),
        lastActivity: 2,
      },
      {
        entity: "npub1bbb",
        repo: "shakespeare-app",
        ownerPubkey: "bb".repeat(32),
        lastActivity: 9,
      },
    ]);
    expect(added).toBe(1);
    expect(list.map((r) => r.repo).sort()).toEqual([
      "gittr",
      "shakespeare-app",
    ]);
    expect(
      list.find((r) => r.repo === "shakespeare-app")?.fromSeoSnapshot
    ).toBe(true);
  });

  it("does not treat zero activity as now, so extras do not sort first", () => {
    const { list } = mergeExploreSeedIntoCatalog(
      [
        {
          entity: "npub1aaa",
          repo: "live-one",
          createdAt: 1_700_000_000_000,
          lastNostrEventCreatedAt: 1_700_000_000,
        },
      ],
      [
        {
          entity: "npub1bbb",
          repo: "pushed-only",
          ownerPubkey: "bb".repeat(32),
          lastActivity: 0,
        },
      ]
    );
    const extra = list.find((r) => r.repo === "pushed-only");
    expect(extra?.createdAt).toBeUndefined();
    expect(extra?.lastNostrEventCreatedAt).toBeUndefined();
  });
});
