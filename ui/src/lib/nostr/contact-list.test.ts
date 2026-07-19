import { afterEach, describe, expect, it } from "vitest";

import {
  loadContactListBackup,
  mergeContactLists,
  parseContactListPubkeys,
  resolveContactListBase,
  saveContactListBackup,
} from "./contact-list";

describe("parseContactListPubkeys", () => {
  it("reads NIP-02 p tags", () => {
    const a = "a".repeat(64);
    const b = "b".repeat(64);
    expect(
      parseContactListPubkeys({
        tags: [
          ["p", a],
          ["p", b, "wss://relay.damus.io"],
        ],
        content: "",
      }).sort()
    ).toEqual([a, b].sort());
  });

  it("merges gittr JSON content with tags", () => {
    const a = "a".repeat(64);
    const b = "b".repeat(64);
    expect(
      parseContactListPubkeys({
        tags: [["p", a]],
        content: JSON.stringify({ p: [[b, "", "wss://x"]] }),
      }).sort()
    ).toEqual([a, b].sort());
  });
});

describe("merge + resolveContactListBase", () => {
  const mk = (n: number) =>
    Array.from({ length: n }, (_, i) => i.toString(16).padStart(64, "0"));

  it("unions lists", () => {
    const a = "a".repeat(64);
    const b = "b".repeat(64);
    expect(mergeContactLists([a], [b], [a]).sort()).toEqual([a, b].sort());
  });

  it("keeps backup when relay returns a tiny partial list", () => {
    const backup = mk(40);
    const relayTiny = [backup[0]!, "c".repeat(64)];
    const resolved = resolveContactListBase({
      relayContacts: relayTiny,
      relayCreatedAt: Date.now(),
      inMemory: [],
      backup,
    });
    expect(resolved.relayLooksPartial).toBe(true);
    expect(resolved.contacts.length).toBeGreaterThanOrEqual(40);
    expect(resolved.contacts).toContain("c".repeat(64));
  });
});

describe("saveContactListBackup", () => {
  const owner = "d".repeat(64);
  const key = `gittr_contact_list_backup_${owner}`;
  const store = new Map<string, string>();

  afterEach(() => {
    store.clear();
  });

  it("does not shrink an existing larger backup", () => {
    (globalThis as any).window = globalThis;
    (globalThis as any).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
    };

    const big = Array.from({ length: 20 }, (_, i) =>
      i.toString(16).padStart(64, "0")
    );
    saveContactListBackup(owner, big);
    saveContactListBackup(owner, [big[0]!, "e".repeat(64)]);
    const loaded = loadContactListBackup(owner);
    expect(loaded.length).toBeGreaterThanOrEqual(20);
    expect(loaded).toContain("e".repeat(64));
    expect(store.has(key)).toBe(true);
  });
});
