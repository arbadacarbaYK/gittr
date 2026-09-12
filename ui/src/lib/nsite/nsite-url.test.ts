import { describe, expect, it } from "vitest";

import { slugToNsiteDTag } from "./nsite-url";

describe("slugToNsiteDTag", () => {
  it("shortens conference-loop to 13 characters (DNS label cap: 50-char key + name ≤ 63)", () => {
    expect(slugToNsiteDTag("conference-loop")).toBe("conference-lo");
  });

  it("keeps a name that already fits", () => {
    expect(slugToNsiteDTag("conf-loop")).toBe("conf-loop");
  });
});
