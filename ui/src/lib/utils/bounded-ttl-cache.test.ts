import { afterEach, describe, expect, it, vi } from "vitest";

import { BoundedTtlCache } from "./bounded-ttl-cache";

describe("BoundedTtlCache", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("evicts oldest when over maxEntries", () => {
    const c = new BoundedTtlCache<number>(60_000, 2);
    c.set("a", 1);
    c.set("b", 2);
    c.set("c", 3);
    expect(c.get("a")).toBeUndefined();
    expect(c.get("b")).toBe(2);
    expect(c.get("c")).toBe(3);
    expect(c.size).toBe(2);
  });

  it("expires by TTL", () => {
    vi.useFakeTimers();
    const c = new BoundedTtlCache<string>(1_000, 10);
    c.set("k", "v");
    expect(c.get("k")).toBe("v");
    vi.advanceTimersByTime(1_001);
    expect(c.get("k")).toBeUndefined();
  });
});
