import { describe, expect, it } from "vitest";

import { dedupeGatewaySitesForDirectory } from "./dedupe-gateway-sites";
import type { GatewayStatusSiteRow } from "./parse-gateway-status-html";

function row(
  partial: Partial<GatewayStatusSiteRow> & { siteUrl: string; title: string }
): GatewayStatusSiteRow {
  return {
    authorDisplay: "",
    pathCount: 1,
    pathsStatusUrl: `${partial.siteUrl}/status`,
    snapshots: 0,
    hits: 0,
    updatedLabel: "",
    hasIndexHtml: true,
    ...partial,
  };
}

describe("dedupeGatewaySitesForDirectory", () => {
  it("merges portal + npub-style titles for the same author", () => {
    const pk = "a".repeat(64);
    const out = dedupeGatewaySitesForDirectory([
      row({
        title: "portal",
        siteUrl: "https://npub1abc.pages.gittr.space/",
        authorPubkeyHex: pk,
        description: "Same project",
      }),
      row({
        title: "npub1abc…",
        siteUrl: "https://mysite.pages.gittr.space/",
        authorPubkeyHex: pk,
        description: "Same project",
        pathCount: 4,
      }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]?.pathCount).toBe(4);
  });

  it("does not n²-merge unrelated authors", () => {
    const sites = Array.from({ length: 80 }, (_, i) =>
      row({
        title: `Site ${i}`,
        siteUrl: `https://s${i}.pages.gittr.space/`,
        authorPubkeyHex: i.toString(16).padStart(64, "0"),
      })
    );
    expect(dedupeGatewaySitesForDirectory(sites)).toHaveLength(80);
  });
});
