import { describe, expect, it } from "vitest";

import {
  gittrPagesPushPreconditionsMet,
  hasGittrPagesEntryFile,
} from "./pages-preconditions";

describe("hasGittrPagesEntryFile", () => {
  it("requires a root index.html (same gate as Push Manifest)", () => {
    expect(hasGittrPagesEntryFile([{ path: "index.html" }])).toBe(true);
    expect(hasGittrPagesEntryFile([{ path: "docs/index.html" }])).toBe(false);
    expect(hasGittrPagesEntryFile([{ path: "index.md" }])).toBe(false);
    expect(hasGittrPagesEntryFile([{ path: "404.html" }])).toBe(false);
  });
});

describe("gittrPagesPushPreconditionsMet", () => {
  it("does not require a README pagelink to publish a page", () => {
    expect(
      gittrPagesPushPreconditionsMet({
        files: [{ path: "index.html" }],
        readme: "",
        autoReadmeOnPush: false,
        namedUrl: "https://example.pages.gittr.space/",
      })
    ).toBe(true);
  });
});
