import { describe, expect, it } from "vitest";

import {
  emojiForNotificationTitle,
  escapeTelegramHtml,
  formatTelegramNotificationHtml,
  safeTelegramHref,
} from "./telegram-api";

describe("escapeTelegramHtml", () => {
  it("escapes &, <, >, and quotes", () => {
    expect(escapeTelegramHtml('a <b> & "c"')).toBe(
      "a &lt;b&gt; &amp; &quot;c&quot;"
    );
  });
});

describe("safeTelegramHref", () => {
  it("keeps https links and does not leave raw quotes", () => {
    const href = safeTelegramHref('https://gittr.space/a?x=1&y="z"');
    expect(href).toContain("https://gittr.space/a?x=1");
    expect(href).toContain("&amp;");
    expect(href).not.toContain('"');
  });

  it("drops javascript and other non-http links", () => {
    expect(safeTelegramHref("javascript:alert(1)")).toBeNull();
    expect(safeTelegramHref("data:text/html,hi")).toBeNull();
  });

  it("turns a site path into an absolute https link", () => {
    const prevBase = process.env.NEXT_PUBLIC_BASE_URL;
    const prevSite = process.env.NEXT_PUBLIC_SITE_URL;
    delete process.env.NEXT_PUBLIC_BASE_URL;
    delete process.env.NEXT_PUBLIC_SITE_URL;
    try {
      expect(safeTelegramHref("/npub1abc/repo/issues/1")).toBe(
        "https://gittr.space/npub1abc/repo/issues/1"
      );
    } finally {
      if (prevBase === undefined) delete process.env.NEXT_PUBLIC_BASE_URL;
      else process.env.NEXT_PUBLIC_BASE_URL = prevBase;
      if (prevSite === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
      else process.env.NEXT_PUBLIC_SITE_URL = prevSite;
    }
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
    expect(html).toContain(
      'href="https://gittr.space/npub1abc/tides/issues/1?x=1&amp;y=2"'
    );
    expect(html).toContain(">View details</a>");
    expect(html).not.toContain("<script>");
  });

  it("does not let a quote in the url break out of the link", () => {
    const { html } = formatTelegramNotificationHtml({
      title: "Hello",
      message: "Body",
      url: 'https://gittr.space/x"></a><b>injected',
    });
    expect(html).not.toContain("</a><b>injected");
    expect(html).not.toContain('href="https://gittr.space/x">');
  });
});
