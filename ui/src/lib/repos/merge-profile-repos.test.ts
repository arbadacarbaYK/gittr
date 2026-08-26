import { describe, expect, it } from "vitest";

import {
  enrichNetworkProfileRepos,
  mergeProfileRepoFields,
  mergeProfileRepoList,
  preferRepoDisplayName,
  profileRepoCountLabel,
  profileRepoDisplayRole,
  toProfileRepoCard,
  unionProfileRepoCatalog,
} from "./merge-profile-repos";

describe("preferRepoDisplayName", () => {
  it("prefers a human title over the slug", () => {
    expect(preferRepoDisplayName("Nostr SDK", "nostr-sdk", "nostr-sdk")).toBe(
      "Nostr SDK"
    );
  });
});

describe("mergeProfileRepoFields", () => {
  it("keeps description and userRole when next is sparse", () => {
    const merged = mergeProfileRepoFields(
      {
        repo: "nostr",
        name: "nostr",
        ownerPubkey: "abc",
        lastNostrEventCreatedAt: 200,
      },
      {
        repo: "nostr",
        name: "Nostr Protocol",
        description: "A protocol for …",
        userRole: "owner",
        ownerPubkey: "abc",
        lastNostrEventCreatedAt: 100,
      }
    );
    expect(merged.description).toBe("A protocol for …");
    expect(merged.userRole).toBe("owner");
    expect(merged.name).toBe("Nostr Protocol");
    expect(merged.lastNostrEventCreatedAt).toBe(200);
  });
});

describe("mergeProfileRepoList", () => {
  it("does not wipe About text when API returns sparse rows", () => {
    const prev = [
      {
        repo: "nostr",
        slug: "nostr",
        name: "Nostr",
        description: "Nice about text",
        userRole: "owner",
        ownerPubkey:
          "68d81165918100b7da43fc28f7d1fc12554466e1115886b9e7bb326f65ec4272",
        lastNostrEventCreatedAt: 1784808479,
      },
    ];
    const next = [
      {
        repo: "nostr",
        slug: "nostr",
        name: "nostr",
        ownerPubkey:
          "68d81165918100b7da43fc28f7d1fc12554466e1115886b9e7bb326f65ec4272",
        lastNostrEventCreatedAt: 1784808479,
        syncedFromNostr: true,
        publicRead: true,
      },
    ];
    const merged = mergeProfileRepoList(prev, next);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.description).toBe("Nice about text");
    expect(merged[0]?.userRole).toBe("owner");
    expect(merged[0]?.name).toBe("Nostr");
  });

  it("adds API-only repos while keeping local-only ones", () => {
    const merged = mergeProfileRepoList(
      [
        {
          repo: "local-only",
          ownerPubkey: "aa",
          description: "keep me",
          userRole: "owner",
        },
      ],
      [
        {
          repo: "api-only",
          ownerPubkey: "aa",
          name: "api-only",
          description: "from nostr",
        },
      ]
    );
    expect(merged.map((r) => r.repo).sort()).toEqual([
      "api-only",
      "local-only",
    ]);
    expect(merged.find((r) => r.repo === "local-only")?.description).toBe(
      "keep me"
    );
  });

  it("matches a local npub entity stub to an API hex ownerPubkey row", () => {
    const ownerHex =
      "9a83779e75080556c656d4d418d02a4d7edbe288a2f9e6dd2b48799ec935184c";
    const entity =
      "npub1n2ph08n4pqz4d3jk6n2p35p2f4ldhc5g5tu7dhftfpueajf4rpxqfjhzmc";
    const merged = mergeProfileRepoList(
      [
        {
          repo: "andronixorigin",
          entity,
          status: "local",
          name: "andronixorigin",
        },
      ],
      [
        {
          repo: "andronixorigin",
          entity,
          ownerPubkey: ownerHex,
          lastNostrEventId: "ab".repeat(32),
          syncedFromNostr: true,
          sourceUrl: "https://github.com/AndronixApp/AndronixOrigin",
          description: "official backend",
        },
      ]
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]?.lastNostrEventId).toBe("ab".repeat(32));
    expect(merged[0]?.syncedFromNostr).toBe(true);
    expect(merged[0]?.sourceUrl).toBe(
      "https://github.com/AndronixApp/AndronixOrigin"
    );
    expect(merged[0]?.status).not.toBe("local");
    expect(merged[0]?.description).toBe("official backend");
  });
});

describe("profileRepoCountLabel", () => {
  it("shows an ellipsis while the first catalog rows are in flight", () => {
    expect(profileRepoCountLabel(0, true)).toBe("…");
  });

  it("marks a partial catalog as incomplete while more rows may arrive", () => {
    expect(profileRepoCountLabel(4, true)).toBe("4+");
  });

  it("shows the final count after the catalog settles", () => {
    expect(profileRepoCountLabel(102, false)).toBe("102");
  });
});

describe("unionProfileRepoCatalog", () => {
  const owner =
    "0461fcbecc4c3374439932d6b8f11269ccdb7cc973ad7a50ae362db135a474dd";

  it("keeps the larger catalog when a later scan returns fewer rows", () => {
    const many = [
      { repo: "ditto", ownerPubkey: owner, publicRead: true },
      { repo: "shakespeare", ownerPubkey: owner, publicRead: true },
    ];
    const few = [{ repo: "ditto", ownerPubkey: owner, publicRead: true }];
    expect(
      unionProfileRepoCatalog(many, few)
        .map((r) => r.repo)
        .sort()
    ).toEqual(["ditto", "shakespeare"]);
  });

  it("ignores an empty incoming scan instead of wiping", () => {
    const current = [{ repo: "marlowe", ownerPubkey: owner, publicRead: true }];
    expect(unionProfileRepoCatalog(current, [])).toHaveLength(1);
    expect(unionProfileRepoCatalog([], [])).toEqual([]);
  });

  it("adds newly discovered announcements", () => {
    const current = [{ repo: "marlowe", ownerPubkey: owner, publicRead: true }];
    const incoming = [
      { repo: "vidstr2", ownerPubkey: owner, publicRead: true },
    ];
    expect(
      unionProfileRepoCatalog(current, incoming)
        .map((r) => r.repo)
        .sort()
    ).toEqual(["marlowe", "vidstr2"]);
  });
});

describe("toProfileRepoCard", () => {
  it("marks a 30617 row as public and owned by the announcer", () => {
    const card = toProfileRepoCard({
      entity: "npub1example",
      repo: "marlowe",
      name: "Marlowe",
      ownerPubkey: "aa".repeat(32),
      lastActivity: 1,
      publicRead: true,
    });
    expect(card.repo).toBe("marlowe");
    expect(card.syncedFromNostr).toBe(true);
    expect(card.publicRead).toBe(true);
    expect(card.userRole).toBe("owner");
  });
});

describe("enrichNetworkProfileRepos", () => {
  const owner =
    "0461fcbecc4c3374439932d6b8f11269ccdb7cc973ad7a50ae362db135a474dd";

  it("does not add visitor-cache repos that the catalog never announced", () => {
    const local = [
      { repo: "npkg", ownerPubkey: owner, description: "cached" },
      { repo: "only-in-my-browser", ownerPubkey: owner },
    ];
    const network = [
      {
        repo: "npkg",
        ownerPubkey: owner,
        syncedFromNostr: true,
        publicRead: true,
      },
      {
        repo: "soapbox.pub",
        ownerPubkey: owner,
        syncedFromNostr: true,
        publicRead: true,
      },
    ];
    const merged = enrichNetworkProfileRepos(network, local);
    expect(merged.map((r) => r.repo).sort()).toEqual(["npkg", "soapbox.pub"]);
    expect(merged.find((r) => r.repo === "npkg")?.description).toBe("cached");
  });

  it("stays empty until the catalog returns — same for any visitor", () => {
    expect(
      enrichNetworkProfileRepos(
        [],
        [{ repo: "npkg", ownerPubkey: owner, description: "cached" }]
      )
    ).toEqual([]);
  });

  it("does not list private announcements on the public profile", () => {
    const merged = enrichNetworkProfileRepos(
      [
        {
          repo: "secret",
          ownerPubkey: owner,
          publicRead: false,
          syncedFromNostr: true,
        },
        {
          repo: "public",
          ownerPubkey: owner,
          publicRead: true,
          syncedFromNostr: true,
        },
      ],
      []
    );
    expect(merged.map((r) => r.repo)).toEqual(["public"]);
  });
});

describe("profileRepoDisplayRole", () => {
  const hex =
    "68d81165918100b7da43fc28f7d1fc12554466e1115886b9e7bb326f65ec4272";

  it("keeps an explicit stored maintainer role when this profile did not announce", () => {
    expect(
      profileRepoDisplayRole(
        { userRole: "maintainer", ownerPubkey: "aa".repeat(32) },
        hex
      )
    ).toBe("maintainer");
  });

  it("treats a matching ownerPubkey as owner when userRole is missing", () => {
    expect(profileRepoDisplayRole({ ownerPubkey: hex }, hex)).toBe("owner");
  });

  it("does not invent a role when the announce is someone else's", () => {
    expect(
      profileRepoDisplayRole({ ownerPubkey: "aa".repeat(32) }, hex)
    ).toBeUndefined();
  });

  it("does not treat a self-import GitHub URL as forked", () => {
    expect(
      profileRepoDisplayRole(
        {
          ownerPubkey: hex,
          userRole: "forked",
          sourceUrl: "https://github.com/me/gittr",
          forkedFrom: "https://github.com/me/gittr",
        },
        hex
      )
    ).toBe("owner");
  });

  it("shows forked when forkedFrom is a real parent", () => {
    expect(
      profileRepoDisplayRole(
        {
          ownerPubkey: hex,
          userRole: "owner",
          sourceUrl: "https://github.com/me/andronixorigin",
          forkedFrom: "https://github.com/AndronixApp/AndronixOrigin",
        },
        hex
      )
    ).toBe("forked");
  });
});
