import { nip19 } from "nostr-tools";
import { describe, expect, it } from "vitest";

import {
  GITTR_OWNER_NPUB,
  GITTR_OWNER_PUBKEY_HEX,
  gittrOwnerPagesNamedUrl,
} from "../gittr-repo-links";
import { pubkeyHexToPubkeyB36 } from "../nsite/pubkey-base36";

import { gittrRepoPathForPagesSite } from "./pages-repo-path";

describe("gittrRepoPathForPagesSite", () => {
  it("maps platform Pages names that are not the repo slug", () => {
    expect(
      gittrRepoPathForPagesSite({
        siteUrl: gittrOwnerPagesNamedUrl("gittr-docu"),
        title: "gittr",
        authorPubkeyHex: GITTR_OWNER_PUBKEY_HEX,
      })
    ).toBe(`/${GITTR_OWNER_NPUB}/gittr`);
    expect(
      gittrRepoPathForPagesSite({
        siteUrl: gittrOwnerPagesNamedUrl("gittr-snips"),
        title: "gittr-helper-tools",
        authorPubkeyHex: GITTR_OWNER_PUBKEY_HEX,
      })
    ).toBe(`/${GITTR_OWNER_NPUB}/gittr-helper-tools`);
  });

  it("uses the d-tag when it already is the repo name", () => {
    expect(
      gittrRepoPathForPagesSite({
        siteUrl: gittrOwnerPagesNamedUrl("gitnostr"),
        title: "gitnostr",
        authorPubkeyHex: GITTR_OWNER_PUBKEY_HEX,
      })
    ).toBe(`/${GITTR_OWNER_NPUB}/gitnostr`);
  });

  it("uses a repo-shaped title when the Pages name was truncated", () => {
    const other = "11".repeat(32);
    const b36 = pubkeyHexToPubkeyB36(other);
    expect(
      gittrRepoPathForPagesSite({
        siteUrl: `https://${b36}bitcoin-mee.pages.gittr.space/`,
        title: "bitcoin_meetup_calendar",
        authorPubkeyHex: other,
      })
    ).toBe(`/${nip19.npubEncode(other)}/bitcoin_meetup_calendar`);
    expect(
      gittrRepoPathForPagesSite({
        siteUrl: gittrOwnerPagesNamedUrl("bitcoin-mee"),
        title: "bitcoin_meetup_calendar",
        authorPubkeyHex: GITTR_OWNER_PUBKEY_HEX,
      })
    ).toBe(`/${GITTR_OWNER_NPUB}/bitcoin_meetup_calendar`);
  });

  it("does not invent a repo for an npub root site", () => {
    expect(
      gittrRepoPathForPagesSite({
        siteUrl: `https://${GITTR_OWNER_NPUB}.pages.gittr.space/`,
        title: "homepage",
        authorPubkeyHex: GITTR_OWNER_PUBKEY_HEX,
      })
    ).toBe(null);
  });

  it("does not treat a sentence title as a repo slug", () => {
    expect(
      gittrRepoPathForPagesSite({
        siteUrl: gittrOwnerPagesNamedUrl("my-zine"),
        title: "Git on Nostr. Open a box.",
        authorPubkeyHex: GITTR_OWNER_PUBKEY_HEX,
      })
    ).toBe(`/${GITTR_OWNER_NPUB}/my-zine`);
  });
});
