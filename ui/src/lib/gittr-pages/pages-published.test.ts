import { describe, expect, it } from "vitest";

import { gatewayIngestUrl, parsePagesIngestParams } from "./pages-published";

describe("parsePagesIngestParams", () => {
  it("accepts operator hex + named d-tag", () => {
    const parsed = parsePagesIngestParams(
      new URLSearchParams({
        author:
          "9A83779E75080556C656D4D418D02A4D7EDBE288A2F9E6DD2B48799EC935184C",
        d: "gittr-docu",
      })
    );
    expect(parsed).toEqual({
      authorHex:
        "9a83779e75080556c656d4d418d02a4d7edbe288a2f9e6dd2b48799ec935184c",
      dTag: "gittr-docu",
    });
  });

  it("rejects a too-long Pages name", () => {
    const parsed = parsePagesIngestParams(
      new URLSearchParams({
        author:
          "9a83779e75080556c656d4d418d02a4d7edbe288a2f9e6dd2b48799ec935184c",
        d: "nsite-gateway-too-long",
      })
    );
    expect("error" in parsed).toBe(true);
  });
});

describe("gatewayIngestUrl", () => {
  it("points at the gateway ingest route", () => {
    expect(
      gatewayIngestUrl(
        "https://pages.gittr.space/",
        "9a83779e75080556c656d4d418d02a4d7edbe288a2f9e6dd2b48799ec935184c",
        "gitnostr"
      )
    ).toBe(
      "https://pages.gittr.space/status/ingest?pubkey=9a83779e75080556c656d4d418d02a4d7edbe288a2f9e6dd2b48799ec935184c&d=gitnostr"
    );
  });
});
