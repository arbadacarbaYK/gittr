import { describe, expect, it } from "vitest";

import { extractGithubUrlFromEventTags } from "./extract-forge-url-from-event-tags";

describe("extractGithubUrlFromEventTags", () => {
  it("prefers source over GRASP-only clone tags", () => {
    const url = extractGithubUrlFromEventTags([
      [
        "clone",
        "https://git.gittr.space/npub1abc/fable-showcase.git",
        "https://relay.ngit.dev/npub1abc/fable-showcase.git",
      ],
      ["source", "https://github.com/elder-plinius/FABLE-SHOWCASE"],
    ]);
    expect(url).toBe("https://github.com/elder-plinius/FABLE-SHOWCASE");
  });

  it("falls back to forkedFrom when source is missing", () => {
    const url = extractGithubUrlFromEventTags([
      ["clone", "https://git.gittr.space/npub1abc/repo.git"],
      ["forkedFrom", "https://gitlab.com/org/repo"],
    ]);
    expect(url).toBe("https://gitlab.com/org/repo");
  });

  it("finds GitHub later on a multi-value clone row after GRASP", () => {
    const url = extractGithubUrlFromEventTags([
      [
        "clone",
        "https://git.gittr.space/npub1abc/repo.git",
        "https://github.com/org/repo.git",
      ],
    ]);
    expect(url).toBe("https://github.com/org/repo.git");
  });

  it("returns empty when only GRASP clones exist", () => {
    const url = extractGithubUrlFromEventTags([
      [
        "clone",
        "https://git.gittr.space/npub1abc/fable-showcase.git",
        "https://relay.ngit.dev/npub1abc/fable-showcase.git",
      ],
      ["web", "https://gittr.space/npub1abc/fable-showcase"],
    ]);
    expect(url).toBe("");
  });

  it("does not treat /grasp/npub/repo home remotes as forge upstreams", () => {
    const url = extractGithubUrlFromEventTags([
      [
        "clone",
        "https://laantungir.net/grasp/npub1f9z5ks7sa50fg7nqwc7l0eh5yxf9vwmeu86wa90l3fd0tantd0tskzpjx8/minibits_wallet.git",
        "https://relay.ngit.dev/npub1f9z5ks7sa50fg7nqwc7l0eh5yxf9vwmeu86wa90l3fd0tantd0tskzpjx8/minibits_wallet.git",
      ],
      ["web", "http://127.0.0.1:3000/git/laantungir/minibits_wallet"],
    ]);
    expect(url).toBe("");
  });
});
