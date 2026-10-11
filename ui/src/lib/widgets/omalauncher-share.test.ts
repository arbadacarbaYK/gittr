import { describe, expect, it } from "vitest";
import { inflateRawSync } from "zlib";

import {
  omalauncherIntentUrl,
  omalauncherShareUrl,
  owlShareToken,
} from "./omalauncher-share";

describe("omalauncher share links", () => {
  it("round-trips a widget and builds the launcher intent", () => {
    const source = 'widget "nostr git" {\n  size: 6x4\n}\n';
    const token = owlShareToken(source);
    expect(token.startsWith("owl1.")).toBe(true);
    const packed = Buffer.from(
      token.slice("owl1.".length).replace(/-/g, "+").replace(/_/g, "/"),
      "base64"
    );
    expect(inflateRawSync(packed).toString("utf8")).toBe(source);
    expect(omalauncherShareUrl(token)).toBe(
      `https://simonschubert.github.io/omarchy-widgets/w#${token}`
    );
    const intent = omalauncherIntentUrl(token);
    expect(intent).toContain("package=dev.omalauncher");
    expect(intent).toContain(`S.widget=${encodeURIComponent(token)}`);
    expect(intent).toContain("play.google.com");
  });
});
