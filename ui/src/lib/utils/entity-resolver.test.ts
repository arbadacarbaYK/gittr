import { nip19 } from "nostr-tools";
import { describe, expect, it } from "vitest";

import {
  getEntityDisplayName,
  getEntityPicture,
  ownerProfileHref,
} from "./entity-resolver";

describe("getEntityDisplayName identities hardening", () => {
  const pubkey = "a".repeat(64);

  it("does not throw when identities is a non-array object", () => {
    expect(() =>
      getEntityDisplayName(
        pubkey,
        {
          [pubkey]: {
            name: "Someone (mirrored user from github)",
            // Corrupt kind-0 shape — must not call .find on this
            identities: { github: "someone" } as any,
          },
        },
        `npub1${"x".repeat(58)}`
      )
    ).not.toThrow();
  });

  it("uses github identity when identities is a proper array", () => {
    const name = getEntityDisplayName(
      pubkey,
      {
        [pubkey]: {
          name: "Someone (mirrored user from github)",
          identities: [{ platform: "github", identity: "cool-dev" }],
        },
      },
      undefined
    );
    expect(name).toBe("cool-dev");
  });

  it("uses camelCase displayName when display_name is missing", () => {
    expect(
      getEntityDisplayName(
        pubkey,
        { [pubkey]: { displayName: "BBakker" } as any },
        undefined
      )
    ).toBe("BBakker");
  });

  it("uses name when display fields are empty", () => {
    expect(
      getEntityDisplayName(pubkey, { [pubkey]: { name: "BBakker" } }, undefined)
    ).toBe("BBakker");
  });
});

describe("ownerProfileHref", () => {
  it("encodes a 64-hex pubkey as /npub…", () => {
    const hex = "aa".repeat(32);
    expect(ownerProfileHref(hex)).toBe(`/${nip19.npubEncode(hex)}`);
  });

  it("returns null for an empty id", () => {
    expect(ownerProfileHref("")).toBe(null);
    expect(ownerProfileHref("   ")).toBe(null);
  });

  it("keeps npub and other non-hex ids as a path segment", () => {
    expect(ownerProfileHref("npub1abc")).toBe("/npub1abc");
  });
});

describe("getEntityPicture", () => {
  const pubkey = "a".repeat(64);

  it("accepts https and inline data:image pictures", () => {
    expect(
      getEntityPicture(pubkey, {
        [pubkey]: { picture: "https://cdn.example/a.png" },
      })
    ).toBe("https://cdn.example/a.png");
    expect(
      getEntityPicture(pubkey, {
        [pubkey]: { picture: "data:image/svg+xml;base64,PHN2Zy8+" },
      })
    ).toBe("data:image/svg+xml;base64,PHN2Zy8+");
  });

  it("rejects javascript and non-image data URLs", () => {
    expect(
      getEntityPicture(pubkey, {
        [pubkey]: { picture: "javascript:alert(1)" },
      })
    ).toBeNull();
    expect(
      getEntityPicture(pubkey, {
        [pubkey]: { picture: "data:text/html,<h1>x</h1>" },
      })
    ).toBeNull();
  });
});
