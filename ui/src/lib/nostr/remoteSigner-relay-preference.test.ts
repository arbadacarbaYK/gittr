import { describe, expect, it } from "vitest";

import {
  bunkerPublishIsThin,
  bunkerRelayPublishOverlap,
  expandBunkerRelays,
  getSessionUriRelays,
  nip46PrimaryEncryption,
  nip46ShouldDualPublish,
  preferUriOpenRelays,
  recoverUriRelaysFromPossiblyExpanded,
} from "./remoteSigner";

describe("expandBunkerRelays", () => {
  it("keeps URI relays first and appends Amber defaults", () => {
    const expanded = expandBunkerRelays(["wss://relay.primal.net/"]);
    expect(expanded[0]).toBe("wss://relay.primal.net");
    expect(expanded).toContain("wss://nos.lol");
    expect(expanded).toContain("wss://theforest.nostr1.com");
    expect(expanded).toContain("wss://nostr.oxtr.dev");
    expect(expanded[expanded.length - 1]).toBe("wss://relay.damus.io");
  });

  it("orders AmberSettings defaults before nos.lol and Damus", () => {
    const expanded = expandBunkerRelays([]);
    expect(expanded.slice(0, 3)).toEqual([
      "wss://nostr.oxtr.dev",
      "wss://theforest.nostr1.com",
      "wss://relay.primal.net",
    ]);
    expect(expanded.indexOf("wss://nos.lol")).toBeGreaterThan(
      expanded.indexOf("wss://relay.primal.net")
    );
    expect(expanded[expanded.length - 1]).toBe("wss://relay.damus.io");
    expect(expanded).not.toContain("wss://relay.gittr.space");
  });

  it("excludes GRASP / gittr Pyramid hosts", () => {
    const expanded = expandBunkerRelays([
      "wss://relay.primal.net",
      "wss://relay.gittr.space",
    ]);
    expect(expanded).not.toContain("wss://relay.gittr.space");
    expect(expanded[0]).toBe("wss://relay.primal.net");
  });

  it("caps at 8 relays", () => {
    const many = [
      "wss://a.example",
      "wss://b.example",
      "wss://c.example",
      "wss://d.example",
      "wss://e.example",
      "wss://f.example",
      "wss://g.example",
      "wss://h.example",
      "wss://i.example",
    ];
    expect(expandBunkerRelays(many)).toHaveLength(8);
  });
});

describe("recoverUriRelaysFromPossiblyExpanded", () => {
  it("recovers thin URI prefix from a persisted expanded list", () => {
    const expanded = expandBunkerRelays(["wss://relay.primal.net"]);
    expect(recoverUriRelaysFromPossiblyExpanded(expanded)).toEqual([
      "wss://relay.primal.net",
    ]);
  });

  it("keeps multi-relay URI when that is the shortest covering prefix", () => {
    const uri = ["wss://nos.lol", "wss://theforest.nostr1.com"];
    const expanded = expandBunkerRelays(uri);
    // Shortest covering prefix may be just nos.lol when expand(nos.lol)
    // already includes theforest via defaults — prefer that over polluted full list.
    const recovered = recoverUriRelaysFromPossiblyExpanded(expanded);
    expect(recovered.length).toBeGreaterThan(0);
    expect(recovered[0]).toBe("wss://nos.lol");
    expect(recovered).not.toContain("wss://relay.damus.io");
  });
});

describe("preferUriOpenRelays", () => {
  it("prefers OPEN sockets that intersect URI relays", () => {
    expect(
      preferUriOpenRelays(
        ["wss://relay.damus.io", "wss://relay.primal.net", "wss://nos.lol"],
        ["wss://relay.primal.net"],
        2
      )
    ).toEqual(["wss://relay.primal.net"]);
  });

  it("falls back to any OPEN relay when no URI relay is open", () => {
    expect(
      preferUriOpenRelays(
        ["wss://relay.damus.io/", "wss://nos.lol"],
        ["wss://relay.primal.net"],
        2
      )
    ).toEqual(["wss://relay.damus.io", "wss://nos.lol"]);
  });

  it("returns every OPEN URI relay up to the default cap (not just 2)", () => {
    expect(
      preferUriOpenRelays(
        [
          "wss://nostr.oxtr.dev",
          "wss://theforest.nostr1.com",
          "wss://relay.primal.net",
          "wss://nos.lol",
        ],
        [
          "wss://nostr.oxtr.dev",
          "wss://theforest.nostr1.com",
          "wss://relay.primal.net",
          "wss://nos.lol",
          "wss://relay.damus.io",
          "wss://a.example",
          "wss://b.example",
        ]
      )
    ).toEqual([
      "wss://nostr.oxtr.dev",
      "wss://theforest.nostr1.com",
      "wss://relay.primal.net",
      "wss://nos.lol",
    ]);
  });
});

describe("getSessionUriRelays", () => {
  it("uses uriRelays when present", () => {
    expect(
      getSessionUriRelays({
        uriRelays: ["wss://relay.primal.net/"],
        relays: ["wss://nos.lol", "wss://relay.damus.io"],
      })
    ).toEqual(["wss://relay.primal.net"]);
  });

  it("recovers from expanded relays when uriRelays missing", () => {
    const expanded = expandBunkerRelays(["wss://theforest.nostr1.com"]);
    expect(getSessionUriRelays({ relays: expanded })).toEqual([
      "wss://theforest.nostr1.com",
    ]);
  });
});

describe("bunkerRelayPublishOverlap", () => {
  it("reports overlap between published and URI relays", () => {
    const result = bunkerRelayPublishOverlap(
      ["wss://nos.lol", "wss://relay.damus.io"],
      ["wss://relay.primal.net", "wss://nos.lol"]
    );
    expect(result.hasOverlap).toBe(true);
    expect(result.overlap).toEqual(["wss://nos.lol"]);
    expect(result.publishedOnly).toEqual(["wss://relay.damus.io"]);
    expect(result.uriOnly).toEqual(["wss://relay.primal.net"]);
  });

  it("detects no overlap (Amber miss)", () => {
    const result = bunkerRelayPublishOverlap(
      ["wss://relay.damus.io"],
      ["wss://relay.primal.net"]
    );
    expect(result.hasOverlap).toBe(false);
    expect(result.overlap).toEqual([]);
  });

  it("treats 1 of 7 Amber URI relays as a thin publish", () => {
    const uri = [
      "wss://nostr.oxtr.dev",
      "wss://theforest.nostr1.com",
      "wss://relay.primal.net",
      "wss://nos.lol",
      "wss://relay.damus.io",
      "wss://a.example",
      "wss://b.example",
    ];
    expect(bunkerPublishIsThin(["wss://nostr.oxtr.dev"], uri)).toBe(true);
    expect(
      bunkerPublishIsThin(
        [
          "wss://nostr.oxtr.dev",
          "wss://theforest.nostr1.com",
          "wss://relay.primal.net",
        ],
        uri
      )
    ).toBe(false);
  });
});

describe("nip46 encryption preference", () => {
  it("sends NIP-04 first for sign_event so Amber can decrypt the prompt", () => {
    expect(nip46PrimaryEncryption("sign_event")).toBe("nip04");
    expect(nip46ShouldDualPublish("sign_event")).toBe(true);
  });

  it("uses the same Amber wrap for encrypt/decrypt RPC", () => {
    expect(nip46PrimaryEncryption("nip04_encrypt")).toBe("nip04");
    expect(nip46PrimaryEncryption("nip44_encrypt")).toBe("nip04");
    expect(nip46ShouldDualPublish("nip04_decrypt")).toBe(true);
    expect(nip46ShouldDualPublish("nip44_decrypt")).toBe(true);
  });

  it("keeps NIP-44 primary for connect / get_public_key and still dual-publishes", () => {
    expect(nip46PrimaryEncryption("connect")).toBe("nip44");
    expect(nip46PrimaryEncryption("get_public_key")).toBe("nip44");
    expect(nip46ShouldDualPublish("connect")).toBe(true);
    expect(nip46ShouldDualPublish("get_public_key")).toBe(true);
  });
});
