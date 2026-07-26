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
    const d = sidebarAboutText(
      '"English quote"\n---\nCzech quote',
      "doxa"
    );
    expect(d).toBe('"English quote"\n\nCzech quote');
  });
});
