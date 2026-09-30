import { describe, expect, it } from "vitest";

import { shouldAbortSilentSignEvent } from "./bunker-sign-wait";

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
