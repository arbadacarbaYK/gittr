import { afterEach, describe, expect, it, vi } from "vitest";

import {
  exploreSearchAwaitingCatalog,
  holdExploreAddress,
  parseExploreSearch,
  publishExploreSearch,
  resetExploreAddressWatchForTests,
} from "./explore-search";

describe("parseExploreSearch", () => {
  it("reads q and user, and treats a bare explore URL as no filter", () => {
    expect(parseExploreSearch("")).toEqual({ q: "", user: null });
    expect(parseExploreSearch("?q=gittr")).toEqual({ q: "gittr", user: null });
    expect(parseExploreSearch("?user=npub1example")).toEqual({
      q: "",
      user: "npub1example",
    });
    expect(parseExploreSearch("?q=%20shakespeare%20")).toEqual({
      q: "shakespeare",
      user: null,
    });
  });
});

describe("publishExploreSearch", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("tells an already-open Explore page the new filter", () => {
    const listeners = new Map<string, Array<(event: Event) => void>>();
    vi.stubGlobal("window", {
      addEventListener(type: string, fn: (event: Event) => void) {
        const list = listeners.get(type) || [];
        list.push(fn);
        listeners.set(type, list);
      },
      removeEventListener(type: string, fn: (event: Event) => void) {
        listeners.set(
          type,
          (listeners.get(type) || []).filter((item) => item !== fn)
        );
      },
      dispatchEvent(event: Event) {
        for (const fn of listeners.get(event.type) || []) fn(event);
        return true;
      },
    });
    const seen: Array<{ q: string; user: string | null }> = [];
    const onSearch = (event: Event) => {
      seen.push((event as CustomEvent).detail);
    };
    window.addEventListener("gittr:explore-search", onSearch);
    publishExploreSearch({ q: " gittr ", user: "" });
    publishExploreSearch({ q: "", user: null });
    window.removeEventListener("gittr:explore-search", onSearch);
    expect(seen).toEqual([
      { q: "gittr", user: null },
      { q: "", user: null },
    ]);
  });
});

describe("holdExploreAddress", () => {
  afterEach(() => {
    resetExploreAddressWatchForTests();
    vi.unstubAllGlobals();
  });

  it("writes the explore query into the address bar immediately", () => {
    let href = "http://localhost/explore";
    const replaceState = vi.fn(
      (_data: unknown, _title: string, url?: string) => {
        if (url) href = `http://localhost${url}`;
      }
    );
    vi.stubGlobal("window", {
      location: {
        get pathname() {
          return new URL(href).pathname;
        },
        get search() {
          return new URL(href).search;
        },
      },
      history: {
        state: { __NA: true },
        replaceState,
      },
      setInterval: () => 1,
      clearInterval: () => undefined,
    });
    holdExploreAddress("/explore?q=gittr");
    expect(replaceState).toHaveBeenCalledWith(
      { __NA: true },
      "",
      "/explore?q=gittr"
    );
  });
});

describe("exploreSearchAwaitingCatalog", () => {
  it("waits for seed and relays before saying a search found nothing", () => {
    expect(
      exploreSearchAwaitingCatalog({
        searchActive: true,
        matchCount: 0,
        loadingRepos: false,
        syncing: false,
        seedPassDone: false,
      })
    ).toBe(true);
    expect(
      exploreSearchAwaitingCatalog({
        searchActive: true,
        matchCount: 0,
        loadingRepos: false,
        syncing: true,
        seedPassDone: true,
      })
    ).toBe(true);
    expect(
      exploreSearchAwaitingCatalog({
        searchActive: true,
        matchCount: 2,
        loadingRepos: true,
        syncing: true,
        seedPassDone: false,
      })
    ).toBe(false);
    expect(
      exploreSearchAwaitingCatalog({
        searchActive: true,
        matchCount: 0,
        loadingRepos: false,
        syncing: false,
        seedPassDone: true,
      })
    ).toBe(false);
    expect(
      exploreSearchAwaitingCatalog({
        searchActive: false,
        matchCount: 0,
        loadingRepos: false,
        syncing: false,
        seedPassDone: false,
      })
    ).toBe(false);
  });
});
