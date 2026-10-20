import { describe, expect, it } from "vitest";

import {
  buildUnsignedZapRequest9734,
  nip65UrlsForMarker,
  pickZapRelays,
  repoAddressesEqual,
  repoAnnouncementAddress,
} from "./nip57-zap";

const owner = "a".repeat(64);
const sender = "b".repeat(64);
const eventId = "c".repeat(64);

describe("repo announcement address", () => {
  it("builds a 30617 coordinate and matches case-insensitively", () => {
    const address = repoAnnouncementAddress(owner.toUpperCase(), "Gittr");
    expect(address).toBe(`30617:${owner}:Gittr`);
    expect(repoAddressesEqual(address, `30617:${owner}:gittr`)).toBe(true);
  });

  it("decodes a repo name from a URL", () => {
    expect(repoAnnouncementAddress(owner, "my%20repo")).toBe(
      `30617:${owner}:my repo`
    );
  });
});

describe("pickZapRelays", () => {
  it("keeps a recipient inbox and a sender outbox, then repo relays", () => {
    expect(
      pickZapRelays({
        recipientInboxes: ["wss://inbox.example"],
        senderOutboxes: ["wss://outbox.example"],
        repoRelays: ["wss://repo.example", "wss://inbox.example"],
        fallback: ["wss://relay.damus.io"],
        max: 4,
      })
    ).toEqual([
      "wss://inbox.example",
      "wss://outbox.example",
      "wss://repo.example",
      "wss://relay.damus.io",
    ]);
  });
});

describe("nip65UrlsForMarker", () => {
  it("includes unmarked relays for both directions and skips the other marker", () => {
    const tags = [
      ["r", "wss://both.example"],
      ["r", "wss://read.example", "read"],
      ["r", "wss://write.example", "write"],
    ];
    expect(nip65UrlsForMarker(tags, "read")).toEqual([
      "wss://both.example",
      "wss://read.example",
    ]);
  });
});

describe("buildUnsignedZapRequest9734", () => {
  it("points a repo zap at the announcement", () => {
    const event = buildUnsignedZapRequest9734({
      senderPubkeyHex: sender,
      recipientPubkeyHex: owner,
      amountMsat: 21000,
      relays: ["wss://relay.damus.io", "not-a-relay"],
      lnurlBech32: "lnurl1example",
      content: "Zap for alice/gittr",
      address: repoAnnouncementAddress(owner, "gittr") || undefined,
      eventId,
      eventKind: 30617,
    });
    expect(event.kind).toBe(9734);
    expect(event.tags).toContainEqual(["e", eventId]);
    expect(event.tags).toContainEqual(["a", `30617:${owner}:gittr`]);
    expect(event.tags).toContainEqual(["k", "30617"]);
    expect(event.tags.find((tag) => tag[0] === "relays")).toEqual([
      "relays",
      "wss://relay.damus.io",
    ]);
  });
});
