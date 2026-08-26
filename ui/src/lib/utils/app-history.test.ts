import { afterEach, describe, expect, it, vi } from "vitest";

import { pushAppUrl, replaceAppUrl } from "./app-history";

function mockWindow(pathname: string, state: object | null) {
  const replaceState = vi.fn();
  const pushState = vi.fn();
  vi.stubGlobal("window", {
    location: {
      pathname,
      origin: "https://gittr.space",
      href: `https://gittr.space${pathname}`,
      search: "",
      hash: "",
    },
    history: { state, replaceState, pushState },
  });
  return { replaceState, pushState };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("replaceAppUrl", () => {
  it("keeps __NA so Next skips ACTION_RESTORE", () => {
    const { replaceState } = mockWindow("/npub1a/repo", {
      __NA: true,
      __PRIVATE_NEXTJS_INTERNALS_TREE: ["home-tree"],
    });
    expect(replaceAppUrl("/npub1a/repo?branch=main")).toBe(true);
    expect(replaceState).toHaveBeenCalledTimes(1);
    const [state, , url] = replaceState.mock.calls[0];
    expect(state.__NA).toBe(true);
    expect(state.__PRIVATE_NEXTJS_INTERNALS_TREE).toEqual(["home-tree"]);
    expect(url).toBe("/npub1a/repo?branch=main");
  });

  it("does not rewrite the URL while the browser is still on /", () => {
    const { replaceState } = mockWindow("/", {
      __NA: true,
      __PRIVATE_NEXTJS_INTERNALS_TREE: ["home-tree"],
    });
    expect(replaceAppUrl("/npub1a/repo?branch=main")).toBe(false);
    expect(replaceState).not.toHaveBeenCalled();
  });

  it("does not pass null history state", () => {
    const { replaceState } = mockWindow("/npub1a/repo", null);
    expect(replaceAppUrl("/npub1a/repo#readme")).toBe(true);
    const [state] = replaceState.mock.calls[0];
    expect(state).not.toBeNull();
    expect(state.__NA).toBe(true);
  });
});

describe("pushAppUrl", () => {
  it("pushes same-path query with __NA", () => {
    const { pushState } = mockWindow("/npub1a/repo", { __NA: true });
    expect(pushAppUrl("/npub1a/repo?path=docs")).toBe(true);
    expect(pushState).toHaveBeenCalledTimes(1);
    const [state, , url] = pushState.mock.calls[0];
    expect(state.__NA).toBe(true);
    expect(url).toBe("/npub1a/repo?path=docs");
  });

  it("refuses a different pathname so callers can hard-nav", () => {
    const { pushState } = mockWindow("/npub1a/repo", { __NA: true });
    expect(pushAppUrl("/npub1b/other?path=README.md")).toBe(false);
    expect(pushState).not.toHaveBeenCalled();
  });
});
