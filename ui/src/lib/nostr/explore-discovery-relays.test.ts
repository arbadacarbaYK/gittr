import { describe, expect, it } from "vitest";

import {
  exploreDeferredSocialRelays,
  exploreImmediateDiscoveryRelays,
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
    expect(isUsableExploreDiscoveryRelay("wss://umbrel.local:4848")).toBe(
      false
    );
    expect(
      isUsableExploreDiscoveryRelay("wss://umbrel.tail51469b.ts.net:4848")
    ).toBe(false);
  });

  it("rejects dead GRASP sockets and /grasp git paths", () => {
    expect(isUsableExploreDiscoveryRelay("wss://git-01.uid.ovh/")).toBe(false);
    expect(isUsableExploreDiscoveryRelay("wss://ngit-relay.nostrver.se/")).toBe(
      false
    );
    expect(isUsableExploreDiscoveryRelay("wss://laantungir.net/grasp")).toBe(
      false
    );
    expect(isUsableExploreDiscoveryRelay("wss://relay.nostrich.land/")).toBe(
      false
    );
    expect(isUsableExploreDiscoveryRelay("wss://relay.poster.place/")).toBe(
      false
    );
  });

  it("rejects danconway auto-dial and non-default ports from event tags", () => {
    expect(isUsableExploreDiscoveryRelay("wss://ngit.danconwaydev.com")).toBe(
      false
    );
    expect(
      isUsableExploreDiscoveryRelay("wss://ngit.danconwaydev.com:8081/")
    ).toBe(false);
    expect(
      isUsableExploreDiscoveryRelay("ws://ngit.danconwaydev.com:8081")
    ).toBe(false);
    const seen = new Set<string>();
    expect(
      rememberExploreDiscoveryRelay("wss://ngit.danconwaydev.com:8081/", seen)
    ).toBe(null);
  });

  it("does not put danconway on the Explore subscribe list even if env has it", () => {
    const relays = exploreRepoRelaysForClient([
      "wss://ngit.danconwaydev.com",
      "wss://relay.gittr.space",
    ]);
    expect(relays.some((u) => u.includes("danconway"))).toBe(false);
    expect(relays[0]).toBe("wss://relay.gittr.space");
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

describe("exploreImmediateDiscoveryRelays", () => {
  it("dials NIP-34 hosts even when env is empty", () => {
    const relays = exploreImmediateDiscoveryRelays([]);
    expect(relays).toContain("wss://relay.ngit.dev");
    expect(relays).toContain("wss://git.shakespeare.diy");
    expect(relays).toContain("wss://git.nostrhub.io");
    expect(relays.some((u) => u.includes("damus"))).toBe(false);
  });

  it("keeps Damus off the first subscribe when env is the full app list", () => {
    const env = [
      "wss://relay.gittr.space",
      "wss://git.shakespeare.diy",
      "wss://relay.ngit.dev",
      "wss://git.nostrhub.io",
      "wss://relay.damus.io",
      "wss://nostr.wine",
    ];
    const immediate = exploreImmediateDiscoveryRelays(env);
    expect(immediate).toContain("wss://git.shakespeare.diy");
    expect(immediate).toContain("wss://git.nostrhub.io");
    expect(immediate).not.toContain("wss://relay.damus.io");
    expect(immediate).not.toContain("wss://nostr.wine");
    const deferred = exploreDeferredSocialRelays(env);
    expect(deferred).toContain("wss://relay.damus.io");
    expect(deferred).toContain("wss://nostr.wine");
  });
});
