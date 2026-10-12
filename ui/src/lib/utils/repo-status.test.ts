import { describe, expect, it } from "vitest";

import {
  getRepoStatus,
  repoHasNostrAnnounce,
  repoStatusAfterRelayEcho,
} from "./repo-status";

describe("repoHasNostrAnnounce", () => {
  it("is false for activity stubs with no event id", () => {
    expect(repoHasNostrAnnounce({ slug: "gittr", entity: "npub1abc" })).toBe(
      false
    );
  });

  it("is true when a 30617 id or hydrate flag is present", () => {
    expect(repoHasNostrAnnounce({ lastNostrEventId: "ab".repeat(32) })).toBe(
      true
    );
    expect(repoHasNostrAnnounce({ syncedFromNostr: true })).toBe(true);
  });
});

describe("getRepoStatus", () => {
  it("shows Local only when there is no announce", () => {
    expect(getRepoStatus({ status: "local" })).toBe("local");
    expect(
      getRepoStatus({
        status: "local",
        lastNostrEventId: "ab".repeat(32),
        lastNostrEventCreatedAt: 1_700_000_000,
      })
    ).not.toBe("local");
  });

  it("stays on pushing until the state event is stored", () => {
    expect(
      getRepoStatus({
        status: "pushing",
        lastNostrEventId: "ab".repeat(32),
      })
    ).toBe("pushing");
  });

  it("leaves pushing once both events are stored, even without a relay echo", () => {
    expect(
      getRepoStatus({
        status: "pushing",
        lastNostrEventId: "ab".repeat(32),
        stateEventId: "cd".repeat(32),
        lastNostrEventCreatedAt: Math.floor(Date.now() / 1000),
      })
    ).toBe("live_soon");
    expect(repoStatusAfterRelayEcho(false, "cd".repeat(32), "pushing")).toBe(
      "live_soon"
    );
    expect(repoStatusAfterRelayEcho(false, undefined, "pushing")).toBe(
      "pushing"
    );
  });
});
