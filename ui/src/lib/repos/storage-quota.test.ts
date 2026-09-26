import { describe, expect, it } from "vitest";

import { quotaKeepList, setItemReplacingQuota } from "./storage-quota-keep";

const ME = "a".repeat(64);
const OTHER = "b".repeat(64);

function repo(
  name: string,
  owner: string,
  extra: Record<string, unknown> = {}
) {
  return {
    repo: name,
    ownerPubkey: owner,
    lastNostrEventCreatedAt: 1_700_000_000,
    ...extra,
  };
}

describe("quota keep list", () => {
  it("keeps a short copy of a catalog that is too big", () => {
    const rows = Array.from({ length: 120 }, (_, i) =>
      repo(`r-${i}`, OTHER, { lastNostrEventCreatedAt: 1_700_000_000 + i })
    );
    const kept = quotaKeepList(rows, 40);
    expect(kept).toHaveLength(40);
    expect(kept[0]?.repo).toBe("r-119");
  });

  it("keeps your own repo even when it is old", () => {
    const mine = repo("mine", ME, { lastNostrEventCreatedAt: 1 });
    const rows = [
      mine,
      ...Array.from({ length: 120 }, (_, i) =>
        repo(`r-${i}`, OTHER, { lastNostrEventCreatedAt: 1_700_000_000 + i })
      ),
    ];
    const kept = quotaKeepList(rows, 40, ME);
    expect(kept.some((row) => row.repo === "mine")).toBe(true);
    expect(kept.length).toBeLessThan(rows.length);
  });

  it("keeps a local draft ahead of the cap", () => {
    const draft = repo("draft", OTHER, {
      status: "local",
      lastNostrEventCreatedAt: 1,
    });
    const rows = [
      draft,
      ...Array.from({ length: 10 }, (_, i) => repo(`r-${i}`, OTHER)),
    ];
    const kept = quotaKeepList(rows, 3);
    expect(kept.some((row) => row.repo === "draft")).toBe(true);
  });
});

describe("setItemReplacingQuota", () => {
  it("drops the previous blob when the browser counts old and new together", () => {
    const store = new Map<string, string>();
    store.set("gittr_repos", "x".repeat(90));
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      removeItem: (key: string) => {
        store.delete(key);
      },
      setItem: (key: string, value: string) => {
        const previous = store.get(key);
        const combined =
          (previous ? previous.length : 0) + value.length + key.length;
        if (combined > 100) {
          const error = new Error("quota");
          error.name = "QuotaExceededError";
          throw error;
        }
        store.set(key, value);
      },
    };
    expect(setItemReplacingQuota(storage, "gittr_repos", "small")).toBe(true);
    expect(store.get("gittr_repos")).toBe("small");
  });
});
