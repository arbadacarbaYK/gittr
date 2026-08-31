import { describe, expect, it } from "vitest";

import {
  mergeRepoStateWithStorage,
  withPreservedPagesSiteSlug,
} from "./merge-repo-state-with-storage";

describe("mergeRepoStateWithStorage pagesSiteSlug", () => {
  it("keeps a stored custom site name when hydrate omitted the field", () => {
    const merged = mergeRepoStateWithStorage(
      { repo: "conference-loop", readme: "# hi" },
      { repo: "conference-loop", pagesSiteSlug: "conf-loop" }
    );
    expect(merged?.pagesSiteSlug).toBe("conf-loop");
  });

  it("does not restore a custom name after the owner cleared it", () => {
    const merged = mergeRepoStateWithStorage(
      { repo: "conference-loop", pagesSiteSlug: "" },
      { repo: "conference-loop", pagesSiteSlug: "conf-loop" }
    );
    expect(merged && "pagesSiteSlug" in merged).toBe(false);
  });

  it("prefers the in-memory custom name", () => {
    const merged = mergeRepoStateWithStorage(
      { repo: "conference-loop", pagesSiteSlug: "meetup" },
      { repo: "conference-loop", pagesSiteSlug: "old-name" }
    );
    expect(merged?.pagesSiteSlug).toBe("meetup");
  });
});

describe("withPreservedPagesSiteSlug", () => {
  it("fills the slug from storage when the next object omitted it", () => {
    expect(
      withPreservedPagesSiteSlug(
        { repo: "conference-loop" },
        { pagesSiteSlug: "conf-loop" }
      ).pagesSiteSlug
    ).toBe("conf-loop");
  });

  it("does not override an explicit next value", () => {
    expect(
      withPreservedPagesSiteSlug(
        { repo: "x", pagesSiteSlug: "kept" },
        { pagesSiteSlug: "other" }
      ).pagesSiteSlug
    ).toBe("kept");
  });
});
