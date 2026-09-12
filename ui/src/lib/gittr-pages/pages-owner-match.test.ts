import { describe, expect, it } from "vitest";

import { GITTR_OWNER_PUBKEY_HEX } from "../gittr-repo-links";
import { pubkeyHexToPubkeyB36 } from "../nsite/pubkey-base36";

import { pageBelongsToOwner } from "./pages-owner-match";

const other = "a".repeat(64);

describe("pageBelongsToOwner", () => {
  it("matches authorPubkeyHex", () => {
    expect(
      pageBelongsToOwner(
        {
          siteUrl: "https://example.pages.gittr.space/",
          authorPubkeyHex: GITTR_OWNER_PUBKEY_HEX,
        },
        GITTR_OWNER_PUBKEY_HEX
      )
    ).toBe(true);
  });

  it("matches named NIP-5A hosts (pubkeyB36 + d-tag), not only npub", () => {
    const b36 = pubkeyHexToPubkeyB36(GITTR_OWNER_PUBKEY_HEX);
    const url = `https://${b36}gittr-snips.pages.gittr.space/`;
    expect(pageBelongsToOwner({ siteUrl: url }, GITTR_OWNER_PUBKEY_HEX)).toBe(
      true
    );
    expect(pageBelongsToOwner({ siteUrl: url }, other)).toBe(false);
  });

  it("matches npub root hosts", () => {
    expect(
      pageBelongsToOwner(
        {
          siteUrl:
            "https://npub1n2ph08n4pqz4d3jk6n2p35p2f4ldhc5g5tu7dhftfpueajf4rpxqfjhzmc.pages.gittr.space/",
        },
        GITTR_OWNER_PUBKEY_HEX
      )
    ).toBe(true);
  });
});
