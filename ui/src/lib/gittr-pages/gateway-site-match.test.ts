import { describe, expect, it } from "vitest";

import { GITTR_OWNER_PUBKEY_HEX } from "../gittr-repo-links";
import { pubkeyHexToPubkeyB36 } from "../nsite/pubkey-base36";

import {
  extractNamedPagesDTagFromSiteUrl,
  gatewaySiteMatchesRepo,
  pickBestGatewaySiteForRepo,
} from "./gateway-site-match";

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

describe("pickBestGatewaySiteForRepo", () => {
  const b36 = pubkeyHexToPubkeyB36(GITTR_OWNER_PUBKEY_HEX);
  const oldHost = `https://${b36}gittr.pages.gittr.space/`;
  const namedHost = `https://${b36}gittr-docu.pages.gittr.space/`;

  it("reads the public name off the hostname", () => {
    expect(
      extractNamedPagesDTagFromSiteUrl(namedHost, GITTR_OWNER_PUBKEY_HEX)
    ).toBe("gittr-docu");
  });

  it("prefers the saved Pages name over a leftover truncated host", () => {
    const hit = pickBestGatewaySiteForRepo(
      [{ siteUrl: oldHost }, { siteUrl: namedHost }],
      namedHost,
      "gittr-docu",
      "pages.gittr.space",
      {
        extraDTags: ["gittr", "gittr-docu"],
        ownerPubkeyHex: GITTR_OWNER_PUBKEY_HEX,
      }
    );
    expect(hit?.siteUrl).toBe(namedHost);
    expect(hit?.matchedDTag).toBe("gittr-docu");
  });

  it("matches a freely chosen name that is not the repo slug", () => {
    const zine = `https://${b36}zine.pages.gittr.space/`;
    const hit = pickBestGatewaySiteForRepo(
      [{ siteUrl: zine }],
      `https://${b36}my-zine.pages.gittr.space/`,
      "zine",
      "pages.gittr.space",
      {
        extraDTags: ["my-zine", "zine"],
        ownerPubkeyHex: GITTR_OWNER_PUBKEY_HEX,
      }
    );
    expect(hit?.matchedDTag).toBe("zine");
    expect(hit?.siteUrl).toBe(zine);
  });
});
