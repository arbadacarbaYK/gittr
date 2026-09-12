import { describe, expect, it } from "vitest";

import {
  GITTR_OWNER_PUBKEY_HEX,
  gittrOwnerPagesNamedUrl,
} from "../gittr-repo-links";

import {
  pagesSiteMatchesQuery,
  pagesSiteSearchHaystack,
  queryNeedsKind0Names,
} from "./pages-search";
import type { GatewayStatusSiteRow } from "./parse-gateway-status-html";

const gitnostr: GatewayStatusSiteRow = {
  title: "gitnostr",
  siteUrl: gittrOwnerPagesNamedUrl("gitnostr"),
  authorDisplay:
    "npub1n2ph08n4pqz4d3jk6n2p35p2f4ldhc5g5tu7dhftfpueajf4rpxqfjhzmc",
  authorPubkeyHex: GITTR_OWNER_PUBKEY_HEX,
  description: "Git bridge to Nostr",
  pathCount: 15,
  pathsStatusUrl: "https://pages.gittr.space/status",
  snapshots: 1,
  hits: 16,
  updatedLabel: "1h",
  siteKind: "named",
};

describe("queryNeedsKind0Names", () => {
  it("is true for a human handle, not a host or npub", () => {
    expect(queryNeedsKind0Names("arbadacarba")).toBe(true);
    expect(queryNeedsKind0Names("npub1abc")).toBe(false);
    expect(queryNeedsKind0Names("gitnostr.pages.gittr.space")).toBe(false);
    expect(queryNeedsKind0Names("https://example.com")).toBe(false);
  });
});

describe("pagesSiteSearchHaystack", () => {
  it("matches the named d-tag even when authorDisplay is an npub", () => {
    expect(pagesSiteMatchesQuery(gitnostr, "gitnostr")).toBe(true);
    expect(pagesSiteSearchHaystack(gitnostr)).toContain("gitnostr");
  });

  it("matches a kind-0 display name that the card shows", () => {
    expect(pagesSiteMatchesQuery(gitnostr, "arbadacarba")).toBe(false);
    expect(
      pagesSiteMatchesQuery(gitnostr, "arbadacarba", {
        authorMeta: { display_name: "arbadacarba" },
      })
    ).toBe(true);
  });
});
