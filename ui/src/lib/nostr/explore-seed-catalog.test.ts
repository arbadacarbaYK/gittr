import { describe, expect, it } from "vitest";

import {
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

  it("still fetches a large already-seeded catalog so timestamps and deletions reconcile", () => {
    const seeded = Array.from({ length: 2000 }, (_, i) => ({
      entity: "npub1seo",
      repo: `snap-${i}`,
      fromSeoSnapshot: true,
    }));
    expect(shouldFetchExploreSeed(seeded)).toBe(true);
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

  it("replaces fake newest stamps on existing snapshot rows", () => {
    const poisoned = 1_788_980_000_000;
    const real = 1_700_000_000_000;
    const { list, added, updated } = mergeExploreSeedIntoCatalog(
      [
        {
          entity: "npub1aaa",
          repo: "adventofcode-2025",
          createdAt: poisoned,
          lastNostrEventCreatedAt: Math.floor(poisoned / 1000),
          fromSeoSnapshot: true,
        },
      ],
      [
        {
          entity: "npub1aaa",
          repo: "adventofcode-2025",
          ownerPubkey: "aa".repeat(32),
          lastActivity: real,
        },
      ]
    );
    expect(added).toBe(0);
    expect(updated).toBe(1);
    const row = list.find((r) => r.repo === "adventofcode-2025");
    expect(row?.createdAt).toBe(real);
    expect(row?.lastNostrEventCreatedAt).toBe(Math.floor(real / 1000));
  });

  it("drops snapshot-only rows that left the SEO file, keeps locals and live Nostr", () => {
    const hex =
      "7da083932c0e21087669074509b4e169b7ad9925c7a01c3fd3bd3dd0034d1336";
    const { list, added, removed } = mergeExploreSeedIntoCatalog(
      [
        {
          entity: "npub1aaa",
          repo: "deleted-repo",
          fromSeoSnapshot: true,
        },
        {
          entity: "npub1aaa",
          repo: hex,
          fromSeoSnapshot: true,
        },
        { entity: "npub1local", repo: "bridge-only" },
        {
          entity: "npub1ccc",
          repo: "live-only",
          syncedFromNostr: true,
        },
      ],
      [
        {
          entity: "npub1bbb",
          repo: "iris-drive",
          ownerPubkey: "bb".repeat(32),
          lastActivity: 9,
        },
      ]
    );
    expect(added).toBe(1);
    expect(removed).toBe(1);
    expect(list.map((r) => r.repo).sort()).toEqual([
      "bridge-only",
      "iris-drive",
      "live-only",
    ]);
  });

  it("resets matching catalog timestamps from the seed so fake newest stamps cannot stay on top", () => {
    const { list, updated } = mergeExploreSeedIntoCatalog(
      [
        {
          entity: "npub1aaa",
          repo: "gittr",
          createdAt: Date.now(),
          lastNostrEventCreatedAt: Math.floor(Date.now() / 1000),
          syncedFromNostr: true,
        },
      ],
      [
        {
          entity: "npub1aaa",
          repo: "gittr",
          ownerPubkey: "aa".repeat(32),
          lastActivity: 1_700_000_000_000,
        },
      ]
    );
    expect(updated).toBe(1);
    expect(list[0]?.createdAt).toBe(1_700_000_000_000);
    expect(list[0]?.lastNostrEventCreatedAt).toBe(1_700_000_000);
  });

  it("evicts old snapshot rows at cap so homepage-newest seed names still enter", () => {
    const existing = Array.from({ length: 3 }, (_, i) => ({
      entity: "npub1old",
      repo: `junk-${i}`,
      createdAt: 1,
      fromSeoSnapshot: true,
    }));
    const { list, added } = mergeExploreSeedIntoCatalog(
      existing,
      [
        {
          entity: "npub1bbb",
          repo: "iris-drive",
          ownerPubkey: "bb".repeat(32),
          lastActivity: 9,
        },
      ],
      3
    );
    expect(added).toBe(1);
    expect(list.some((r) => r.repo === "iris-drive")).toBe(true);
    expect(list.map((r) => r.repo)).toEqual(["iris-drive"]);
  });
});
