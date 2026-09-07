import { describe, expect, it } from "vitest";

import {
  exploreRepoRelaysForClient,
  isUsableExploreDiscoveryRelay,
  rememberExploreDiscoveryRelay,
} from "./explore-discovery-relays";
import { NIP34_DISCOVERY_RELAYS } from "./nip34-discovery-relays";

describe("isUsableExploreDiscoveryRelay", () => {
  it("accepts real git / Nostr relays", () => {
    expect(isUsableExploreDiscoveryRelay("wss://relay.ngit.dev")).toBe(true);
    expect(isUsableExploreDiscoveryRelay("wss://git.shakespeare.diy/")).toBe(
      true
    );
    expect(isUsableExploreDiscoveryRelay("wss://git.nostrhub.io")).toBe(true);
  });

  it("rejects websites, git HTTPS hosts, and forges listed as relays", () => {
    expect(isUsableExploreDiscoveryRelay("wss://gitworkshop.dev")).toBe(false);
    expect(isUsableExploreDiscoveryRelay("wss://git.gittr.space")).toBe(false);
    expect(isUsableExploreDiscoveryRelay("https://gitworkshop.dev/")).toBe(
      false
    );
    expect(isUsableExploreDiscoveryRelay("wss://github.com")).toBe(false);
    expect(isUsableExploreDiscoveryRelay("wss://localhost")).toBe(false);
  });
});

describe("rememberExploreDiscoveryRelay", () => {
  it("subscribes once per host even when trailing slashes differ", () => {
    const seen = new Set<string>();
    expect(rememberExploreDiscoveryRelay("wss://relay.ngit.dev/", seen)).toBe(
      "wss://relay.ngit.dev"
    );
    expect(rememberExploreDiscoveryRelay("wss://relay.ngit.dev", seen)).toBe(
      null
    );
    expect(seen.size).toBe(1);
  });

  it("does not record junk URLs", () => {
    const seen = new Set<string>();
    expect(rememberExploreDiscoveryRelay("wss://gitworkshop.dev/", seen)).toBe(
      null
    );
    expect(seen.size).toBe(0);
  });
});

describe("exploreRepoRelaysForClient", () => {
  it("includes NIP-34 discovery hosts even when the app list is only gittr", () => {
    const relays = exploreRepoRelaysForClient(["wss://relay.gittr.space"]);
    expect(relays[0]).toBe("wss://relay.gittr.space");
    expect(relays).toContain("wss://git.nostrhub.io");
    expect(relays).toContain("wss://git.shakespeare.diy");
    expect(relays).toContain("wss://relay.ngit.dev");
    for (const url of NIP34_DISCOVERY_RELAYS) {
      expect(relays).toContain(url.replace(/\/+$/, ""));
    }
  });

  it("puts GRASP hosts ahead of general social relays and dedupes", () => {
    const relays = exploreRepoRelaysForClient([
      "wss://relay.damus.io",
      "wss://relay.ngit.dev",
      "wss://relay.ngit.dev/",
    ]);
    const ngit = relays.indexOf("wss://relay.ngit.dev");
    const damus = relays.indexOf("wss://relay.damus.io");
    expect(ngit).toBeGreaterThanOrEqual(0);
    expect(damus).toBeGreaterThan(ngit);
    expect(relays.filter((u) => u === "wss://relay.ngit.dev")).toHaveLength(1);
  });

  it("never queues gitworkshop or git.gittr.space as wss relays", () => {
    const relays = exploreRepoRelaysForClient([
      "wss://gitworkshop.dev",
      "wss://git.gittr.space",
      "wss://relay.gittr.space",
    ]);
    expect(relays.some((u) => u.includes("gitworkshop"))).toBe(false);
    expect(relays.some((u) => u.includes("git.gittr.space"))).toBe(false);
    expect(relays).toContain("wss://relay.gittr.space");
  });
});
