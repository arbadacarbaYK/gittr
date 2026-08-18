import { beforeEach, describe, expect, it } from "vitest";

import {
  collectBlockedRelayPoolUrls,
  filterBunkerBlockedRelays,
  isBunkerMainPoolBlocked,
  listBunkerMainPoolBlockedHosts,
  setBunkerMainPoolBlockedHosts,
} from "./bunker-main-pool-guard";

describe("bunker-main-pool-guard", () => {
  beforeEach(() => {
    setBunkerMainPoolBlockedHosts(null);
  });

  it("blocks normalized bunker hosts while set", () => {
    setBunkerMainPoolBlockedHosts(["wss://relay.primal.net/", "wss://nos.lol"]);
    expect(isBunkerMainPoolBlocked("wss://relay.primal.net")).toBe(true);
    expect(isBunkerMainPoolBlocked("wss://nos.lol/")).toBe(true);
    expect(isBunkerMainPoolBlocked("wss://relay.gittr.space")).toBe(false);
    expect(listBunkerMainPoolBlockedHosts()).toHaveLength(2);
  });

  it("clears the blocklist", () => {
    setBunkerMainPoolBlockedHosts(["wss://nos.lol"]);
    setBunkerMainPoolBlockedHosts(null);
    expect(isBunkerMainPoolBlocked("wss://nos.lol")).toBe(false);
  });

  it("strips blocked hosts from subscribe/publish relay lists", () => {
    setBunkerMainPoolBlockedHosts([
      "wss://relay.primal.net",
      "wss://nos.lol",
      "wss://relay.damus.io",
    ]);
    expect(
      filterBunkerBlockedRelays([
        "wss://relay.primal.net/",
        "wss://relay.gittr.space",
        "wss://nos.lol",
        "wss://eden.nostr.land",
      ])
    ).toEqual(["wss://relay.gittr.space", "wss://eden.nostr.land"]);
  });

  it("returns the original list when nothing is blocked", () => {
    const relays = ["wss://relay.primal.net", "wss://nos.lol"];
    expect(filterBunkerBlockedRelays(relays)).toEqual(relays);
  });

  it("returns empty when every relay is a bunker host", () => {
    setBunkerMainPoolBlockedHosts(["wss://relay.primal.net", "wss://nos.lol"]);
    expect(
      filterBunkerBlockedRelays(["wss://relay.primal.net", "wss://nos.lol/"])
    ).toEqual([]);
  });

  it("matches pool keys that differ only by trailing slash or case", () => {
    setBunkerMainPoolBlockedHosts(["wss://relay.primal.net", "wss://nos.lol"]);
    expect(
      collectBlockedRelayPoolUrls([
        "wss://relay.primal.net/",
        "wss://relay.gittr.space",
        "WSS://NOS.LOL",
      ])
    ).toEqual(["wss://relay.primal.net/", "WSS://NOS.LOL"]);
  });
});
