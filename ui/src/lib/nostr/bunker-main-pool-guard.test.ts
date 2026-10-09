import { beforeEach, describe, expect, it } from "vitest";

import {
  bunkerDialSettleMs,
  collectActiveMainPoolUrls,
  collectBlockedRelayPoolUrls,
  collectMainPoolUrlsToSuspend,
  silenceRelayPoolInstance,
  consumeDeferredMainPoolRelays,
  filterBunkerBlockedRelays,
  holdMainPoolForColdBunkerStart,
  isBunkerMainPoolBlocked,
  isMainPoolPausedForBunker,
  listBunkerMainPoolBlockedHosts,
  MAIN_POOL_PAUSE_WAIT_MS,
  mainPoolSubscribeShouldWait,
  onMainPoolUnpaused,
  popMainPoolBunkerPause,
  pushMainPoolBunkerPause,
  releaseColdBunkerStartHold,
  resetMainPoolBunkerPauseForTests,
  setBunkerMainPoolBlockedHosts,
} from "./bunker-main-pool-guard";

describe("bunker-main-pool-guard", () => {
  beforeEach(() => {
    setBunkerMainPoolBlockedHosts(null);
    resetMainPoolBunkerPauseForTests();
  });

  it("keeps a subscribe waiting for a pause that starts long after page load", () => {
    const pageLoad = 0;
    const deleteClick = pageLoad + 20_000;
    expect(
      mainPoolSubscribeShouldWait(true, deleteClick, deleteClick + 1000)
    ).toBe(true);
    expect(
      mainPoolSubscribeShouldWait(
        true,
        deleteClick,
        deleteClick + MAIN_POOL_PAUSE_WAIT_MS
      )
    ).toBe(false);
    expect(mainPoolSubscribeShouldWait(false, deleteClick, deleteClick)).toBe(
      false
    );
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

  it("suspends CLOSED relays too — they reconnect on their own", () => {
    const statuses: Array<[string, number]> = [
      ["wss://relay.gittr.space", 1],
      ["wss://nos.lol", 3],
      ["wss://relay.damus.io", 0],
    ];
    expect(collectActiveMainPoolUrls(statuses)).toEqual([
      "wss://relay.gittr.space",
      "wss://relay.damus.io",
    ]);
    expect(collectMainPoolUrlsToSuspend(statuses)).toEqual([
      "wss://relay.gittr.space",
      "wss://nos.lol",
      "wss://relay.damus.io",
    ]);
  });

  it("waits longer after more aborted page sockets", () => {
    expect(bunkerDialSettleMs(0)).toBe(0);
    expect(bunkerDialSettleMs(1)).toBe(600);
    expect(bunkerDialSettleMs(21)).toBe(2600);
    expect(bunkerDialSettleMs(40)).toBe(3000);
  });

  it("stops a removed relay from reconnecting", () => {
    let opened = 0;
    const instance = {
      relay: {
        closedByClient: false,
        dontAutoReconnect: false,
        connect: async () => {
          opened += 1;
        },
      },
    };
    silenceRelayPoolInstance(instance);
    return instance.relay.connect().then(() => {
      expect(opened).toBe(0);
      expect(instance.relay.closedByClient).toBe(true);
      expect(instance.relay.dontAutoReconnect).toBe(true);
    });
  });

  it("collects CONNECTING, OPEN, and CLOSING sockets, not CLOSED", () => {
    expect(
      collectActiveMainPoolUrls([
        ["wss://relay.gittr.space", 1],
        ["wss://nos.lol", 0],
        ["wss://relay.damus.io", 3],
        ["wss://relay.primal.net", 2],
      ])
    ).toEqual([
      "wss://relay.gittr.space",
      "wss://nos.lol",
      "wss://relay.primal.net",
    ]);
  });

  it("holds page relays until the cold bunker warm releases them", () => {
    const seen: string[] = [];
    const stop = onMainPoolUnpaused(() => {
      seen.push(...consumeDeferredMainPoolRelays());
    });
    holdMainPoolForColdBunkerStart([
      "wss://relay.gittr.space",
      "wss://git.shakespeare.diy",
    ]);
    expect(isMainPoolPausedForBunker()).toBe(true);
    pushMainPoolBunkerPause();
    releaseColdBunkerStartHold();
    expect(isMainPoolPausedForBunker()).toBe(true);
    expect(seen).toEqual([]);
    popMainPoolBunkerPause();
    expect(isMainPoolPausedForBunker()).toBe(false);
    expect(seen).toEqual([
      "wss://relay.gittr.space",
      "wss://git.shakespeare.diy",
    ]);
    stop();
  });
});
