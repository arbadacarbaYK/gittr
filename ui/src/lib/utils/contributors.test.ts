import { describe, expect, it } from "vitest";

import {
  mergeOwnerPubkeyIntoContributors,
  sanitizeContributors,
} from "./contributors";

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

describe("sanitizeContributors github noreply lookalikes", () => {
  it("hides ArBaDaCarBa when arbadacarbaYK is already a contributor", () => {
    const out = sanitizeContributors(
      [
        {
          githubLogin: "arbadacarbaYK",
          picture: "https://github.com/arbadacarbaYK.png",
          weight: 82,
        },
        {
          githubLogin: "ArBaDaCarBa",
          picture: "https://github.com/arbadacarba.png",
          weight: 1,
        },
      ],
      { keepNameOnly: true }
    );
    expect(out.map((c) => c.githubLogin)).toEqual(["arbadacarbayk"]);
  });

  it("keeps a lookalike that already has a Nostr pubkey", () => {
    const pk = "b".repeat(64);
    const out = sanitizeContributors(
      [
        { githubLogin: "arbadacarbaYK", weight: 82 },
        { githubLogin: "arbadacarba", pubkey: pk, weight: 1 },
      ],
      { keepNameOnly: true }
    );
    expect(out).toHaveLength(2);
    expect(out.some((c) => c.pubkey === pk)).toBe(true);
  });
});
