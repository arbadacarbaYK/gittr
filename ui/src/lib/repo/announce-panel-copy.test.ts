import { describe, expect, it } from "vitest";

import {
  announcePanelSummaryLabel,
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

  it("uses the loaded latest tag so the sidebar is never tagless", () => {
    expect(
      announcePanelSummaryLabel({
        loadedReleaseTag: "v7.0.1",
        variant: "sidebar",
      })
    ).toBe("Announce v7.0.1");
  });

  it("says latest release on the sidebar before a tag is known", () => {
    expect(announcePanelSummaryLabel({ variant: "sidebar" })).toBe(
      "Nostr Apps · latest"
    );
  });

  it("keeps the inline fallback before a tag is known", () => {
    expect(announcePanelSummaryLabel({ variant: "inline" })).toBe(
      "Announce on Nostr"
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
