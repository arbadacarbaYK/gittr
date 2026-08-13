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
  it("maps dependency/advisory titles to a calm clipboard emoji", () => {
    expect(emojiForNotificationTitle("[deps] tides — 1 advisory match")).toBe(
      "📋"
    );
    expect(
      emojiForNotificationTitle(
        "Dependency notice: tides — 1 HIGH published advisory match"
      )
    ).toBe("📋");
  });
});

describe("formatTelegramNotificationHtml", () => {
  it("builds escaped HTML with link", () => {
    const { emoji, html } = formatTelegramNotificationHtml({
      title: "Dependency notice: tides — 1 HIGH",
      message: "Repo: tides\n• HIGH — rollup@2.79.2 <script>",
      url: "https://gittr.space/npub1abc/tides/issues/1?x=1&y=2",
      linkLabel: "View details",
    });
    expect(emoji).toBe("📋");
    expect(html).toContain("<b>Dependency notice: tides — 1 HIGH</b>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain('href="https://gittr.space/npub1abc/tides/issues/1?x=1&amp;y=2"');
    expect(html).toContain(">View details</a>");
    expect(html).not.toContain("<script>");
  });
});
