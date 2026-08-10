import { beforeEach, describe, expect, it } from "vitest";

import {
  forgetOverrideBlob,
  isOverrideIdbMarker,
  mimeFromOverrideIdbMarker,
  overrideIdbMarker,
  peekOverrideBlob,
  rememberOverrideBlob,
  resolveOverridesMap,
} from "./overrides-idb";

describe("overrides-idb markers + memory", () => {
  beforeEach(() => {
    forgetOverrideBlob("npub1abc", "repo");
  });

  it("round-trips marker mime", () => {
    const m = overrideIdbMarker("image/gif");
    expect(isOverrideIdbMarker(m)).toBe(true);
    expect(mimeFromOverrideIdbMarker(m)).toBe("image/gif");
  });

  it("keeps memory until forgotten", () => {
    rememberOverrideBlob("npub1abc", "repo", "a.gif", "AAAA");
    expect(peekOverrideBlob("npub1abc", "repo", "a.gif")).toBe("AAAA");
    forgetOverrideBlob("npub1abc", "repo", "a.gif");
    expect(peekOverrideBlob("npub1abc", "repo", "a.gif")).toBeUndefined();
  });

  it("resolveOverridesMap leaves inline text alone", async () => {
    const out = await resolveOverridesMap("npub1abc", "repo", {
      "readme.md": "# hi",
    });
    expect(out["readme.md"]).toBe("# hi");
  });

  it("resolveOverridesMap expands markers from memory without IDB", async () => {
    rememberOverrideBlob("npub1abc", "repo", "pic.gif", "BLOB64");
    const out = await resolveOverridesMap("npub1abc", "repo", {
      "pic.gif": overrideIdbMarker("image/gif"),
    });
    expect(out["pic.gif"]).toBe("BLOB64");
  });
});
