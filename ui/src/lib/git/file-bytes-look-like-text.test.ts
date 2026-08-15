import { describe, expect, it } from "vitest";

import {
  fileBytesLookLikeText,
  httpBodyIsBinary,
} from "./file-bytes-look-like-text";

describe("fileBytesLookLikeText", () => {
  it("treats extensionless utf-8 as text", () => {
    expect(
      fileBytesLookLikeText(Buffer.from("peak river notes\n", "utf8"))
    ).toBe(true);
  });

  it("rejects null bytes", () => {
    expect(fileBytesLookLikeText(Buffer.from([0x7f, 0, 0x41]))).toBe(false);
  });
});

describe("httpBodyIsBinary", () => {
  it("does not treat octet-stream utf-8 as binary", () => {
    expect(
      httpBodyIsBinary(
        "application/octet-stream",
        Buffer.from("hello elmcanyon", "utf8")
      )
    ).toBe(false);
  });

  it("keeps real images binary", () => {
    expect(
      httpBodyIsBinary("image/png", Buffer.from("not really png", "utf8"))
    ).toBe(true);
  });
});
