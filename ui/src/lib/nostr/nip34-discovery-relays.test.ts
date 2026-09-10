import { describe, expect, it } from "vitest";

import {
  NIP34_DISCOVERY_RELAYS,
  extraNostrRelaysFromRepoRemotes,
  profileRepoRelaysForClient,
} from "./nip34-discovery-relays";

describe("profileRepoRelaysForClient", () => {
  it("always includes NIP-34 discovery hosts even when the app list is empty", () => {
    const relays = profileRepoRelaysForClient([]);
    expect(relays).toEqual(NIP34_DISCOVERY_RELAYS);
  });

  it("prepends the visitor's app relays without duplicating discovery hosts", () => {
    const relays = profileRepoRelaysForClient([
      "wss://relay.damus.io",
      "wss://relay.ngit.dev",
    ]);
    expect(relays[0]).toBe("wss://relay.damus.io");
    expect(relays.filter((u) => u === "wss://relay.ngit.dev")).toHaveLength(1);
    expect(relays).toContain("wss://git.shakespeare.diy");
  });
});

describe("extraNostrRelaysFromRepoRemotes", () => {
  it("turns announcement relays and clone hosts into wss lookup relays", () => {
    const npub =
      "npub1k0y4eceal2zryes3azm6nsgt0r0jsa2v8zcsdf9uqxttn0jlfe9q04c9h8";
    expect(
      extraNostrRelaysFromRepoRemotes({
        relays: ["wss://relay.poster.place"],
        clone: [`https://relay.poster.place/${npub}/project-brutality-xdc.git`],
      })
    ).toEqual(["wss://relay.poster.place"]);
  });

  it("does not treat GitHub as a Nostr relay", () => {
    expect(
      extraNostrRelaysFromRepoRemotes({
        clone: ["https://github.com/org/repo.git"],
      })
    ).toEqual([]);
  });

  it("does not turn home / Tailscale remotes into browser WebSockets", () => {
    expect(
      extraNostrRelaysFromRepoRemotes({
        relays: [
          "wss://umbrel.local:4848",
          "wss://umbrel.tail51469b.ts.net:4848",
        ],
        clone: ["https://umbrel.local:2222/npub1abc/backstory.git"],
      })
    ).toEqual([]);
  });

  it("still dials the owner's public custom relays (Code tab needs those)", () => {
    expect(
      extraNostrRelaysFromRepoRemotes({
        relays: [
          "wss://git.shakespeare.diy/",
          "wss://relay.orangepill.dev/",
          "wss://atlas.nostr.land/",
          "wss://umbrel.local:4848/",
          "wss://umbrel.tail51469b.ts.net:4848/",
          "wss://relay.stewlab.win/",
        ],
      })
    ).toEqual([
      "wss://git.shakespeare.diy",
      "wss://relay.orangepill.dev",
      "wss://atlas.nostr.land",
      "wss://relay.stewlab.win",
    ]);
  });
});
