import { describe, expect, it } from "vitest";

import { shouldAnnounceUpstreamTip } from "./should-announce-upstream-tip";

describe("shouldAnnounceUpstreamTip", () => {
  it("prefers GitHub tip when clean", () => {
    expect(
      shouldAnnounceUpstreamTip({
        sourceUrl: "https://github.com/arbadacarbaYK/gittr-mcp",
        hasUnpushedEdits: false,
      })
    ).toBe(true);
  });

  it("uses local tip when user has unpushed edits", () => {
    expect(
      shouldAnnounceUpstreamTip({
        sourceUrl: "https://github.com/arbadacarbaYK/gittr-mcp",
        hasUnpushedEdits: true,
      })
    ).toBe(false);
  });

  it("does not treat missing source as upstream", () => {
    expect(
      shouldAnnounceUpstreamTip({
        sourceUrl: "",
        hasUnpushedEdits: false,
      })
    ).toBe(false);
  });
});
