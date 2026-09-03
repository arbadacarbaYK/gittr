import { describe, expect, it } from "vitest";

import { parseContactListPubkeys } from "./contact-list";
import { extractKind3FromPrimalBody } from "./primal-contact-list";

const PUBKEY =
  "0840d84309f90a37678cb0546be6141e2940e4a77d4198274f3b469362d05484";

describe("extractKind3FromPrimalBody", () => {
  it("reads kind 3 p-tags from a Primal-style JSON array", () => {
    const follows = ["aa".repeat(32), "bb".repeat(32), "cc".repeat(32)];
    const event = {
      id: "b48728ce",
      pubkey: PUBKEY,
      created_at: 1762077175,
      kind: 3,
      tags: follows.map((p) => ["p", p]),
      content: "",
      sig: "ab",
    };
    const parsed = extractKind3FromPrimalBody(
      JSON.stringify([{ kind: 0 }, event, { follows_count: 3 }]),
      PUBKEY
    );
    expect(parsed?.kind).toBe(3);
    expect(parsed?.created_at).toBe(1762077175);
    expect(parseContactListPubkeys(parsed!).sort()).toEqual(follows.sort());
  });

  it("ignores kind 3 for other pubkeys", () => {
    const event = {
      pubkey: "b".repeat(64),
      kind: 3,
      tags: [["p", "a".repeat(64)]],
      content: "",
    };
    expect(
      extractKind3FromPrimalBody(JSON.stringify([event]), PUBKEY)
    ).toBeNull();
  });
});
