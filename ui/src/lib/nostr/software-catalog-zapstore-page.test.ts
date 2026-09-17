import { describe, expect, it } from "vitest";

import { KIND_SOFTWARE_APPLICATION } from "./nip82-software";
import {
  ZAPSTORE_KIND_ONLY_PAGE_LIMIT,
  nextUntilFromCreatedAts,
  zapstoreAppPageFilter,
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
