import { Buffer } from "buffer";
import { describe, expect, it } from "vitest";

import {
  GITTR_PAGES_AUTH_HEADER_MAX,
  isNginxAuthHeaderTooLarge,
  nginxAuthHeaderTooLargeMessage,
  nostrAuthorizationHeaderLength,
  pagesPublishTooManyFilesMessage,
} from "./blossom-auth-header-limit";

describe("blossom auth header limit", () => {
  it("matches Node base64url header length", () => {
    const event = {
      kind: 24242,
      content: "gittr Pages: Blossom batch upload (3 blobs)",
      tags: [
        ["t", "upload"],
        ["x", "ab".repeat(32)],
      ],
    };
    const fromNode =
      "Nostr " +
      Buffer.from(JSON.stringify(event), "utf8").toString("base64url");
    expect(nostrAuthorizationHeaderLength(event)).toBe(fromNode.length);
  });

  it("explains the file cap without the nginx HTML page", () => {
    const msg = pagesPublishTooManyFilesMessage(161, 64);
    expect(msg).toContain("161 files");
    expect(msg).toContain("64 files");
    expect(msg).toContain("own Blossom server");
    expect(msg).not.toContain("<html");
    expect(msg.length).toBeLessThan(GITTR_PAGES_AUTH_HEADER_MAX);
  });

  it("recognises nginx's header error page", () => {
    const html =
      "<html><head><title>400 Request Header Or Cookie Too Large</title></head>";
    expect(isNginxAuthHeaderTooLarge(400, html)).toBe(true);
    expect(isNginxAuthHeaderTooLarge(400, "bad json")).toBe(false);
    expect(nginxAuthHeaderTooLargeMessage()).not.toContain("<html");
  });
});
