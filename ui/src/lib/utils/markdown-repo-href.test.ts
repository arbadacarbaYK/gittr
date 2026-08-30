import { describe, expect, it } from "vitest";

import { resolveRepoMarkdownHref } from "./markdown-repo-href";

describe("resolveRepoMarkdownHref", () => {
  const ctx = {
    getRepoLink: () => "/npub1test/officecli",
    basePath: "README.md",
    repoName: "officecli",
    entity: "npub1test",
  };

  it("treats LICENSE as a file not a folder", () => {
    const href = resolveRepoMarkdownHref("LICENSE", ctx);
    expect(href).toContain("file=");
    expect(href).not.toMatch(/\?path=LICENSE$/);
  });

  it("resolves same-folder media from a nested README", () => {
    const href = resolveRepoMarkdownHref("file-fetch.gif", {
      ...ctx,
      basePath: "snippets/file-fetching/README.md",
    });
    expect(href).toContain("file=");
    expect(href).toContain(
      encodeURIComponent("snippets/file-fetching/file-fetch.gif")
    );
  });

  it("refuses absurd nested paths from a deep basePath", () => {
    const deep = resolveRepoMarkdownHref("src/merchant", {
      ...ctx,
      basePath:
        "docs/packaging/files/tollgate-captive-portal-site/src/wireless_gateway_manager/src/upstream_detector/README.md",
    });
    expect(deep).toBe("/npub1test/officecli");
  });
});
