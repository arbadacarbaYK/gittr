import { describe, expect, it } from "vitest";

import {
  blossomMediaFallbackUrls,
  extractBlossomSha256,
  nextBlossomMediaUrl,
} from "./blossom-media-fallback";

const ALEX =
  "https://blossom.ditto.pub/ff3b8bde2ff4050a5380db87796eaaca92b73744bcc355339f8ee43d66ba116b.jpeg";
const HASH = "ff3b8bde2ff4050a5380db87796eaaca92b73744bcc355339f8ee43d66ba116b";

describe("extractBlossomSha256", () => {
  it("reads hash + extension from a Blossom URL", () => {
    expect(extractBlossomSha256(ALEX)).toEqual({
      hash: HASH,
      ext: ".jpeg",
    });
  });

  it("reads a nostr.build /i/ hash path", () => {
    expect(extractBlossomSha256(`https://nostr.build/i/${HASH}.jpg`)).toEqual({
      hash: HASH,
      ext: ".jpg",
    });
  });

  it("returns null when there is no sha256", () => {
    expect(extractBlossomSha256("https://nostr.build/i/avatar.png")).toBeNull();
  });
});

describe("blossomMediaFallbackUrls", () => {
  it("deprioritizes ditto and puts primal first", () => {
    const urls = blossomMediaFallbackUrls(ALEX);
    expect(urls[0]).toBe(`https://blossom.primal.net/${HASH}.jpeg`);
    expect(urls).toContain(ALEX);
    expect(urls.indexOf(ALEX)).toBeGreaterThan(0);
  });

  it("keeps a healthy original first", () => {
    const original = `https://blossom.primal.net/${HASH}.jpeg`;
    const urls = blossomMediaFallbackUrls(original);
    expect(urls[0]).toBe(original);
    expect(urls).toContain(`https://blossom.dreamith.to/${HASH}.jpeg`);
  });

  it("does not invent mirrors for non-hash http URLs", () => {
    expect(blossomMediaFallbackUrls("https://example.com/me.png")).toEqual([
      "https://example.com/me.png",
    ]);
  });

  it("returns empty for missing / non-http", () => {
    expect(blossomMediaFallbackUrls("")).toEqual([]);
    expect(blossomMediaFallbackUrls("/logo.svg")).toEqual([]);
  });

  it("passes through inline data:image kind-0 pictures", () => {
    const svg = "data:image/svg+xml;base64,PHN2Zy8+";
    expect(blossomMediaFallbackUrls(svg)).toEqual([svg]);
    expect(blossomMediaFallbackUrls("javascript:alert(1)")).toEqual([]);
  });
});

describe("nextBlossomMediaUrl", () => {
  it("walks to the next mirror after a 502", () => {
    const urls = blossomMediaFallbackUrls(ALEX);
    const next = nextBlossomMediaUrl(urls[0]!, ALEX);
    expect(next).toBe(urls[1]);
    expect(nextBlossomMediaUrl(urls[urls.length - 1]!, ALEX)).toBeNull();
  });
});
