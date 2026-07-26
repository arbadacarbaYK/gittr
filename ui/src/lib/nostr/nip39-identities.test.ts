import { describe, expect, it } from "vitest";

import {
  KIND_NIP39_IDENTITIES,
  buildNip39ITags,
  buildNip39IdentitiesEventUnsigned,
  parseNip39ITags,
  preferNip39Identities,
} from "./nip39-identities";

describe("parseNip39ITags", () => {
  it("parses platform:identity and proof", () => {
    expect(
      parseNip39ITags([
        ["i", "github:semisol", "gistid"],
        ["i", "twitter:semisol_public"],
        ["p", "ignored"],
      ])
    ).toEqual([
      {
        platform: "github",
        identity: "semisol",
        proof: "gistid",
        verified: false,
      },
      {
        platform: "twitter",
        identity: "semisol_public",
        proof: undefined,
        verified: false,
      },
    ]);
  });

  it("handles identities with colons", () => {
    expect(
      parseNip39ITags([["i", "mastodon:bitcoinhackers.org/@semisol", "109"]])
    ).toEqual([
      {
        platform: "mastodon",
        identity: "bitcoinhackers.org/@semisol",
        proof: "109",
        verified: false,
      },
    ]);
  });

  it("returns empty for bad input", () => {
    expect(parseNip39ITags(null)).toEqual([]);
    expect(parseNip39ITags([["i", "nocolon"]])).toEqual([]);
  });
});

describe("buildNip39ITags / preferNip39Identities", () => {
  it("builds tags", () => {
    expect(
      buildNip39ITags([
        { platform: "GitHub", identity: "alice", proof: "x" },
        { platform: "twitter", identity: "bob" },
      ])
    ).toEqual([
      ["i", "github:alice", "x"],
      ["i", "twitter:bob"],
    ]);
  });

  it("unions 10011 and kind 0; same key prefers 10011 proof", () => {
    const merged = preferNip39Identities(
      [{ platform: "github", identity: "new", proof: "p" }],
      [
        { platform: "github", identity: "legacy" },
        { platform: "github", identity: "new" },
      ]
    );
    expect(merged).toHaveLength(2);
    expect(merged).toContainEqual({
      platform: "github",
      identity: "legacy",
    });
    expect(merged.find((i) => i.identity === "new")).toMatchObject({
      platform: "github",
      identity: "new",
      proof: "p",
    });
  });

  it("falls back to kind 0 when 10011 empty", () => {
    expect(
      preferNip39Identities([], [{ platform: "github", identity: "legacy" }])
    ).toEqual([{ platform: "github", identity: "legacy" }]);
  });
});

describe("buildNip39IdentitiesEventUnsigned", () => {
  it("uses kind 10011", () => {
    const ev = buildNip39IdentitiesEventUnsigned("ab".repeat(32), [
      { platform: "github", identity: "x" },
    ]);
    expect(ev.kind).toBe(KIND_NIP39_IDENTITIES);
    expect(ev.tags).toEqual([["i", "github:x"]]);
    expect(ev.content).toBe("");
  });
});
