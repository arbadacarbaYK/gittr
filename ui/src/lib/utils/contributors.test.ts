import { describe, expect, it } from "vitest";

import { mergeOwnerPubkeyIntoContributors } from "./contributors";

describe("mergeOwnerPubkeyIntoContributors", () => {
  const owner = "a".repeat(64);

  it("strips name-only shadow owner when real pubkey is known", () => {
    const merged = mergeOwnerPubkeyIntoContributors(
      [{ name: "arbadacarba", weight: 100 }],
      owner,
      "arbadacarba"
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]?.pubkey).toBe(owner);
    expect(merged[0]?.name).toBe("arbadacarba");
  });

  it("strips name-only weight-100 even when displayName differs", () => {
    const merged = mergeOwnerPubkeyIntoContributors(
      [{ name: "someone", weight: 100, role: "owner" }],
      owner,
      "arbadacarba"
    );
    expect(merged.every((c) => !!c.pubkey)).toBe(true);
    expect(merged.some((c) => c.pubkey === owner)).toBe(true);
  });
});
