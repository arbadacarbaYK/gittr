import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getAllRelays } from "./getAllRelays";
import { NIP65_RELAY_CACHE_KEY } from "./nip65-relay-cache";

describe("getAllRelays", () => {
  const store = new Map<string, string>();

  beforeEach(() => {
    store.clear();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("puts platform defaults first, then cached NIP-65", () => {
    localStorage.setItem(
      NIP65_RELAY_CACHE_KEY,
      JSON.stringify([{ url: "wss://relay.example.com/" }])
    );
    expect(getAllRelays(["wss://relay.gittr.space"])).toEqual([
      "wss://relay.gittr.space",
      "wss://relay.example.com",
    ]);
  });
});
