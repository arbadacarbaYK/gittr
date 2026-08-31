import { describe, expect, it } from "vitest";

import { extractKind0FromPrimalBody } from "./primal-user-profile";

const PUBKEY = "a".repeat(64);

describe("extractKind0FromPrimalBody", () => {
  it("reads kind 0 from a JSON array and copies displayName", () => {
    const event = {
      id: "1",
      pubkey: PUBKEY,
      created_at: 1760440991,
      kind: 0,
      tags: [],
      content: JSON.stringify({
        name: "BBakker",
        displayName: "BBakker",
        about: "HI",
      }),
    };
    const meta = extractKind0FromPrimalBody(
      JSON.stringify([event, { kind: 3 }]),
      PUBKEY
    );
    expect(meta?.name).toBe("BBakker");
    expect(meta?.display_name).toBe("BBakker");
    expect(meta?.created_at).toBe(1760440991);
  });

  it("ignores events for other pubkeys", () => {
    const event = {
      pubkey: "b".repeat(64),
      kind: 0,
      content: JSON.stringify({ name: "Other" }),
    };
    expect(
      extractKind0FromPrimalBody(JSON.stringify([event]), PUBKEY)
    ).toBeNull();
  });
});
