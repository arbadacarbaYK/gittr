import { describe, expect, it } from "vitest";

import {
  announcePanelSummaryLabel,
  formatAppAnnounceErrorCopy,
  formatAppAnnounceSuccessCopy,
  missingForgeSourceAnnounceMessage,
} from "./announce-panel-copy";

describe("announcePanelSummaryLabel", () => {
  it("prefers the Releases-tab tag when set", () => {
    expect(
      announcePanelSummaryLabel({
        preferredTag: "v2.0.0",
        loadedReleaseTag: "v1.9.0",
        variant: "inline",
      })
    ).toBe("Announce v2.0.0");
  });

  it("keeps the sidebar summary as Nostr Apps even when a tag is loaded", () => {
    expect(
      announcePanelSummaryLabel({
        loadedReleaseTag: "v7.0.1",
        variant: "sidebar",
      })
    ).toBe("Nostr Apps");
  });

  it("does not put latest on the collapsed sidebar button", () => {
    expect(announcePanelSummaryLabel({ variant: "sidebar" })).toBe(
      "Nostr Apps"
    );
  });

  it("keeps the inline fallback before a tag is known", () => {
    expect(announcePanelSummaryLabel({ variant: "inline" })).toBe(
      "Announce on Nostr"
    );
  });
});

describe("app announce popup copy", () => {
  it("uses the same check / fail marks as repo push", () => {
    expect(
      formatAppAnnounceSuccessCopy({
        appId: "space.gittr.app",
        version: "1.2.0",
      })
    ).toBe("✅ Live as space.gittr.app@1.2.0. See Apps.");
    expect(formatAppAnnounceErrorCopy("No signing method")).toBe(
      "❌ No signing method"
    );
  });
});

describe("missingForgeSourceAnnounceMessage", () => {
  it("tells nostr-only owners why announce is blocked", () => {
    const msg = missingForgeSourceAnnounceMessage();
    expect(msg).toMatch(/forge Release tag/i);
    expect(msg).toMatch(/Nostr-only/i);
    expect(msg).not.toMatch(/tagless app listing without/i);
  });
});
