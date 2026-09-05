import { describe, expect, it } from "vitest";

import {
  inspectBlossomUploadAuth,
  unsignedNgitBlossomUploadAuth,
} from "./blossom-bud11-auth";
import { ngitBlossomHostnames } from "./nip82-blossom-hosts";

const PUBKEY = "ab".repeat(32);
const SHA = "cd".repeat(32);

describe("blossom BUD-11 upload auth", () => {
  it("builds t=upload, x, expiration, and ngit server hostnames", () => {
    const event = unsignedNgitBlossomUploadAuth({
      pubkeyHex: PUBKEY,
      sha256Hex: [SHA],
      serverHostnames: ngitBlossomHostnames(),
    });
    expect(event.kind).toBe(24242);
    expect(event.tags.find((t) => t[0] === "t")?.[1]).toBe("upload");
    expect(event.tags.filter((t) => t[0] === "x").map((t) => t[1])).toEqual([
      SHA,
    ]);
    expect(event.tags.some((t) => t[0] === "u")).toBe(false);
    expect(event.tags.some((t) => t[0] === "method")).toBe(false);
    const servers = event.tags
      .filter((t) => t[0] === "server")
      .map((t) => t[1]);
    expect(servers).toEqual(ngitBlossomHostnames());
    expect(servers).not.toContain("blossom.gittr.space");
    expect(inspectBlossomUploadAuth(event, SHA).ok).toBe(true);
  });

  it("rejects expired or mismatched auth", () => {
    const event = unsignedNgitBlossomUploadAuth({
      pubkeyHex: PUBKEY,
      sha256Hex: [SHA],
      serverHostnames: ["blossom.primal.net"],
    });
    expect(inspectBlossomUploadAuth(event, "ee".repeat(32)).ok).toBe(false);
    const expired = {
      ...event,
      tags: event.tags.map((t) =>
        t[0] === "expiration" ? ["expiration", "1"] : t
      ),
    };
    expect(inspectBlossomUploadAuth(expired, SHA).ok).toBe(false);
  });
});
