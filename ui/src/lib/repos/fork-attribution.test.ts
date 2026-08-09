import { describe, expect, it } from "vitest";

import {
  isDisplayableForkAttribution,
  sanitizeForkedFromField,
} from "./fork-attribution";

describe("isDisplayableForkAttribution", () => {
  it("rejects own GRASP shakespeare clone URLs", () => {
    expect(
      isDisplayableForkAttribution(
        "https://git.shakespeare.diy/npub1n2ph08n4pqz4d3jk6n2p35p2f4ldhc5g5tu7dhftfpueajf4rpxqfjhzmc/local-agent"
      )
    ).toBe(false);
  });

  it("rejects gittr / ngit grasp paths", () => {
    expect(
      isDisplayableForkAttribution(
        "https://git.gittr.space/npub1abc/repo.git"
      )
    ).toBe(false);
  });

  it("accepts real forge upstreams", () => {
    expect(
      isDisplayableForkAttribution("https://github.com/other/project")
    ).toBe(true);
    expect(
      isDisplayableForkAttribution("https://codeberg.org/org/repo")
    ).toBe(true);
  });
});

describe("sanitizeForkedFromField", () => {
  it("clears grasp URLs and keeps github", () => {
    expect(
      sanitizeForkedFromField(
        "https://git.shakespeare.diy/npub1aaa/local-agent.git"
      )
    ).toBeUndefined();
    expect(sanitizeForkedFromField("https://github.com/a/b.git")).toBe(
      "https://github.com/a/b"
    );
  });
});
