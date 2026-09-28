import { describe, expect, it } from "vitest";

import {
  shouldHideExploreSyncForCatalog,
  shouldKeepExploreSyncIndicator,
} from "./explore-sync-indicator";

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

describe("shouldKeepExploreSyncIndicator", () => {
  it("stays on for a search even when the browser already has a catalog", () => {
    expect(
      shouldKeepExploreSyncIndicator({
        alreadyHasCatalog: true,
        hasSearch: true,
      })
    ).toBe(true);
    expect(
      shouldKeepExploreSyncIndicator({
        alreadyHasCatalog: true,
        hasSearch: false,
      })
    ).toBe(false);
    expect(
      shouldKeepExploreSyncIndicator({
        alreadyHasCatalog: false,
        hasSearch: false,
      })
    ).toBe(true);
  });
});
