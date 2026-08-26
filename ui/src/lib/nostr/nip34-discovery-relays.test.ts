import { describe, expect, it } from "vitest";

import {
  NIP34_DISCOVERY_RELAYS,
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
