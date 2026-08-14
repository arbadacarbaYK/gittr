import { describe, expect, it } from "vitest";

import { isOpaqueBinaryDataUrl } from "./opaque-binary-data-url";

describe("isOpaqueBinaryDataUrl", () => {
  it("flags octet-stream data URLs", () => {
    expect(
      isOpaqueBinaryDataUrl("data:application/octet-stream;base64,AAAA")
    ).toBe(true);
  });

  it("allows text and previewable media data URLs", () => {
    expect(isOpaqueBinaryDataUrl("data:text/plain;base64,YQ==")).toBe(false);
    expect(isOpaqueBinaryDataUrl("data:image/png;base64,iVBOR")).toBe(false);
    expect(isOpaqueBinaryDataUrl("data:application/pdf;base64,JVBE")).toBe(
      false
    );
    expect(isOpaqueBinaryDataUrl("data:application/json;base64,e30=")).toBe(
      false
    );
  });

  it("ignores http and plain text", () => {
    expect(isOpaqueBinaryDataUrl("hello")).toBe(false);
    expect(isOpaqueBinaryDataUrl("https://example.com/x.bin")).toBe(false);
    expect(isOpaqueBinaryDataUrl(null)).toBe(false);
  });
});
