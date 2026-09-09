import { describe, expect, it } from "vitest";

import { sanitizePullNumber } from "./forge-pr-range";

describe("sanitizePullNumber", () => {
  it("accepts a normal PR index", () => {
    expect(sanitizePullNumber("12")).toBe(12);
    expect(sanitizePullNumber("1")).toBe(1);
  });

  it("rejects junk", () => {
    expect(sanitizePullNumber("")).toBe(null);
    expect(sanitizePullNumber("pr-12")).toBe(null);
    expect(sanitizePullNumber("0")).toBe(null);
    expect(sanitizePullNumber("-1")).toBe(null);
    expect(sanitizePullNumber("12.5")).toBe(null);
  });
});
