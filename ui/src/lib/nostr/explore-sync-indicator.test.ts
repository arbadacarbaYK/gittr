import { describe, expect, it } from "vitest";

import { shouldHideExploreSyncForCatalog } from "./explore-sync-indicator";

describe("shouldHideExploreSyncForCatalog", () => {
  it("does not hide for localStorage / SEO seed rows", () => {
    const locals = Array.from({ length: 80 }, (_, i) => ({
      fromSeoSnapshot: true,
      syncedFromNostr: false,
    }));
    expect(shouldHideExploreSyncForCatalog(locals)).toBe(false);
  });

  it("hides once 40 live Nostr rows are in", () => {
    const live = Array.from({ length: 40 }, () => ({
      syncedFromNostr: true,
    }));
    expect(shouldHideExploreSyncForCatalog(live)).toBe(true);
  });
});
