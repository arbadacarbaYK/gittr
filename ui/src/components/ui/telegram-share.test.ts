import { describe, expect, it } from "vitest";

import { telegramShareCaption, telegramShareUrl } from "./telegram-share";

const PAGE =
  "https://gittr.space/npub1n2ph08n4pqz4d3jk6n2p35p2f4ldhc5g5tu7dhftfpueajf4rpxqfjhzmc/gittr";

describe("telegramShareCaption", () => {
  it("stays one line and drops emoji that take two characters", () => {
    const caption = telegramShareCaption(
      "📦 arbadacarba/gittr\n\nBuilt on Nostr ⚡"
    );
    expect(caption).toBe("arbadacarba/gittr Built on Nostr ⚡ on gittr");
    expect(caption.includes("\n")).toBe(false);
    expect(/[\uD800-\uDBFF]/.test(caption)).toBe(false);
  });

  it("keeps a normal repo name", () => {
    expect(telegramShareCaption("arbadacarba/gittr")).toBe(
      "arbadacarba/gittr on gittr"
    );
  });
});

describe("telegramShareUrl", () => {
  it("uses the official share path and percent-encoding", () => {
    const share = telegramShareUrl(PAGE, "arbadacarba/gittr");
    const parsed = new URL(share);
    expect(parsed.origin + parsed.pathname).toBe("https://t.me/share/url");
    expect(parsed.search).not.toContain("+");
    expect(parsed.searchParams.get("url")).toBe(PAGE);
    expect(parsed.searchParams.get("text")).toBe("arbadacarba/gittr on gittr");
    expect(share.includes("%20")).toBe(true);
    expect(share.includes("%0A")).toBe(false);
  });

  it("refuses a non-web address", () => {
    expect(telegramShareUrl("javascript:alert(1)", "gittr")).toBe("");
    expect(telegramShareUrl("", "gittr")).toBe("");
  });
});
