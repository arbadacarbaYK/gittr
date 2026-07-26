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

  it("prefers kind 10011 over kind 0", () => {
    expect(
      preferNip39Identities(
        [{ platform: "github", identity: "new" }],
        [{ platform: "github", identity: "legacy" }]
      )
    ).toEqual([{ platform: "github", identity: "new" }]);
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
