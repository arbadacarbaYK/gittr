import { describe, expect, it } from "vitest";

import { shouldAnnounceUpstreamTip } from "./should-announce-upstream-tip";

/**
 * Push tip fidelity: refetch fills local overrides as a *cache*, not as dirty.
 * Only `hasUnpushedEdits` may invent a rewritten bridge tip (--allow-empty).
 */
describe("shouldAnnounceUpstreamTip (push tip fidelity)", () => {
  const github = "https://github.com/arbadacarbaYK/gittr-mcp";

  it("prefers forge tip when clean even if overrides cache is full", () => {
    // Overrides are intentionally NOT an input — documenting that Push must not
    // treat refetch cache as dirty. Gate stays true.
    expect(
      shouldAnnounceUpstreamTip({
        sourceUrl: github,
        hasUnpushedEdits: false,
      })
    ).toBe(true);
  });

  it("uses local tip only when hasUnpushedEdits is true", () => {
    expect(
      shouldAnnounceUpstreamTip({
        sourceUrl: github,
        hasUnpushedEdits: true,
      })
    ).toBe(false);
  });

  it("requires a cloneable forge source", () => {
    expect(
      shouldAnnounceUpstreamTip({
        sourceUrl: "",
        hasUnpushedEdits: false,
      })
    ).toBe(false);
    expect(
      shouldAnnounceUpstreamTip({
        sourceUrl: "https://git.gittr.space/npub1abc/repo.git",
        hasUnpushedEdits: false,
      })
    ).toBe(false);
  });
});
