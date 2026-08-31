import { describe, expect, it } from "vitest";

import {
  evaluatePagesSiteSlugInput,
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
