import { nip19 } from "nostr-tools";
import { describe, expect, it } from "vitest";

import { parseContactListPubkeys } from "./contact-list";
import { type Metadata, mergeKind0OntoExisting } from "./kind0-merge";
import {
  applyKind0NameFields,
  pickProfileDisplayName,
} from "./kind0-profile-fields";

describe("pickProfileDisplayName", () => {
  it("prefers display_name over name", () => {
    expect(pickProfileDisplayName({ display_name: "Ada", name: "ada" })).toBe(
      "Ada"
    );
  });

  it("uses camelCase displayName when display_name is missing", () => {
    expect(pickProfileDisplayName({ displayName: "BBakker", name: "" })).toBe(
      "BBakker"
    );
  });

  it("uses name when both display fields are empty", () => {
    expect(pickProfileDisplayName({ name: "BBakker" })).toBe("BBakker");
  });

  it("treats empty display_name as missing so name still wins", () => {
    expect(
      pickProfileDisplayName({ display_name: "  ", name: "BBakker" })
    ).toBe("BBakker");
  });

  it("rejects npub-shaped and hex stubs", () => {
    expect(pickProfileDisplayName({ name: "npub1abc" })).toBeNull();
    expect(pickProfileDisplayName({ name: "a".repeat(64) })).toBeNull();
    expect(pickProfileDisplayName({ name: "Anonymous Nostrich" })).toBeNull();
    expect(pickProfileDisplayName({})).toBeNull();
  });
});

describe("applyKind0NameFields", () => {
  it("copies displayName onto display_name for downstream snake_case readers", () => {
    const next = applyKind0NameFields({
      displayName: "BBakker",
      name: "BBakker",
      about: "HI",
    });
    expect(next.display_name).toBe("BBakker");
    expect(next.name).toBe("BBakker");
  });
});

describe("payment + social parsing sanity", () => {
  it("parseContactListPubkeys accepts npub1... inside p tags", () => {
    const a = "a".repeat(64);
    const aNpub = nip19.npubEncode(a);
    expect(
      parseContactListPubkeys({ tags: [["p", aNpub]], content: "" }).sort()
    ).toEqual([a].sort());
  });

  it("mergeKind0OntoExisting overwrites lud16 when incoming is newer", () => {
    const existing: Metadata = { lud16: "old@example.com", created_at: 10 };
    const incoming: Metadata = { lud16: "new@example.com" };
    const out = mergeKind0OntoExisting(existing, incoming, 20);
    expect(out.lud16).toBe("new@example.com");
  });

  it("mergeKind0OntoExisting keeps lud16 when incoming is older", () => {
    const existing: Metadata = {
      name: "Ada",
      lud16: "old@example.com",
      created_at: 20,
    };
    const incoming: Metadata = { name: "Ada", lud16: "new@example.com" };
    const out = mergeKind0OntoExisting(existing, incoming, 10);
    expect(out.lud16).toBe("old@example.com");
  });

  it("mergeKind0OntoExisting overwrites lud16 when cache created_at is in the future", () => {
    const existing: Metadata = {
      name: "BBakker",
      lud16: "old@getalby.com",
      created_at: Date.now(),
    };
    const incoming: Metadata = {
      name: "BBakker",
      lud16: "new@madeflow.nl",
    };
    const out = mergeKind0OntoExisting(existing, incoming, 1_788_449_962);
    expect(out.lud16).toBe("new@madeflow.nl");
  });
});
