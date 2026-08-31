import { describe, expect, it } from "vitest";

import { slugToNsiteDTag } from "./nsite-url";

describe("slugToNsiteDTag", () => {
  it("shortens conference-loop to the NIP-5A 13-character d-tag", () => {
    expect(slugToNsiteDTag("conference-loop")).toBe("conference-lo");
  });

  it("keeps a name that already fits", () => {
    expect(slugToNsiteDTag("conf-loop")).toBe("conf-loop");
  });
});
