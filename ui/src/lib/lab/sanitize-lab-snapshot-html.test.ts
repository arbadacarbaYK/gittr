import { describe, expect, it } from "vitest";

import { sanitizeLabSnapshotHtml } from "./sanitize-lab-snapshot-html";

describe("sanitizeLabSnapshotHtml", () => {
  it("strips scripts and event handlers", () => {
    const out = sanitizeLabSnapshotHtml(
      `<html><body onclick="alert(1)"><script>fetch('http://127.0.0.1:8767')</script><p>ok</p></body></html>`
    );
    expect(out).not.toMatch(/<script/i);
    expect(out).not.toMatch(/onclick/i);
    expect(out).toContain("<p>ok</p>");
  });

  it("neutralizes localhost and private URLs", () => {
    const out = sanitizeLabSnapshotHtml(
      `<a href="http://127.0.0.1:8767/dashboard">x</a><img src="http://192.168.1.1/x.png"><a href="https://duckduckgo.com/?q=cve">ok</a>`
    );
    expect(out).toContain('href="#blocked-local"');
    expect(out).toContain("https://duckduckgo.com/?q=cve");
    expect(out).not.toContain("127.0.0.1");
    expect(out).not.toContain("192.168.1.1");
  });

  it("injects CSP meta that blocks connect/script", () => {
    const out = sanitizeLabSnapshotHtml(
      `<html><head></head><body>hi</body></html>`
    );
    expect(out).toMatch(/Content-Security-Policy/);
    expect(out).toMatch(/script-src 'none'/);
    expect(out).toMatch(/connect-src 'none'/);
  });
});
