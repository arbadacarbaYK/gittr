import { describe, expect, it } from "vitest";

import { GITTR_BLOSSOM_ORIGIN } from "../gittr-repo-links";

import {
  NGIT_BLOSSOM_ORIGINS,
  allowedNip82BlossomAssetUrl,
  blossomBlobUrl,
  isGittrBlossomHostname,
  resolvePinnedBlossomUrl,
} from "./nip82-blossom-hosts";

const SHA = "a".repeat(64);

describe("nip82 blossom pin hosts", () => {
  it("allowlists public Apps pin hosts", () => {
    expect([...NGIT_BLOSSOM_ORIGINS]).toEqual([
      "https://blossom.primal.net",
      "https://blossom.ditto.pub",
      "https://haven.danconwaydev.com",
    ]);
    for (const origin of NGIT_BLOSSOM_ORIGINS) {
      const host = new URL(origin).hostname;
      expect(isGittrBlossomHostname(host)).toBe(false);
    }
  });

  it("rejects gittr Pages Blossom", () => {
    expect(isGittrBlossomHostname("blossom.gittr.space")).toBe(true);
    expect(isGittrBlossomHostname(new URL(GITTR_BLOSSOM_ORIGIN).hostname)).toBe(
      true
    );
    expect(
      allowedNip82BlossomAssetUrl(`${GITTR_BLOSSOM_ORIGIN}/${SHA}`)
    ).toBeNull();
    expect(blossomBlobUrl(GITTR_BLOSSOM_ORIGIN, SHA)).toBeNull();
  });

  it("accepts a primal blob URL and ignores query strings", () => {
    expect(
      allowedNip82BlossomAssetUrl(`https://blossom.primal.net/${SHA}`)
    ).toBe(`https://blossom.primal.net/${SHA}`);
    expect(
      allowedNip82BlossomAssetUrl(`https://blossom.ditto.pub/${SHA}.apk`)
    ).toBe(`https://blossom.ditto.pub/${SHA}.apk`);
    expect(
      allowedNip82BlossomAssetUrl(`https://blossom.primal.net/${SHA}?x=1`)
    ).toBeNull();
    expect(
      allowedNip82BlossomAssetUrl(`http://blossom.primal.net/${SHA}`)
    ).toBeNull();
  });

  it("falls back to the PUT origin when the descriptor is a foreign CDN", () => {
    expect(
      resolvePinnedBlossomUrl({
        putOrigin: "https://blossom.primal.net",
        sha256Hex: SHA,
        descriptorUrl: "https://cdn.someone-else.example/blob",
      })
    ).toBe(`https://blossom.primal.net/${SHA}`);
  });
});
