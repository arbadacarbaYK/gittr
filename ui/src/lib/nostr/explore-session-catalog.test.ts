import { beforeEach, describe, expect, it } from "vitest";

import {
  hydrateExploreSessionCatalog,
  peekExploreSessionCatalog,
  resetExploreSessionCatalogForTests,
  writeExploreSessionCatalog,
} from "./explore-session-catalog";

describe("explore session catalog", () => {
  beforeEach(() => {
    resetExploreSessionCatalogForTests();
  });

  it("keeps the in-memory list when localStorage is a smaller quota slice", () => {
    writeExploreSessionCatalog(
      Array.from({ length: 80 }, (_, i) => ({
        entity: "npub1abc",
        repo: `repo-${i}`,
      }))
    );
    const fromLs = Array.from({ length: 32 }, (_, i) => ({
      entity: "npub1abc",
      repo: `repo-${i}`,
    }));
    const hydrated = hydrateExploreSessionCatalog(fromLs);
    expect(hydrated).toHaveLength(80);
    expect(peekExploreSessionCatalog()).toHaveLength(80);
  });

  it("adopts localStorage when there is no session list yet", () => {
    const fromLs = [{ entity: "npub1x", repo: "only" }];
    const hydrated = hydrateExploreSessionCatalog(fromLs);
    expect(hydrated).toEqual(fromLs);
    expect(peekExploreSessionCatalog()).toEqual(fromLs);
  });
});
