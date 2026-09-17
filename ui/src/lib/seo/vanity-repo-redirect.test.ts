import { nip19 } from "nostr-tools";
import { describe, expect, it } from "vitest";

import {
  canonicalNpubRepoPath,
  isOgImageRepoSuffix,
  isSocialCardCrawler,
  ogImageNameFromPath,
  profileNamesMatchEntity,
  repoPathAfterEntityRepo,
  vanityOgImageRedirectTarget,
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

describe("ogImageNameFromPath", () => {
  it("sends vanity social-card images to the npub image URL", () => {
    expect(ogImageNameFromPath("/opengraph-image")).toBe("opengraph-image");
    expect(ogImageNameFromPath("/twitter-image")).toBe("twitter-image");
    expect(ogImageNameFromPath("/issues")).toBeNull();
  });
});

describe("vanityOgImageRedirectTarget", () => {
  it("rewrites vanity twitter/opengraph image paths onto the npub", () => {
    expect(
      vanityOgImageRedirectTarget("/DrShift/buho-go/twitter-image", PK)
    ).toBe(`/${NPUB}/buho-go/twitter-image`);
    expect(
      vanityOgImageRedirectTarget("/DrShift/buho-go/opengraph-image", PK)
    ).toBe(`/${NPUB}/buho-go/opengraph-image`);
    expect(
      vanityOgImageRedirectTarget(`/${NPUB}/buho-go/twitter-image`, PK)
    ).toBeNull();
  });
});

describe("isSocialCardCrawler", () => {
  it("keeps X/Telegram on the HTML page so About meta is not lost on 307", () => {
    expect(isSocialCardCrawler("Twitterbot/1.0")).toBe(true);
    expect(isSocialCardCrawler("TelegramBot (like TwitterBot)")).toBe(true);
    expect(isSocialCardCrawler("Mozilla/5.0 Chrome/120")).toBe(false);
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
