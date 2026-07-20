import { describe, expect, it } from "vitest";

import { getEntityDisplayName } from "./entity-resolver";

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
});
