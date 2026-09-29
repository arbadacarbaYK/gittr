import { afterEach, describe, expect, it, vi } from "vitest";

import {
  readProfileOpenHandoff,
  stashProfileOpenHandoff,
} from "./profile-open-handoff";

function memoryStorage() {
  const bag = new Map<string, string>();
  return {
    getItem: (k: string) => (bag.has(k) ? bag.get(k)! : null),
    setItem: (k: string, v: string) => {
      bag.set(k, v);
    },
    removeItem: (k: string) => {
      bag.delete(k);
    },
  };
}

describe("profile open handoff", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the clone URLs stashed for this repo", () => {
    vi.stubGlobal("sessionStorage", memoryStorage());
    vi.stubGlobal("window", {});
    stashProfileOpenHandoff({
      entity: "npub14rg4vrt2v374q95ezeeydu3hkdhmzglcj950mggacap4x0lv0gyq04wun7",
      repo: "html1",
      clone: [
        "https://relay.ngit.dev/npub14rg4vrt2v374q95ezeeydu3hkdhmzglcj950mggacap4x0lv0gyq04wun7/html1.git",
      ],
    });
    const got = readProfileOpenHandoff(
      "npub14rg4vrt2v374q95ezeeydu3hkdhmzglcj950mggacap4x0lv0gyq04wun7",
      "html1"
    );
    expect(got?.clone).toHaveLength(1);
    expect(got?.clone[0]).toContain("relay.ngit.dev");
  });

  it("ignores a handoff for a different repo", () => {
    vi.stubGlobal("sessionStorage", memoryStorage());
    vi.stubGlobal("window", {});
    stashProfileOpenHandoff({
      entity: "npub1abc",
      repo: "html1",
      clone: ["https://relay.ngit.dev/npub1abc/html1.git"],
    });
    expect(readProfileOpenHandoff("npub1abc", "other")).toBeNull();
  });
});
