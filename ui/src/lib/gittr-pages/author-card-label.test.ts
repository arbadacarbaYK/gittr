import { nip19 } from "nostr-tools";
import { describe, expect, it } from "vitest";

import {
  authorPubkeyHexNormalized,
  cardAuthorProfileHref,
  formatPagesStatCount,
  siteHostname,
  siteKindLabel,
} from "./author-card-label";

const hex = "aa".repeat(32);

describe("cardAuthorProfileHref", () => {
  it("encodes authorPubkeyHex as /npub…", () => {
    expect(
      cardAuthorProfileHref({
        authorDisplay: "Zapstore",
        authorPubkeyHex: hex,
      })
    ).toBe(`/${nip19.npubEncode(hex)}`);
  });

  it("uses an npub in authorDisplay when hex is missing", () => {
    expect(
      cardAuthorProfileHref({
        authorDisplay: "npub1abc",
      })
    ).toBe("/npub1abc");
  });

  it("does not turn a human name into a profile path", () => {
    expect(cardAuthorProfileHref({ authorDisplay: "Zapstore" })).toBe(null);
    expect(cardAuthorProfileHref({ authorDisplay: "" })).toBe(null);
  });
});

describe("pages card display helpers", () => {
  it("normalizes a 64-hex author pubkey", () => {
    expect(authorPubkeyHexNormalized(`0x${hex.toUpperCase()}`)).toBe(hex);
    expect(authorPubkeyHexNormalized("nope")).toBe(null);
  });

  it("strips www from the site hostname", () => {
    expect(siteHostname("https://www.pages.gittr.space/foo")).toBe(
      "pages.gittr.space"
    );
    expect(siteHostname("not a url")).toBe("");
  });

  it("labels named vs npub site kinds", () => {
    expect(siteKindLabel("named")).toBe("Named");
    expect(siteKindLabel("root")).toBe("Npub site");
    expect(siteKindLabel(undefined)).toBe(null);
  });

  it("shortens large hit counts", () => {
    expect(formatPagesStatCount(12)).toBe("12");
    expect(formatPagesStatCount(1500)).toBe("1.5k");
    expect(formatPagesStatCount(12000)).toBe("12k");
  });
});
