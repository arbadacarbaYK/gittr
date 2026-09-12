import { describe, expect, it } from "vitest";

import {
  forgeRawDirectoryHref,
  forgeRawFileHref,
  previewAssetApiHref,
  resolveRepoRelativeAssetPath,
  rewriteRelativeHtmlAssets,
} from "./html-preview-base";

describe("resolveRepoRelativeAssetPath", () => {
  it("resolves CSS next to index.html", () => {
    expect(
      resolveRepoRelativeAssetPath("index.html", "./docs-site/hub.css")
    ).toBe("docs-site/hub.css");
  });

  it("rejects leaving the repo", () => {
    expect(resolveRepoRelativeAssetPath("index.html", "../secret.css")).toBe(
      null
    );
  });
});

describe("rewriteRelativeHtmlAssets", () => {
  it("rewrites relative CSS to the same-origin preview proxy (CSP + MIME)", () => {
    const html =
      '<!doctype html><html><head><link rel="stylesheet" href="./docs-site/hub.css"></head><body></body></html>';
    const out = rewriteRelativeHtmlAssets(html, {
      sourceUrl: "https://github.com/arbadacarbaYK/gittr",
      branch: "main",
      filePath: "index.html",
    });
    expect(out).not.toContain("<base");
    expect(out).toContain("/api/gittr-pages/preview-asset?");
    expect(out).toContain("docs-site%2Fhub.css");
    expect(
      previewAssetApiHref({
        sourceUrl: "https://github.com/arbadacarbaYK/gittr",
        branch: "main",
        repoPath: "docs-site/hub.css",
      })
    ).toContain("path=docs-site%2Fhub.css");
  });

  it("leaves absolute and hash links alone", () => {
    const html = '<a href="https://gittr.space">x</a><a href="#map">m</a>';
    expect(
      rewriteRelativeHtmlAssets(html, {
        sourceUrl: "https://github.com/x/y",
        branch: "main",
        filePath: "index.html",
      })
    ).toBe(html);
  });
});

describe("forgeRawDirectoryHref", () => {
  it("points at the GitHub raw directory of index.html", () => {
    expect(
      forgeRawDirectoryHref({
        sourceUrl: "https://github.com/arbadacarbaYK/gittr-helper-tools",
        branch: "main",
        filePath: "index.html",
      })
    ).toBe(
      "https://raw.githubusercontent.com/arbadacarbaYK/gittr-helper-tools/main/"
    );
  });

  it("keeps nested HTML in its folder", () => {
    expect(
      forgeRawDirectoryHref({
        sourceUrl: "https://github.com/arbadacarbaYK/gittr.git",
        branch: "main",
        filePath: "docs-site/index.html",
      })
    ).toBe(
      "https://raw.githubusercontent.com/arbadacarbaYK/gittr/main/docs-site/"
    );
  });

  it("builds a file URL for the preview proxy upstream fetch", () => {
    expect(
      forgeRawFileHref({
        sourceUrl: "https://github.com/arbadacarbaYK/gittr",
        branch: "main",
        filePath: "docs-site/hub.css",
      })
    ).toBe(
      "https://raw.githubusercontent.com/arbadacarbaYK/gittr/main/docs-site/hub.css"
    );
  });
});
