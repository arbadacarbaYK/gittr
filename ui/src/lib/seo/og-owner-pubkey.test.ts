import { nip19 } from "nostr-tools";
import { describe, expect, it } from "vitest";

import {
  decodeOgOwnerPubkey,
  mergeOgDescriptions,
  pubkeyFromSeoRepoPaths,
  pubkeysFromSeoRepoPaths,
} from "./og-owner-pubkey";

const PK = "f6150173b5d6f079b43540d84a8a95d50cf01a48c9d6037984e3d9600d5522af";
const NPUB = nip19.npubEncode(PK);

describe("decodeOgOwnerPubkey", () => {
  it("accepts hex and npub only", () => {
    expect(decodeOgOwnerPubkey(PK)).toBe(PK);
    expect(decodeOgOwnerPubkey(NPUB)).toBe(PK);
    expect(decodeOgOwnerPubkey("DrShift")).toBeNull();
  });
});

describe("pubkeyFromSeoRepoPaths", () => {
  it("resolves a unique npub/repo path for vanity URLs", () => {
    expect(pubkeyFromSeoRepoPaths({ [`${NPUB}/buho-go`]: 1 }, "buho-go")).toBe(
      PK
    );
  });

  it("lists every owner when the repo name is shared", () => {
    const otherPk = "aa".repeat(32);
    const other = nip19.npubEncode(otherPk);
    expect(
      pubkeysFromSeoRepoPaths(
        { [`${NPUB}/buho-go`]: 1, [`${other}/buho-go`]: 2 },
        "buho-go"
      ).sort()
    ).toEqual([otherPk, PK].sort());
  });

  it("stays null when two owners share the repo name", () => {
    const other = nip19.npubEncode("aa".repeat(32));
    expect(
      pubkeyFromSeoRepoPaths(
        { [`${NPUB}/buho-go`]: 1, [`${other}/buho-go`]: 2 },
        "buho-go"
      )
    ).toBeNull();
  });
});

describe("mergeOgDescriptions", () => {
  it("keeps a real About when a newer announce omitted the tag", () => {
    expect(
      mergeOgDescriptions("", "Buho GO Wallet: a native wallet", "buho-go")
    ).toBe("Buho GO Wallet: a native wallet");
  });

  it("does not keep Repository: placeholders", () => {
    expect(
      mergeOgDescriptions("", "Repository: buho-go", "buho-go")
    ).toBeNull();
  });
});
