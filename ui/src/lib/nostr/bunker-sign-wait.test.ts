import { describe, expect, it } from "vitest";

import {
  bunkerListenRelaysToAdd,
  shouldAbortSilentSignEvent,
} from "./bunker-sign-wait";

describe("shouldAbortSilentSignEvent", () => {
  it("keeps waiting when a relay already accepted the request", () => {
    expect(
      shouldAbortSilentSignEvent({
        inboundCount: 0,
        waitedMs: 24_000,
        publishSettled: true,
        publishAcked: true,
      })
    ).toBe(false);
  });

  it("keeps waiting while publish is still in flight", () => {
    expect(
      shouldAbortSilentSignEvent({
        inboundCount: 0,
        waitedMs: 24_000,
        publishSettled: false,
        publishAcked: false,
      })
    ).toBe(false);
  });

  it("keeps waiting once any bunker reply has arrived", () => {
    expect(
      shouldAbortSilentSignEvent({
        inboundCount: 1,
        waitedMs: 24_000,
        publishSettled: true,
        publishAcked: false,
      })
    ).toBe(false);
  });

  it("aborts only when nothing was accepted and Amber stayed silent", () => {
    expect(
      shouldAbortSilentSignEvent({
        inboundCount: 0,
        waitedMs: 24_000,
        publishSettled: true,
        publishAcked: false,
      })
    ).toBe(true);
  });

  it("does not abort before the silent window", () => {
    expect(
      shouldAbortSilentSignEvent({
        inboundCount: 0,
        waitedMs: 10_000,
        publishSettled: true,
        publishAcked: false,
      })
    ).toBe(false);
  });
});

describe("bunkerListenRelaysToAdd", () => {
  it("adds the relays Push published on, beside the warm-up socket", () => {
    expect(
      bunkerListenRelaysToAdd(
        ["wss://relay.primal.net/"],
        [
          "wss://relay.primal.net",
          "wss://relay.damus.io",
          "wss://nos.lol",
        ]
      )
    ).toEqual(["wss://relay.damus.io", "wss://nos.lol"]);
  });

  it("returns nothing when those relays are already being listened to", () => {
    expect(
      bunkerListenRelaysToAdd(
        ["wss://relay.primal.net", "wss://nos.lol"],
        ["wss://nos.lol/", "wss://relay.primal.net"]
      )
    ).toEqual([]);
  });
});
