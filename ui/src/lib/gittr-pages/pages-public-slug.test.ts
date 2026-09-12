import { describe, expect, it } from "vitest";

import { GITTR_OWNER_PUBKEY_HEX } from "../gittr-repo-links";

import {
  evaluatePagesSiteSlugInput,
  extraPagesDTagsForRepo,
  isReservedPagesSlug,
  resolveRepoPagesDTag,
} from "./pages-public-slug";

const owner = "a".repeat(64);

describe("resolveRepoPagesDTag", () => {
  it("uses a custom Pages name when set", () => {
    expect(
      resolveRepoPagesDTag("conference-loop", { pagesSiteSlug: "conf-loop" })
    ).toBe("conf-loop");
  });

  it("falls back to the truncated repo slug", () => {
    expect(resolveRepoPagesDTag("conference-loop", {})).toBe("conference-lo");
  });

  it("lets the gittr repo keep d=gittr when the owner is unknown", () => {
    expect(resolveRepoPagesDTag("gittr", {})).toBe("gittr");
  });

  it("uses published Pages names for platform repos", () => {
    expect(
      resolveRepoPagesDTag("gittr", { ownerPubkey: GITTR_OWNER_PUBKEY_HEX })
    ).toBe("gittr-docu");
    expect(
      resolveRepoPagesDTag("gittr-helper-tools", {
        ownerPubkey: GITTR_OWNER_PUBKEY_HEX,
      })
    ).toBe("gittr-snips");
  });
});

describe("evaluatePagesSiteSlugInput", () => {
  it("stores the normalized 13-char d-tag, not the raw typing", () => {
    const ev = evaluatePagesSiteSlugInput({
      raw: "Conference Loop Extra",
      decodedRepoSlug: "conference-loop",
      ownerPubkeyHex: owner,
      repos: [],
      entity: "npub1test",
    });
    expect(ev.ok).toBe(true);
    if (ev.ok) {
      expect(ev.stored).toBe("conference-lo");
      expect(ev.dTag).toBe("conference-lo");
    }
  });

  it("clears back to the repo-slug d-tag", () => {
    const ev = evaluatePagesSiteSlugInput({
      raw: "   ",
      decodedRepoSlug: "conference-loop",
      ownerPubkeyHex: owner,
      repos: [],
      entity: "npub1test",
    });
    expect(ev.ok).toBe(true);
    if (ev.ok) {
      expect(ev.stored).toBeUndefined();
      expect(ev.dTag).toBe("conference-lo");
    }
  });
});

describe("reserved Pages slugs", () => {
  it("blocks other people from gittr and gittr-prefix names", () => {
    expect(isReservedPagesSlug("gittr", owner)).toBe(true);
    expect(isReservedPagesSlug("gittr-helper", owner)).toBe(true);
    const ev = evaluatePagesSiteSlugInput({
      raw: "gittr-helper-tools",
      decodedRepoSlug: "gittr-helper-tools",
      ownerPubkeyHex: owner,
      repos: [],
      entity: "npub1test",
    });
    expect(ev.ok).toBe(false);
  });

  it("lets the platform npub use gittr / gittr-helper as a custom Pages name", () => {
    expect(isReservedPagesSlug("gittr", GITTR_OWNER_PUBKEY_HEX)).toBe(false);
    const ev = evaluatePagesSiteSlugInput({
      raw: "gittr-helper-tools",
      decodedRepoSlug: "gittr-helper-tools",
      ownerPubkeyHex: GITTR_OWNER_PUBKEY_HEX,
      repos: [],
      entity: "npub1n2ph08n4pqz4d3jk6n2p35p2f4ldhc5g5tu7dhftfpueajf4rpxqfjhzmc",
    });
    expect(ev.ok).toBe(true);
    if (ev.ok) {
      expect(ev.stored).toBe("gittr-helper");
    }
    expect(
      extraPagesDTagsForRepo("gittr-helper-tools", GITTR_OWNER_PUBKEY_HEX)
    ).toEqual(expect.arrayContaining(["gittr-snips", "gittr-helper"]));
    expect(
      extraPagesDTagsForRepo("my-zine", "a".repeat(64), "gittr docu")
    ).toEqual(expect.arrayContaining(["gittr-docu", "my-zine"]));
    expect(
      extraPagesDTagsForRepo("cool-client", "b".repeat(64), "zine")
    ).toEqual(expect.arrayContaining(["zine", "cool-client"]));
  });
});
