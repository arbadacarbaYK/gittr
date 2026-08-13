import { describe, expect, it } from "vitest";

import {
  sanitizeDescriptionForMarkdown,
  sidebarAboutText,
} from "./repo-about-text";

describe("sanitizeDescriptionForMarkdown", () => {
  it("does not turn dashed language separators into setext headings", () => {
    const raw = [
      '"The basic idea remains the same: a radical Local-First approach."',
      "---------------------------------------------------------------------------------------------------",
      "„Základní myšlenka zůstává nekompromisní.“",
    ].join("\n");
    const out = sanitizeDescriptionForMarkdown(raw);
    expect(out).toBe(
      [
        '"The basic idea remains the same: a radical Local-First approach."',
        "",
        "„Základní myšlenka zůstává nekompromisní.“",
      ].join("\n")
    );
    expect(out).not.toMatch(/^-{3,}$/m);
  });

  it("soft-escapes ATX headings", () => {
    expect(sanitizeDescriptionForMarkdown("# Big title\nMore")).toContain(
      "\\# Big title"
    );
  });
});

describe("sidebarAboutText", () => {
  it("sanitizes doxa-style descriptions", () => {
    const d = sidebarAboutText('"English quote"\n---\nCzech quote', "doxa");
    expect(d).toBe('"English quote"\n\nCzech quote');
  });
});

describe("preferOwnedDescription", () => {
  it("prefers non-placeholder Nostr description over local placeholder", async () => {
    const { preferOwnedDescription } = await import("./repo-about-text");
    expect(
      preferOwnedDescription(
        "Repository: chatty",
        "Local Bitcoin tutor",
        "chatty"
      )
    ).toBe("Local Bitcoin tutor");
  });

  it("keeps owner local description when event is placeholder", async () => {
    const { preferOwnedDescription } = await import("./repo-about-text");
    expect(
      preferOwnedDescription("My custom about", "Repository: chatty", "chatty")
    ).toBe("My custom about");
  });

  it("prefers newer real event description over older local real description", async () => {
    const { preferOwnedDescription } = await import("./repo-about-text");
    // Latest NIP-34 wins when both are real (owner republished About)
    expect(
      preferOwnedDescription("Old about", "New about from settings", "chatty")
    ).toBe("New about from settings");
  });
});
