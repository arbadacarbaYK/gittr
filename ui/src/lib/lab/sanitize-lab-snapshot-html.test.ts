import { describe, expect, it } from "vitest";

import { sanitizeLabSnapshotHtml } from "./sanitize-lab-snapshot-html";

describe("sanitizeLabSnapshotHtml", () => {
  it("strips external scripts and event handlers; keeps inline map scripts", () => {
    const out = sanitizeLabSnapshotHtml(
      `<html><body onclick="alert(1)"><script src="https://evil.example/x.js"></script><script type="application/json" id="lab-snapshot-data">{"ok":true}</script><script>const x=1;</script><p>ok</p></body></html>`
    );
    expect(out).not.toMatch(/evil\.example/i);
    expect(out).not.toMatch(/onclick/i);
    expect(out).toContain('id="lab-snapshot-data"');
    expect(out).toContain("const x=1;");
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

  it("injects CSP that allows inline scripts but blocks connect", () => {
    const out = sanitizeLabSnapshotHtml(
      `<html><head></head><body>hi</body></html>`
    );
    expect(out).toMatch(/Content-Security-Policy/);
    expect(out).toMatch(/script-src 'unsafe-inline'/);
    expect(out).toMatch(/connect-src 'none'/);
    expect(out).not.toMatch(/script-src 'none'/);
  });

  it("injects auto-height reporter for sandboxed iframe", () => {
    const out = sanitizeLabSnapshotHtml(
      `<html><head></head><body><p>map</p></body></html>`
    );
    expect(out).toContain("gittr-lab-autoheight");
    expect(out).toContain("gittr-lab-snapshot-height");
    expect(out).toContain("gittr-lab-map-interact");
    expect(out).toContain("postMessage");
    expect(out).toMatch(/#gwrap\.graph-wrap/);
  });
});
