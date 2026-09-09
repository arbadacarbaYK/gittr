import { describe, expect, it } from "vitest";

import {
  commentEventBelongsToThread,
  parseNip22Comment,
  pubkeysReferToSamePerson,
  repoTagMatchesRoute,
} from "./nip22-comment-thread";

const OWNER_HEX =
  "9a83779e75080556c656d4d418d02a4d7edbe288a2f9e6dd2b48799ec935184c";
const OWNER_NPUB =
  "npub1n2ph08n4pqz4d3jk6n2p35p2f4ldhc5g5tu7dhftfpueajf4rpxqfjhzmc";
const PR_ID =
  "9f1730445f0b3760fdcf06b2422c6ba39355f3ba13dc78251d9180412bf25a93";
const COMMENT_ID =
  "d59f607c2ec232c07f04de1980b55d1a19b7b61600efde691ec99f58708d4e7f";

describe("nip22 comment thread matching", () => {
  it("treats npub route entity and hex repo tag as the same owner", () => {
    expect(pubkeysReferToSamePerson(OWNER_HEX, OWNER_NPUB)).toBe(true);
    expect(
      repoTagMatchesRoute(
        ["repo", OWNER_HEX, "gittr-mcp"],
        OWNER_NPUB,
        "gittr-mcp"
      )
    ).toBe(true);
  });

  it("accepts MCP createPRComment tags on a gittr PR page (npub URL, hex repo tag)", () => {
    const event = {
      id: COMMENT_ID,
      pubkey: OWNER_HEX,
      content: "Thanks Kai — landed on 1.0.7",
      created_at: 1_700_000_000,
      tags: [
        ["E", PR_ID],
        ["K", "1618"],
        [
          "P",
          "9f888fe6f3bf1e6b01bbca3e1d6e035650024bef38846fe80ebfc8a9839a54bc",
        ],
        ["e", PR_ID],
        ["k", "1618"],
        ["repo", OWNER_HEX, "gittr-mcp"],
      ],
    };
    expect(
      commentEventBelongsToThread(event, {
        rootEventId: PR_ID,
        entity: OWNER_NPUB,
        repo: "gittr-mcp",
      })
    ).toBe(true);
    const parsed = parseNip22Comment(event, PR_ID);
    expect(parsed?.content).toContain("1.0.7");
    expect(parsed?.parentId).toBeUndefined();
  });

  it("still shows a comment when the optional repo tag is missing", () => {
    const event = {
      id: COMMENT_ID,
      pubkey: OWNER_HEX,
      content: "hello",
      created_at: 1,
      tags: [
        ["E", PR_ID],
        ["e", PR_ID],
      ],
    };
    expect(
      commentEventBelongsToThread(event, {
        rootEventId: PR_ID,
        entity: OWNER_NPUB,
        repo: "gittr-mcp",
      })
    ).toBe(true);
  });

  it("rejects a comment for a different PR or repo name", () => {
    const event = {
      id: COMMENT_ID,
      pubkey: OWNER_HEX,
      content: "nope",
      created_at: 1,
      tags: [
        ["E", "aa".repeat(32)],
        ["repo", OWNER_HEX, "other-repo"],
      ],
    };
    expect(
      commentEventBelongsToThread(event, {
        rootEventId: PR_ID,
        entity: OWNER_NPUB,
        repo: "gittr-mcp",
      })
    ).toBe(false);
  });
});
