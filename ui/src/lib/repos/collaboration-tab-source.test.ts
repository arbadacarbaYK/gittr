import { describe, expect, it } from "vitest";

import { collaborationTabMode } from "./collaboration-tab-source";

describe("collaborationTabMode", () => {
  it("treats GitHub source as forge read-only", () => {
    expect(
      collaborationTabMode({
        sourceUrl: "https://github.com/arbadacarbaYK/gittr",
      })
    ).toBe("forge-readonly");
  });

  it("treats Codeberg/Gitea source as forge read-only", () => {
    expect(
      collaborationTabMode({
        sourceUrl: "https://codeberg.org/example/repo",
      })
    ).toBe("forge-readonly");
  });

  it("treats GRASP/npub clones without a forge source as nostr-local", () => {
    expect(
      collaborationTabMode({
        sourceUrl: "",
        clone: [
          "https://git.gittr.space/npub1n2ph08n4pqz4d3jk6n2p35p2f4ldhc5g5tu7dhftfpueajf4rpxqfjhzmc/gittr.git",
        ],
      })
    ).toBe("nostr-local");
  });
});
