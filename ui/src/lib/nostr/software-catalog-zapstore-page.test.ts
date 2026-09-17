import { describe, expect, it } from "vitest";

import { KIND_SOFTWARE_APPLICATION } from "./nip82-software";
import {
  ZAPSTORE_KIND_ONLY_PAGE_LIMIT,
  nextUntilFromCreatedAts,
  olderZapstoreUntil,
  zapstoreAppPageFilter,
  zapstoreCursorNeedsResume,
} from "./software-catalog-zapstore-page";

describe("zapstoreAppPageFilter", () => {
  it("keeps kinds-only queries at the limit Zapstore accepts", () => {
    expect(ZAPSTORE_KIND_ONLY_PAGE_LIMIT).toBe(50);
    expect(zapstoreAppPageFilter()).toEqual({
      kinds: [KIND_SOFTWARE_APPLICATION],
      limit: 50,
    });
    expect(zapstoreAppPageFilter(1_700_000_000)).toEqual({
      kinds: [KIND_SOFTWARE_APPLICATION],
      limit: 50,
      until: 1_700_000_000,
    });
  });
});

describe("nextUntilFromCreatedAts", () => {
  it("steps one second before the oldest event", () => {
    expect(nextUntilFromCreatedAts([10, 4, 8])).toBe(3);
    expect(nextUntilFromCreatedAts([])).toBeNull();
    expect(nextUntilFromCreatedAts([undefined, 5])).toBe(4);
  });
});

describe("olderZapstoreUntil", () => {
  it("keeps the deeper (older) cursor", () => {
    expect(olderZapstoreUntil(100, 50)).toBe(50);
    expect(olderZapstoreUntil(null, 50)).toBe(50);
    expect(olderZapstoreUntil(undefined, undefined)).toBeNull();
  });
});

describe("zapstoreCursorNeedsResume", () => {
  it("resumes when many stored apps are older than until", () => {
    expect(
      zapstoreCursorNeedsResume({
        done: true,
        until: 90,
        appCreatedAts: Array.from({ length: 25 }, (_, i) => i),
      })
    ).toBe(true);
    expect(
      zapstoreCursorNeedsResume({
        done: true,
        until: 1,
        appCreatedAts: [10, 20, 30],
      })
    ).toBe(false);
  });
});
