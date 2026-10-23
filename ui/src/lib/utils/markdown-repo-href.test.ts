import { describe, expect, it } from "vitest";

import { resolveRepoMarkdownHref } from "./markdown-repo-href";

describe("resolveRepoMarkdownHref", () => {
  const ctx = {
    getRepoLink: () => "/npub1test/officecli",
    basePath: "README.md",
    repoName: "officecli",
    entity: "npub1test",
  };

  it("keeps the picked branch when opening a file from the readme", () => {
    const href = resolveRepoMarkdownHref("LICENSE", {
      ...ctx,
      getRepoLink: () => "/npub1test/officecli?branch=dev",
    });
    expect(href).toContain("branch=dev");
    expect(href).toContain("file=LICENSE");
    expect(href).not.toContain("?branch=dev?");
  });

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

  it("opens an asciidoc chapter as a file", () => {
    const href = resolveRepoMarkdownHref("01_introduction.asciidoc", ctx);
    expect(href).toContain("file=");
    expect(href).not.toContain("path=");
  });

  it("does not nest chapter links under a fake folder", () => {
    const href = resolveRepoMarkdownHref("08_routing_htlcs.asciidoc", {
      ...ctx,
      basePath: "14_encrypted_transport.asciidoc/README.md",
    });
    expect(href).toBe("/npub1test/officecli");
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
