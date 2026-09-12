import { describe, expect, it } from "vitest";

import {
  forgeRawDirectoryHref,
  injectHtmlPreviewBaseHref,
} from "./html-preview-base";

describe("injectHtmlPreviewBaseHref", () => {
  it("injects base into <head> so relative CSS can load", () => {
    const html =
      '<!doctype html><html><head><link rel="stylesheet" href="./docs-site/hub.css"></head><body></body></html>';
    const out = injectHtmlPreviewBaseHref(
      html,
      "https://raw.githubusercontent.com/arbadacarbaYK/gittr/main/"
    );
    expect(out).toContain(
      '<base href="https://raw.githubusercontent.com/arbadacarbaYK/gittr/main/">'
    );
    expect(out.indexOf("<base")).toBeLessThan(out.indexOf("hub.css"));
  });

  it("does not overwrite an existing base tag", () => {
    const html = '<head><base href="https://example.com/"></head>';
    expect(
      injectHtmlPreviewBaseHref(
        html,
        "https://raw.githubusercontent.com/x/y/main/"
      )
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
});
