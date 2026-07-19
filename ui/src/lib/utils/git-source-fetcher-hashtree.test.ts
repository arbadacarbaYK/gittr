import { describe, expect, it } from "vitest";

import {
  hasOnlyHashtreeCloneUrls,
  isHashtreeCloneUrl,
  parseHashtreeCloneUrl,
} from "./hashtree-clone";

describe("hashtree clone URLs", () => {
  const htree =
    "htree://npub1xdhnr9mrv47kkrn95k6cwecearydeh8e895990n3acntwvmgk2dsdeeycm/fips";

  it("detects htree://", () => {
    expect(isHashtreeCloneUrl(htree)).toBe(true);
    expect(isHashtreeCloneUrl("https://git.gittr.space/npub1x/fips.git")).toBe(
      false
    );
  });

  it("parseHashtreeCloneUrl types hashtree", () => {
    const src = parseHashtreeCloneUrl(htree);
    expect(src?.type).toBe("hashtree");
    expect(src?.displayName).toBe("Hashtree");
    expect(src?.npub).toMatch(/^npub1/);
    expect(src?.repo).toBe("fips");
  });

  it("hasOnlyHashtreeCloneUrls", () => {
    expect(hasOnlyHashtreeCloneUrls([htree])).toBe(true);
    expect(
      hasOnlyHashtreeCloneUrls([
        htree,
        "https://git.gittr.space/npub1x/fips.git",
      ])
    ).toBe(false);
    expect(hasOnlyHashtreeCloneUrls([])).toBe(false);
  });
});
