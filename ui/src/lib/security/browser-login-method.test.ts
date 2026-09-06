import { describe, expect, it } from "vitest";

import {
  aboutEncryptionItems,
  bestPracticeItems,
  detectBrowserLoginMethod,
  leftoverNsecCopy,
  signingStatusCopy,
  whatGetsEncryptedItems,
} from "./browser-login-method";

describe("detectBrowserLoginMethod", () => {
  it("treats a remote-signer session as Amber, not NIP-07, even when window.nostr exists", () => {
    expect(
      detectBrowserLoginMethod({
        hasRemoteSession: true,
        hasWindowNostr: true,
        hasNsecInBrowser: false,
      })
    ).toBe("remote");
  });

  it("is NIP-07 only when there is no bunker session", () => {
    expect(
      detectBrowserLoginMethod({
        hasRemoteSession: false,
        hasWindowNostr: true,
        hasNsecInBrowser: false,
      })
    ).toBe("nip07");
  });

  it("falls back to nsec when nothing else can sign", () => {
    expect(
      detectBrowserLoginMethod({
        hasRemoteSession: false,
        hasWindowNostr: false,
        hasNsecInBrowser: true,
      })
    ).toBe("nsec");
  });
});

describe("security page copy", () => {
  it("does not tell Amber users they are on an extension", () => {
    const snap = {
      hasRemoteSession: true,
      hasWindowNostr: true,
      hasNsecInBrowser: false,
      method: "remote" as const,
    };
    const status = signingStatusCopy(snap);
    expect(status.title.toLowerCase()).toContain("remote signer");
    expect(status.body.toLowerCase()).not.toContain("nip-07");
    expect(status.body.toLowerCase()).toContain("nsec");
    const about = aboutEncryptionItems(snap);
    expect(about.some((l) => /amber|extension key/i.test(l))).toBe(true);
    const practices = bestPracticeItems("remote");
    expect(practices[0]).toMatch(/Amber/i);
    expect(
      practices.some((l) => /Use NIP-07 extension \(recommended\)/i.test(l))
    ).toBe(false);
    const enc = whatGetsEncryptedItems(snap);
    expect(enc.items[0].toLowerCase()).toContain("not your identity key");
  });

  it("explains leftover nsec when signing via remote", () => {
    const leftover = leftoverNsecCopy("remote");
    expect(leftover.body.toLowerCase()).toContain("remote signer");
    expect(leftover.body.toLowerCase()).toContain("localstorage");
  });
});
