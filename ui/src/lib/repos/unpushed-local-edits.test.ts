import { describe, expect, it } from "vitest";

import { repoHasUnpushedLocalEdits } from "./unpushed-local-edits";

describe("repoHasUnpushedLocalEdits", () => {
  it("trusts the explicit dirty flag", () => {
    expect(repoHasUnpushedLocalEdits({ hasUnpushedEdits: true })).toBe(true);
    expect(repoHasUnpushedLocalEdits({ hasUnpushedEdits: false })).toBe(false);
  });

  it("recovers false-clean when lastModifiedAt is after the announce", () => {
    expect(
      repoHasUnpushedLocalEdits({
        hasUnpushedEdits: false,
        lastNostrEventId: "abc",
        lastNostrEventCreatedAt: 1_700_000_000,
        lastModifiedAt: 1_700_000_000 * 1000 + 60_000,
      })
    ).toBe(true);
  });

  it("does not treat older local mtime as unpushed", () => {
    expect(
      repoHasUnpushedLocalEdits({
        hasUnpushedEdits: false,
        lastNostrEventId: "abc",
        lastNostrEventCreatedAt: 1_700_000_100,
        lastModifiedAt: 1_700_000_000 * 1000,
      })
    ).toBe(false);
  });
});
