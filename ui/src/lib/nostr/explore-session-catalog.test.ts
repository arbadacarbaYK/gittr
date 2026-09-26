import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  dropExploreSessionCatalogMemoryForTests,
  flushExploreSessionCatalogWrites,
  hydrateExploreSessionCatalog,
  peekExploreSessionCatalog,
  resetExploreSessionCatalogForTests,
  writeExploreSessionCatalog,
} from "./explore-session-catalog";

describe("explore session catalog", () => {
  const store = new Map<string, string>();

  beforeEach(() => {
    store.clear();
    vi.stubGlobal("sessionStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
    });
    resetExploreSessionCatalogForTests();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
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

  it("rehydrates from sessionStorage after memory is dropped (hard search nav)", () => {
    writeExploreSessionCatalog(
      Array.from({ length: 50 }, (_, i) => ({
        entity: "npub1abc",
        repo: `live-${i}`,
      }))
    );
    flushExploreSessionCatalogWrites();
    dropExploreSessionCatalogMemoryForTests();
    const fromLs = Array.from({ length: 8 }, (_, i) => ({
      entity: "npub1abc",
      repo: `live-${i}`,
    }));
    expect(hydrateExploreSessionCatalog(fromLs)).toHaveLength(50);
  });

  it("stores a short snapshot when the full catalog does not fit", () => {
    const quota = new Map<string, string>();
    let failedFull = false;
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => quota.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (!failedFull && value.length > 500) {
          failedFull = true;
          const error = new Error("quota");
          error.name = "QuotaExceededError";
          throw error;
        }
        quota.set(key, value);
      },
      removeItem: (key: string) => {
        quota.delete(key);
      },
    });
    resetExploreSessionCatalogForTests();
    writeExploreSessionCatalog(
      Array.from({ length: 30 }, (_, i) => ({
        entity: "npub1abc",
        repo: `fat-${i}`,
        description: "d".repeat(80),
      }))
    );
    flushExploreSessionCatalogWrites();
    const saved = JSON.parse(
      quota.get("gittr_explore_session_catalog") || "[]"
    );
    expect(saved.length).toBeGreaterThan(0);
    expect(saved.length).toBeLessThanOrEqual(30);
    expect(peekExploreSessionCatalog()).toHaveLength(30);
  });
});
