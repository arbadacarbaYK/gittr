import { describe, expect, it, beforeEach } from "vitest";

import {
  isBunkerMainPoolBlocked,
  listBunkerMainPoolBlockedHosts,
  setBunkerMainPoolBlockedHosts,
} from "./bunker-main-pool-guard";

describe("bunker-main-pool-guard", () => {
  beforeEach(() => {
    setBunkerMainPoolBlockedHosts(null);
  });

  it("blocks normalized bunker hosts while set", () => {
    setBunkerMainPoolBlockedHosts([
      "wss://relay.primal.net/",
      "wss://nos.lol",
    ]);
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
});
