import { describe, expect, it } from "vitest";

import {
  GITTR_BUNKER_RELAY,
  PRIMAL_BUNKER_RELAYS,
  bunkerPublishIsThin,
  bunkerRelayIsOpen,
  bunkerRelayPublishOverlap,
  bunkerRelayShouldKeepWaiting,
  bunkerRescueRelays,
  bunkerRetryAfterMiss,
  confirmedPublishUrls,
  expandBunkerRelays,
  getNip46PairingRelays,
  getSessionUriRelays,
  mergeSignerPublishRelays,
  nip46PrimaryEncryption,
  nip46ShouldDualPublish,
  planBunkerDialWaves,
  planSignEventDialOrder,
  preferUriOpenRelays,
  primalSignRelayTargets,
  recoverUriRelaysFromPossiblyExpanded,
  sessionUsesNostrConnect,
  signEventPublishNeedsAnotherDial,
  signRequestLeftTheBrowser,
  signTimeoutUserMessage,
  signerBunkerRelays,
} from "./remoteSigner";

describe("planBunkerDialWaves", () => {
  it("dials another signer's relays before Amber's extras", () => {
    const waves = planBunkerDialWaves([
      "wss://relay.example.com",
      "wss://other.example.com",
    ]);
    expect(waves.first.slice(0, 3)).toEqual([
      GITTR_BUNKER_RELAY,
      "wss://relay.example.com",
      "wss://other.example.com",
    ]);
    expect(waves.retry[0]).toBe("wss://purplepag.es");
    expect(waves.first.some((u) => waves.retry.includes(u))).toBe(false);
  });

  it("keeps the saved relays even when the list is long", () => {
    const waves = planBunkerDialWaves([
      "wss://a.example",
      "wss://b.example",
      "wss://c.example",
      "wss://d.example",
      "wss://e.example",
    ]);
    expect(waves.first[0]).toBe(GITTR_BUNKER_RELAY);
    expect(waves.first[1]).toBe("wss://a.example");
    expect(waves.first).toContain("wss://e.example");
  });

  it("skips relays that do not open and still dials the ones Amber has connected", () => {
    const waves = planBunkerDialWaves([
      "wss://relay.primal.net",
      "wss://nos.lol",
      "wss://theforest.nostr1.com",
      "wss://nostr.oxtr.dev",
      "wss://relay.damus.io",
      "wss://relay.azzamo.net",
      "wss://purplepag.es",
    ]);
    expect(waves.first.slice(0, 4)).toEqual([
      GITTR_BUNKER_RELAY,
      "wss://relay.primal.net",
      "wss://theforest.nostr1.com",
      "wss://relay.damus.io",
    ]);
    expect(waves.first).toContain("wss://bucket.coracle.social");
    expect(waves.first).toContain("wss://nrs.primal.net");
    expect(waves.first).not.toContain("wss://nos.lol");
    expect(waves.first).not.toContain("wss://nostr.oxtr.dev");
    expect(waves.first).not.toContain("wss://purplepag.es");
  });

  it("starts from Amber's connected relays when the session has no URI relays", () => {
    const waves = planBunkerDialWaves([]);
    expect(waves.first).toEqual([
      GITTR_BUNKER_RELAY,
      "wss://bucket.coracle.social",
      "wss://nrs.primal.net",
      "wss://relay.primal.net",
      "wss://relay.nip46.com",
      "wss://theforest.nostr1.com",
      "wss://relay.ditto.pub",
    ]);
    expect(waves.retry).toEqual([
      "wss://purplepag.es",
      "wss://profiles.nostr1.com",
      "wss://user.kindpag.es",
    ]);
  });
});

describe("planSignEventDialOrder", () => {
  it("dials Amber's connected relays first and leaves closed hosts out of the cap", () => {
    const order = planSignEventDialOrder([
      "wss://relay.primal.net",
      "wss://theforest.nostr1.com",
      "wss://nostr.oxtr.dev",
      "wss://relay.damus.io",
      "wss://nos.lol",
      "wss://bucket.coracle.social",
      "wss://relay.gittr.space",
    ]);
    expect(order).toEqual([
      GITTR_BUNKER_RELAY,
      "wss://bucket.coracle.social",
      "wss://relay.primal.net",
      "wss://theforest.nostr1.com",
      "wss://relay.damus.io",
      "wss://nrs.primal.net",
      "wss://relay.nip46.com",
      "wss://relay.ditto.pub",
    ]);
  });
});

describe("sign timeout copy", () => {
  const uri = [
    "wss://relay.gittr.space",
    "wss://nos.lol",
    "wss://theforest.nostr1.com",
    "wss://relay.primal.net",
    "wss://nostr.oxtr.dev",
    "wss://relay.damus.io",
    "wss://bucket.coracle.social",
  ];

  it("treats a full dial as the phone when Amber stays quiet", () => {
    expect(signRequestLeftTheBrowser(uri, uri)).toBe(true);
    expect(signRequestLeftTheBrowser(["wss://relay.gittr.space"], uri)).toBe(
      false
    );
    const msg = signTimeoutUserMessage({
      publishedUrls: uri,
      uriRelays: uri,
      attemptedUrls: uri,
    });
    expect(msg).toContain("all 7 bunker relays");
    expect(msg).toContain("Orbot");
    expect(msg).toContain("already delivered");
  });

  it("still blames the phone when every relay was tried and only some opened", () => {
    const msg = signTimeoutUserMessage({
      publishedUrls: ["wss://relay.gittr.space", "wss://nos.lol"],
      uriRelays: uri,
      attemptedUrls: uri,
    });
    expect(msg).toContain("2 of 7");
    expect(msg).toContain("Orbot");
  });

  it("says the miss is gittr when only one relay was tried", () => {
    const msg = signTimeoutUserMessage({
      publishedUrls: ["wss://nostr.oxtr.dev"],
      uriRelays: uri,
      attemptedUrls: ["wss://nostr.oxtr.dev"],
    });
    expect(msg).toContain("only delivered the signing request to 1 of 7");
    expect(msg).not.toContain("Orbot");
  });
});

describe("bunkerRescueRelays", () => {
  it("tries Amber defaults that the first wave did not already dial", () => {
    expect(
      bunkerRescueRelays([
        "wss://relay.primal.net",
        "wss://nos.lol",
        "wss://theforest.nostr1.com",
        "wss://nostr.oxtr.dev",
        "wss://relay.damus.io",
        "wss://relay.azzamo.net",
        "wss://purplepag.es",
      ])
    ).toEqual([
      "wss://relay.ditto.pub",
      "wss://auth.nostr1.com",
      "wss://purplepag.es",
      "wss://profiles.nostr1.com",
    ]);
  });

  it("retries gittr and the paired relays before a dead extra default", () => {
    const uri = [
      "wss://relay.primal.net",
      "wss://nos.lol",
      "wss://theforest.nostr1.com",
      "wss://nostr.oxtr.dev",
      "wss://relay.damus.io",
      "wss://relay.azzamo.net",
      "wss://purplepag.es",
    ];
    expect(bunkerRetryAfterMiss(uri)).toEqual([
      GITTR_BUNKER_RELAY,
      "wss://relay.primal.net",
      "wss://theforest.nostr1.com",
      "wss://relay.damus.io",
    ]);
  });
});

describe("expandBunkerRelays", () => {
  it("keeps URI relays first and appends Amber defaults", () => {
    const expanded = expandBunkerRelays(["wss://relay.primal.net/"]);
    expect(expanded[0]).toBe("wss://relay.primal.net");
    expect(expanded).toContain(GITTR_BUNKER_RELAY);
    expect(expanded).toContain("wss://nrs.primal.net");
    expect(expanded).not.toContain("wss://directory.yabu.me");
    expect(expanded).not.toContain("wss://nos.lol");
    expect(expanded[expanded.length - 1]).toBe("wss://relay.damus.io");
  });

  it("orders Amber's connected relays, with gittr first when the link is empty", () => {
    const expanded = expandBunkerRelays([]);
    expect(expanded.slice(0, 4)).toEqual([
      GITTR_BUNKER_RELAY,
      "wss://bucket.coracle.social",
      "wss://nrs.primal.net",
      "wss://relay.primal.net",
    ]);
    expect(expanded[expanded.length - 1]).toBe("wss://relay.damus.io");
    expect(expanded).not.toContain("wss://nos.lol");
  });

  it("keeps relay.gittr.space and drops the git-only host", () => {
    const expanded = expandBunkerRelays([
      "wss://relay.primal.net",
      "wss://relay.gittr.space",
      "wss://git.gittr.space",
    ]);
    expect(expanded).toContain(GITTR_BUNKER_RELAY);
    expect(expanded).not.toContain("wss://git.gittr.space");
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
    const recovered = recoverUriRelaysFromPossiblyExpanded(expanded);
    expect(recovered).toEqual(["wss://theforest.nostr1.com"]);
    expect(expanded).not.toContain("wss://nos.lol");
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

  it("keeps relay.gittr.space on the Amber session", () => {
    expect(
      getSessionUriRelays({
        uriRelays: ["wss://relay.gittr.space/", "wss://nos.lol"],
      })
    ).toEqual([GITTR_BUNKER_RELAY, "wss://nos.lol"]);
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

describe("Primal nostrconnect relays", () => {
  it("puts Primal's bunker relays in the login QR ahead of filler relays", () => {
    const relays = getNip46PairingRelays([
      "wss://relay.gittr.space",
      "wss://nos.lol",
    ]);
    expect(relays).toEqual([
      GITTR_BUNKER_RELAY,
      "wss://bucket.coracle.social",
      "wss://nrs.primal.net",
      "wss://relay.primal.net",
      "wss://relay.nip46.com",
    ]);
    expect(relays).not.toContain("wss://nos.lol");
    expect(relays).not.toContain("wss://relay.damus.io");
  });

  it("still treats an old QR session as nostrconnect after pairing clears the temporary flag", () => {
    expect(
      sessionUsesNostrConnect({
        nostrConnectPairing: false,
        uriRelays: [
          "wss://purplepag.es",
          "wss://directory.yabu.me",
          "wss://profiles.nostr1.com",
          "wss://user.kindpag.es",
          "wss://relay.damus.io",
        ],
      })
    ).toBe(true);
    expect(
      sessionUsesNostrConnect({
        uriRelays: ["wss://relay.gittr.space", "wss://nos.lol"],
      })
    ).toBe(false);
  });

  it("dials Primal first on sign_event without dropping the saved QR relays", () => {
    const saved = [
      "wss://purplepag.es",
      "wss://directory.yabu.me",
      "wss://profiles.nostr1.com",
      "wss://user.kindpag.es",
      "wss://relay.damus.io",
    ];
    const order = planSignEventDialOrder(saved, { nostrConnect: true });
    expect(order.slice(0, 2)).toEqual([...PRIMAL_BUNKER_RELAYS]);
    expect(order).toContain("wss://relay.damus.io");
    expect(order).not.toContain("wss://directory.yabu.me");
    expect(signerBunkerRelays(saved, true).slice(0, 2)).toEqual([
      ...PRIMAL_BUNKER_RELAYS,
    ]);
  });

  it("does not count one relay OK as every bunker relay", () => {
    const targets = [
      "wss://relay.primal.net",
      "wss://nos.lol",
      "wss://relay.gittr.space",
    ];
    expect(
      confirmedPublishUrls({
        publishTargets: targets,
        okRelays: ["wss://nos.lol"],
      })
    ).toEqual({ urls: ["wss://nos.lol"], acked: true });
    expect(
      confirmedPublishUrls({ publishTargets: targets, okRelays: [] }).acked
    ).toBe(false);
  });

  it("redials when Primal's relay did not accept the request", () => {
    const uri = signerBunkerRelays(
      ["wss://purplepag.es", "wss://nos.lol", "wss://theforest.nostr1.com"],
      true
    );
    expect(
      signEventPublishNeedsAnotherDial({
        method: "sign_event",
        acked: true,
        publishedUrls: [
          "wss://nos.lol",
          "wss://purplepag.es",
          "wss://theforest.nostr1.com",
        ],
        uriRelays: uri,
        nostrConnect: true,
      })
    ).toBe(true);
    expect(
      signEventPublishNeedsAnotherDial({
        method: "sign_event",
        acked: true,
        publishedUrls: ["wss://relay.primal.net"],
        uriRelays: uri,
        nostrConnect: true,
      })
    ).toBe(false);
  });
});

describe("nip46 encryption preference", () => {
  it("sends NIP-04 first for sign_event so Amber can decrypt the prompt", () => {
    expect(nip46PrimaryEncryption("sign_event")).toBe("nip04");
    expect(nip46ShouldDualPublish("sign_event")).toBe(false);
  });

  it("keeps Amber on NIP-04 and sends NIP-44 only toward Primal's relays", () => {
    expect(nip46PrimaryEncryption("sign_event")).toBe("nip04");
    expect(nip46ShouldDualPublish("sign_event")).toBe(false);
    expect(
      primalSignRelayTargets(
        ["wss://nos.lol", "wss://relay.primal.net", "wss://relay.nip46.com"],
        true
      )
    ).toEqual(["wss://relay.primal.net", "wss://relay.nip46.com"]);
    expect(primalSignRelayTargets(["wss://relay.primal.net"], false)).toEqual(
      []
    );
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

describe("mergeSignerPublishRelays", () => {
  it("adds the signer's relays and drops hosts that do not open", () => {
    expect(
      mergeSignerPublishRelays(
        ["wss://relay.gittr.space", "wss://git.shakespeare.diy"],
        [
          "wss://nos.lol",
          "wss://relay.damus.io",
          "wss://nostr.oxtr.dev/",
          "wss://relay.gittr.space",
        ]
      )
    ).toEqual([
      "wss://relay.gittr.space",
      "wss://git.shakespeare.diy",
      "wss://relay.damus.io",
    ]);
  });
});

describe("bunker socket readyState", () => {
  it("treats only OPEN as ready and only CONNECTING as waitable", () => {
    expect(bunkerRelayIsOpen(1)).toBe(true);
    expect(bunkerRelayIsOpen(0)).toBe(false);
    expect(bunkerRelayIsOpen(3)).toBe(false);
    expect(bunkerRelayShouldKeepWaiting(0)).toBe(true);
    expect(bunkerRelayShouldKeepWaiting(1)).toBe(false);
    expect(bunkerRelayShouldKeepWaiting(2)).toBe(false);
    expect(bunkerRelayShouldKeepWaiting(3)).toBe(false);
    expect(bunkerRelayShouldKeepWaiting(undefined)).toBe(false);
  });
});
