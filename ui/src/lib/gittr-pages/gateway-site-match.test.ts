import { describe, expect, it } from "vitest";

import { gatewaySiteMatchesRepo } from "./gateway-site-match";

const npub = "npub18weq5jzw27gkhwcuf6gu57alcptjdvh78nlulgpkz8s7pnlxfnnspc00s9";
const named = "https://k3fakeb36zapslingers.pages.gittr.space/";
const root = `https://${npub}.pages.gittr.space/`;

describe("gatewaySiteMatchesRepo", () => {
  it("matches the named site URL", () => {
    expect(
      gatewaySiteMatchesRepo(named, named, "zapslingers", "pages.gittr.space")
    ).toBe(true);
  });

  it("matches the owner root Pages host", () => {
    expect(
      gatewaySiteMatchesRepo(root, named, "zapslingers", "pages.gittr.space", {
        rootUrl: root,
      })
    ).toBe(true);
  });

  it("matches an extra published d-tag when the default slug is stale", () => {
    expect(
      gatewaySiteMatchesRepo(
        "https://k3fakeb36gittr-snips.pages.gittr.space/",
        "https://k3fakeb36gittr-helper.pages.gittr.space/",
        "gittr-helper",
        "pages.gittr.space",
        { extraDTags: ["gittr-snips"] }
      )
    ).toBe(true);
  });

  it("does not match a different npub root", () => {
    expect(
      gatewaySiteMatchesRepo(
        "https://npub1other.pages.gittr.space/",
        named,
        "zapslingers",
        "pages.gittr.space",
        { rootUrl: root }
      )
    ).toBe(false);
  });
});
