import { describe, expect, it } from "vitest";

import {
  BLOSSOM_AUTH_MAX_HASHES,
  blossomAuthHashBatches,
} from "./blossom-auth-batches";

const hash = (i: number) => i.toString(16).padStart(64, "0");

describe("blossomAuthHashBatches", () => {
  it("keeps a small site in one batch", () => {
    expect(blossomAuthHashBatches([hash(1), hash(2)])).toEqual([
      [hash(1), hash(2)],
    ]);
  });

  it("splits a large site so no auth header outgrows nginx's 8 KB", () => {
    const hashes = Array.from({ length: 161 }, (_, i) => hash(i));
    const batches = blossomAuthHashBatches(hashes);
    expect(batches.map((b) => b.length)).toEqual([50, 50, 50, 11]);
    expect(batches.flat()).toEqual(hashes);

    // Worst case header for a full batch, as the proxy sends it
    const event = {
      id: "f".repeat(64),
      pubkey: "f".repeat(64),
      created_at: 1_700_000_000,
      kind: 24242,
      content: `gittr Pages: Blossom batch upload (${BLOSSOM_AUTH_MAX_HASHES} blobs)`,
      sig: "f".repeat(128),
      tags: [
        ["t", "upload"],
        ["expiration", "1700007200"],
        ...batches[0]!.map((h) => ["x", h]),
        ["server", "blossom.gittr.space"],
      ],
    };
    const header = `Nostr ${Buffer.from(JSON.stringify(event)).toString(
      "base64"
    )}`;
    expect(header.length).toBeLessThan(8 * 1024);
  });

  it("dedupes case-insensitively", () => {
    expect(
      blossomAuthHashBatches([hash(10), hash(10).toUpperCase(), hash(11)])
    ).toEqual([[hash(10), hash(11)]]);
  });

  it("returns no batches for no hashes", () => {
    expect(blossomAuthHashBatches([])).toEqual([]);
  });
});
