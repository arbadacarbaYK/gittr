import { nip19 } from "nostr-tools";
import { describe, expect, it } from "vitest";

import { cardAuthorProfileHref } from "./author-card-label";

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
