import { describe, expect, it } from "vitest";

import {
  parseStatusSitesAuthor,
  parseStatusSitesLimitOffset,
  sliceStatusSites,
} from "./paginate-gateway-sites";

describe("parseStatusSitesAuthor", () => {
  it("accepts a 64-char hex pubkey", () => {
    const hex = "a".repeat(64);
    expect(
      parseStatusSitesAuthor(new URLSearchParams(`author=${hex.toUpperCase()}`))
    ).toBe(hex);
  });

  it("rejects junk", () => {
    expect(parseStatusSitesAuthor(new URLSearchParams("author=npub1x"))).toBe(
      null
    );
  });
});

describe("parseStatusSitesLimitOffset", () => {
  it("omits limit when the query has none (full list)", () => {
    expect(parseStatusSitesLimitOffset(new URLSearchParams()).limit).toBeNull();
    expect(parseStatusSitesLimitOffset(new URLSearchParams()).offset).toBe(0);
  });

  it("clamps a positive page size", () => {
    const q = new URLSearchParams("limit=48&offset=48");
    expect(parseStatusSitesLimitOffset(q)).toEqual({ limit: 48, offset: 48 });
  });

  it("caps huge limits", () => {
    const q = new URLSearchParams("limit=99999");
    expect(parseStatusSitesLimitOffset(q).limit).toBe(500);
  });
});

describe("sliceStatusSites", () => {
  const rows = ["a", "b", "c", "d", "e"];

  it("returns the first page and hasMore", () => {
    expect(sliceStatusSites(rows, 0, 2)).toEqual({
      page: ["a", "b"],
      total: 5,
      hasMore: true,
    });
  });

  it("returns the last partial page", () => {
    expect(sliceStatusSites(rows, 4, 2)).toEqual({
      page: ["e"],
      total: 5,
      hasMore: false,
    });
  });

  it("returns all when limit is null", () => {
    expect(sliceStatusSites(rows, 0, null)).toEqual({
      page: rows,
      total: 5,
      hasMore: false,
    });
  });
});
