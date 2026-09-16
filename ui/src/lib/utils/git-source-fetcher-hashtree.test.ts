import { describe, expect, it } from "vitest";

import {
  hasOnlyHashtreeCloneUrls,
  irisGitBrowseUrlFromHashtreeClone,
  isHashtreeCloneUrl,
  normalizeHashtreeCloneUrl,
  parseHashtreeCloneUrl,
} from "./hashtree-clone";

describe("hashtree clone URLs", () => {
  const npub =
    "npub1xdhnr9mrv47kkrn95k6cwecearydeh8e895990n3acntwvmgk2dsdeeycm";
  const htree = `htree://${npub}/fips`;
  const malformedHttps = `https://htree://${npub}/gyoza-hanto.git`;

  it("detects htree://", () => {
    expect(isHashtreeCloneUrl(htree)).toBe(true);
    expect(isHashtreeCloneUrl("https://git.gittr.space/npub1x/fips.git")).toBe(
      false
    );
  });

  it("treats accidental https://htree:// rewrite as Hashtree", () => {
    expect(isHashtreeCloneUrl(malformedHttps)).toBe(true);
    expect(normalizeHashtreeCloneUrl(malformedHttps)).toBe(
      `htree://${npub}/gyoza-hanto.git`
    );
    expect(isHashtreeCloneUrl(`https://htree/${npub}/gyoza-hanto.git`)).toBe(
      true
    );
  });

  it("parseHashtreeCloneUrl types hashtree", () => {
    const src = parseHashtreeCloneUrl(htree);
    expect(src?.type).toBe("hashtree");
    expect(src?.displayName).toBe("Hashtree");
    expect(src?.npub).toMatch(/^npub1/);
    expect(src?.repo).toBe("fips");
  });

  it("parseHashtreeCloneUrl canonicalizes the https://htree:// form", () => {
    const src = parseHashtreeCloneUrl(malformedHttps);
    expect(src?.type).toBe("hashtree");
    expect(src?.url.startsWith("htree://")).toBe(true);
    expect(src?.repo).toBe("gyoza-hanto");
    expect(irisGitBrowseUrlFromHashtreeClone(malformedHttps)).toBe(
      `https://git.iris.to/#/${npub}/gyoza-hanto`
    );
  });

  it("hasOnlyHashtreeCloneUrls", () => {
    expect(hasOnlyHashtreeCloneUrls([htree])).toBe(true);
    expect(hasOnlyHashtreeCloneUrls([htree, malformedHttps])).toBe(true);
    expect(
      hasOnlyHashtreeCloneUrls([
        htree,
        "https://git.gittr.space/npub1x/fips.git",
      ])
    ).toBe(false);
    expect(hasOnlyHashtreeCloneUrls([])).toBe(false);
  });
});
