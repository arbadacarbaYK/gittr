import { describe, expect, it } from "vitest";

import { formatPushRepoSuccessAlert } from "./push-repo-success-alert";

describe("formatPushRepoSuccessAlert", () => {
  it("does not look like a clean success when paths were excluded", () => {
    const msg = formatPushRepoSuccessAlert({
      eventId: "aaaaaaaaaaaaaaaa",
      stateEventId: "bbbbbbbbbbbbbbbb",
      confirmed: true,
      excludedFromPush: ["dist/frame-00.png", "dist/interval-16x9.mp4"],
    });
    expect(msg.startsWith("✅ Repository pushed to Nostr!")).toBe(false);
    expect(msg).toContain("some files were skipped");
    expect(msg).toContain("dist/frame-00.png");
  });

  it("tells you not to push again when relays have not echoed yet", () => {
    const msg = formatPushRepoSuccessAlert({
      eventId: "aaaaaaaaaaaaaaaa",
      stateEventId: "bbbbbbbbbbbbbbbb",
      confirmed: false,
    });
    expect(msg).toContain("already on Nostr");
    expect(msg).toContain("do not need to push again");
    expect(msg).not.toContain("awaiting confirmation");
    expect(msg).not.toContain("try pushing again");
  });

  it("keeps the clean success copy when every path had bytes", () => {
    const msg = formatPushRepoSuccessAlert({
      eventId: "aaaaaaaaaaaaaaaa",
      stateEventId: "bbbbbbbbbbbbbbbb",
      confirmed: true,
    });
    expect(msg.startsWith("✅ Repository pushed to Nostr!")).toBe(true);
    expect(msg).not.toContain("skipped");
  });
});
