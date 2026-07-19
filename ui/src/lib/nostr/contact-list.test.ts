import { afterEach, describe, expect, it } from "vitest";

import {
  loadContactListBackup,
  loadKnownContactList,
  mergeContactLists,
  parseContactListPubkeys,
  rememberContactList,
  resolveContactListBase,
  saveContactListBackup,
  wouldWipeFollowList,
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

  it("flags partial when largestRelayListSize dwarfs newest relay list", () => {
    const big = mk(50);
    const tiny = [big[0]!, "d".repeat(64)];
    const resolved = resolveContactListBase({
      relayContacts: tiny,
      relayCreatedAt: Date.now(),
      inMemory: [],
      backup: [],
      largestRelayListSize: 50,
    });
    expect(resolved.relayLooksPartial).toBe(true);
    expect(resolved.contacts.length).toBe(2);
  });
});

describe("wouldWipeFollowList", () => {
  it("blocks publishing 2 follows when known list is 100+", () => {
    expect(
      wouldWipeFollowList({
        nextCount: 2,
        backupSize: 0,
        largestRelayListSize: 120,
        inMemorySize: 0,
        relayLooksPartial: true,
      })
    ).toBe(true);
  });

  it("allows normal follow growth", () => {
    expect(
      wouldWipeFollowList({
        nextCount: 121,
        backupSize: 120,
        largestRelayListSize: 120,
        inMemorySize: 120,
        relayLooksPartial: false,
      })
    ).toBe(false);
  });
});

describe("saveContactListBackup + rememberContactList", () => {
  const owner = "d".repeat(64);
  const key = `gittr_contact_list_backup_${owner}`;
  const sessionKey = `gittr_contact_list_session_${owner}`;
  const store = new Map<string, string>();
  const session = new Map<string, string>();

  afterEach(() => {
    store.clear();
    session.clear();
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
    (globalThis as any).sessionStorage = {
      getItem: (k: string) => session.get(k) ?? null,
      setItem: (k: string, v: string) => {
        session.set(k, v);
      },
      removeItem: (k: string) => {
        session.delete(k);
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

  it("session + backup survive a tiny relay overwrite attempt", () => {
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
    (globalThis as any).sessionStorage = {
      getItem: (k: string) => session.get(k) ?? null,
      setItem: (k: string, v: string) => {
        session.set(k, v);
      },
      removeItem: (k: string) => {
        session.delete(k);
      },
    };

    const big = Array.from({ length: 30 }, (_, i) =>
      i.toString(16).padStart(64, "0")
    );
    rememberContactList(owner, big);
    rememberContactList(owner, [big[0]!, "f".repeat(64)]);
    const known = loadKnownContactList(owner);
    expect(known.length).toBeGreaterThanOrEqual(30);
    expect(known).toContain("f".repeat(64));
    expect(session.has(sessionKey)).toBe(true);
  });
});
