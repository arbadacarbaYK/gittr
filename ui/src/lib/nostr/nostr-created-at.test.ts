import { describe, expect, it } from "vitest";

import {
  nostrTimestampToMs,
  nostrTimestampToSeconds,
} from "./nostr-created-at";

describe("nostrTimestampToSeconds", () => {
  it("keeps Nostr seconds", () => {
    expect(nostrTimestampToSeconds(1_700_000_000)).toBe(1_700_000_000);
  });

  it("converts Date.now() milliseconds so they cannot skip live events", () => {
    const now = Date.now();
    expect(nostrTimestampToSeconds(now)).toBe(Math.floor(now / 1000));
    expect(nostrTimestampToMs(now)).toBe(Math.floor(now / 1000) * 1000);
  });

  it("zeros far-future poison stamps", () => {
    expect(nostrTimestampToSeconds(9_999_999_999)).toBe(0);
  });
});
