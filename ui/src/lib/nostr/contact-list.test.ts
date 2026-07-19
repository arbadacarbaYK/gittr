import { describe, expect, it } from "vitest";

import { parseContactListPubkeys } from "./contact-list";

describe("parseContactListPubkeys", () => {
  it("reads NIP-02 p tags", () => {
    const a = "a".repeat(64);
    const b = "b".repeat(64);
    expect(
      parseContactListPubkeys({
        tags: [
          ["p", a],
          ["p", b, "wss://relay.damus.io"],
        ],
        content: "",
      }).sort()
    ).toEqual([a, b].sort());
  });

  it("merges gittr JSON content with tags", () => {
    const a = "a".repeat(64);
    const b = "b".repeat(64);
    expect(
      parseContactListPubkeys({
        tags: [["p", a]],
        content: JSON.stringify({ p: [[b, "", "wss://x"]] }),
      }).sort()
    ).toEqual([a, b].sort());
  });
});
