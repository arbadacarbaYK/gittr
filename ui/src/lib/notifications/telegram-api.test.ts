import { describe, expect, it } from "vitest";

import {
  emojiForNotificationTitle,
  escapeTelegramHtml,
  formatTelegramNotificationHtml,
} from "./telegram-api";

describe("escapeTelegramHtml", () => {
  it("escapes &, <, >", () => {
    expect(escapeTelegramHtml('a <b> & "c"')).toBe('a &lt;b&gt; &amp; "c"');
  });
});

describe("emojiForNotificationTitle", () => {
  it("maps security titles to lock emoji", () => {
    expect(emojiForNotificationTitle("[security] tides — 1 vuln")).toBe("🔒");
    expect(
      emojiForNotificationTitle("Security alert: tides — 1 HIGH vulnerability")
    ).toBe("🔒");
  });
});

describe("formatTelegramNotificationHtml", () => {
  it("builds escaped HTML with link", () => {
    const { emoji, html } = formatTelegramNotificationHtml({
      title: "Security alert: tides — 1 HIGH",
      message: "Repo: tides\n• HIGH — rollup@2.79.2 <script>",
      url: "https://gittr.space/npub1abc/tides/issues/1?x=1&y=2",
      linkLabel: "Open security issue",
    });
    expect(emoji).toBe("🔒");
    expect(html).toContain("<b>Security alert: tides — 1 HIGH</b>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain('href="https://gittr.space/npub1abc/tides/issues/1?x=1&amp;y=2"');
    expect(html).toContain(">Open security issue</a>");
    expect(html).not.toContain("<script>");
  });
});
