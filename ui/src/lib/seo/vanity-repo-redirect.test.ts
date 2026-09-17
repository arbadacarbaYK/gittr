import { nip19 } from "nostr-tools";
import { describe, expect, it } from "vitest";

import {
  canonicalNpubRepoPath,
  isOgImageRepoSuffix,
  profileNamesMatchEntity,
  repoPathAfterEntityRepo,
} from "./vanity-repo-redirect";

const PK = "f6150173b5d6f079b43540d84a8a95d50cf01a48c9d6037984e3d9600d5522af";
const NPUB = nip19.npubEncode(PK);

describe("repoPathAfterEntityRepo", () => {
  it("keeps issues/commits suffixes for the vanity → npub reroute", () => {
    expect(
      repoPathAfterEntityRepo("/DrShift/buho-go", "DrShift", "buho-go")
    ).toBe("");
    expect(
      repoPathAfterEntityRepo("/DrShift/buho-go/issues", "DrShift", "buho-go")
    ).toBe("/issues");
    expect(
      repoPathAfterEntityRepo(
        "/DrShift/buho-go/commits/abc",
        "DrShift",
        "buho-go"
      )
    ).toBe("/commits/abc");
  });
});

describe("canonicalNpubRepoPath", () => {
  it("builds the npub Code URL and preserves query + suffix", () => {
    expect(canonicalNpubRepoPath(PK, "buho-go")).toBe(`/${NPUB}/buho-go`);
    expect(canonicalNpubRepoPath(PK, "buho-go", "/issues", "?q=1")).toBe(
      `/${NPUB}/buho-go/issues?q=1`
    );
  });
});

describe("isOgImageRepoSuffix", () => {
  it("skips social-card image routes so composition still runs at the vanity URL", () => {
    expect(isOgImageRepoSuffix("/opengraph-image")).toBe(true);
    expect(isOgImageRepoSuffix("/twitter-image")).toBe(true);
    expect(isOgImageRepoSuffix("/issues")).toBe(false);
  });
});

describe("profileNamesMatchEntity", () => {
  it("matches kind 0 name or display_name, not a different GitHub login", () => {
    expect(
      profileNamesMatchEntity(
        { name: "DrShift", display_name: "Juan" },
        "DrShift"
      )
    ).toBe(true);
    expect(
      profileNamesMatchEntity({ name: "bob", display_name: "Bob" }, "facebook")
    ).toBe(false);
  });
});
