import { describe, expect, it } from "vitest";

import {
  DEFAULT_GITTR_PAGES_BLOSSOM_ORIGIN,
  blossomAuthServerMatchesOrigin,
  gittrPagesBlossomOrigin,
  gittrPagesBlossomServerTag,
  normalizeBlossomServerTagHost,
} from "./gittr-pages-blossom-origin";

describe("gittr Pages Blossom origin", () => {
  it("defaults Pages uploads to blossom.gittr.space when env is unset", () => {
    const prevPages = process.env.NEXT_PUBLIC_GITTR_PAGES_BLOSSOM_URL;
    const prevShared = process.env.NEXT_PUBLIC_BLOSSOM_URL;
    delete process.env.NEXT_PUBLIC_GITTR_PAGES_BLOSSOM_URL;
    delete process.env.NEXT_PUBLIC_BLOSSOM_URL;
    try {
      expect(gittrPagesBlossomOrigin()).toBe(
        DEFAULT_GITTR_PAGES_BLOSSOM_ORIGIN
      );
      expect(gittrPagesBlossomServerTag()).toEqual([
        "server",
        "blossom.gittr.space",
      ]);
    } finally {
      if (prevPages !== undefined) {
        process.env.NEXT_PUBLIC_GITTR_PAGES_BLOSSOM_URL = prevPages;
      }
      if (prevShared !== undefined) {
        process.env.NEXT_PUBLIC_BLOSSOM_URL = prevShared;
      }
    }
  });

  it("does not send Pages blobs to NEXT_PUBLIC_BLOSSOM_URL (media host)", () => {
    const prevPages = process.env.NEXT_PUBLIC_GITTR_PAGES_BLOSSOM_URL;
    const prevShared = process.env.NEXT_PUBLIC_BLOSSOM_URL;
    delete process.env.NEXT_PUBLIC_GITTR_PAGES_BLOSSOM_URL;
    process.env.NEXT_PUBLIC_BLOSSOM_URL = "https://blossom.band";
    try {
      expect(gittrPagesBlossomOrigin()).toBe(
        DEFAULT_GITTR_PAGES_BLOSSOM_ORIGIN
      );
    } finally {
      if (prevPages !== undefined) {
        process.env.NEXT_PUBLIC_GITTR_PAGES_BLOSSOM_URL = prevPages;
      } else {
        delete process.env.NEXT_PUBLIC_GITTR_PAGES_BLOSSOM_URL;
      }
      if (prevShared !== undefined) {
        process.env.NEXT_PUBLIC_BLOSSOM_URL = prevShared;
      } else {
        delete process.env.NEXT_PUBLIC_BLOSSOM_URL;
      }
    }
  });

  it("accepts a full URL in a server tag", () => {
    expect(normalizeBlossomServerTagHost("https://blossom.gittr.space/")).toBe(
      "blossom.gittr.space"
    );
  });

  it("rejects a token scoped to blossom.band when uploading to gittr Blossom", () => {
    expect(
      blossomAuthServerMatchesOrigin(
        [["server", "blossom.band"]],
        "https://blossom.gittr.space"
      )
    ).toBe(false);
  });

  it("accepts a token scoped to the upload host", () => {
    expect(
      blossomAuthServerMatchesOrigin(
        [["server", "blossom.gittr.space"]],
        "https://blossom.gittr.space"
      )
    ).toBe(true);
  });

  it("accepts a token with no server tags", () => {
    expect(
      blossomAuthServerMatchesOrigin([], "https://blossom.gittr.space")
    ).toBe(true);
  });
});
