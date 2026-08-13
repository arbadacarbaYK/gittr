import { KIND_RELAY_LIST } from "@/lib/nostr/events";
import {
  buildRelayListTags,
  parseRelayListEvent,
} from "@/lib/nostr/nip65-relay-list";

import { describe, expect, it } from "vitest";

describe("nip65-relay-list", () => {
  it("parses r tags and markers", () => {
    const parsed = parseRelayListEvent({
      kind: KIND_RELAY_LIST,
      pubkey: "abc",
      id: "1",
      created_at: 1,
      tags: [
        ["r", "wss://relay.gittr.space/"],
        ["r", "wss://nos.lol", "write"],
        ["r", "wss://relay.gittr.space"], // dup
        ["p", "deadbeef"],
      ],
    });
    expect(parsed?.relays).toEqual([
      { url: "wss://relay.gittr.space" },
      { url: "wss://nos.lol", marker: "write" },
    ]);
  });

  it("builds tags without wiping markers", () => {
    expect(
      buildRelayListTags([
        { url: "wss://relay.gittr.space/" },
        { url: "wss://nos.lol", marker: "write" },
      ])
    ).toEqual([
      ["r", "wss://relay.gittr.space"],
      ["r", "wss://nos.lol", "write"],
    ]);
  });
});
