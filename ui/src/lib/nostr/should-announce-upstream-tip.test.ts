import { describe, expect, it } from "vitest";

import {
  LARGE_FORGE_TREE_BRIDGE_SYNC_THRESHOLD,
  shouldAnnounceUpstreamTip,
  shouldPreferBridgeSyncFromSource,
} from "./should-announce-upstream-tip";

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

describe("shouldPreferBridgeSyncFromSource (large forge / post-refetch)", () => {
  const github = "https://github.com/arbadacarbaYK/gittr";

  it("matches clean tip announce", () => {
    expect(
      shouldPreferBridgeSyncFromSource({
        sourceUrl: github,
        hasUnpushedEdits: false,
      })
    ).toBe(true);
  });

  it("prefers bridge after forge Refetch even if dirty flag stuck", () => {
    expect(
      shouldPreferBridgeSyncFromSource({
        sourceUrl: github,
        hasUnpushedEdits: true,
        postSourceRefetchPending: true,
        deletedPathCount: 0,
        fileCount: 825,
        filesWithLocalContent: 100,
      })
    ).toBe(true);
  });

  it("prefers bridge after Refetch+delete on sparse metadata tree", () => {
    expect(
      shouldPreferBridgeSyncFromSource({
        sourceUrl: github,
        hasUnpushedEdits: true,
        postSourceRefetchPending: false,
        deletedPathCount: 2,
        fileCount: 825,
        filesWithLocalContent: 0,
      })
    ).toBe(true);
  });

  it("keeps per-file push when delete accompanies real local bodies", () => {
    expect(
      shouldPreferBridgeSyncFromSource({
        sourceUrl: github,
        hasUnpushedEdits: true,
        deletedPathCount: 2,
        fileCount: 825,
        filesWithLocalContent: 120,
      })
    ).toBe(false);
  });

  it("recovers metadata-only false-dirty large trees", () => {
    expect(
      shouldPreferBridgeSyncFromSource({
        sourceUrl: github,
        hasUnpushedEdits: true,
        deletedPathCount: 0,
        fileCount: LARGE_FORGE_TREE_BRIDGE_SYNC_THRESHOLD,
        filesWithLocalContent: 0,
      })
    ).toBe(true);
  });

  it("keeps local tip when dirty with real local bodies (uploads)", () => {
    expect(
      shouldPreferBridgeSyncFromSource({
        sourceUrl: github,
        hasUnpushedEdits: true,
        deletedPathCount: 0,
        fileCount: 825,
        filesWithLocalContent: 5,
      })
    ).toBe(false);
  });
});
