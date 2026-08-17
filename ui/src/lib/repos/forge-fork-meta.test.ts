import { describe, expect, it } from "vitest";

import { formatForgeAttributionLabel } from "./forge-fork-meta";

describe("formatForgeAttributionLabel", () => {
  it("strips scheme and .git for HTTPS forge URLs", () => {
    expect(
      formatForgeAttributionLabel(
        "https://codeberg.org/parent/upstream.git"
      )
    ).toBe("codeberg.org/parent/upstream");
  });

  it("keeps gittr fork pointer paths", () => {
    expect(
      formatForgeAttributionLabel(
        "/npub1abc123/my-fork"
      )
    ).toBe("npub1abc123/my-fork");
  });
});
