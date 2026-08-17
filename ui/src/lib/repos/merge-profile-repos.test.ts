import { describe, expect, it } from "vitest";

import {
  mergeProfileRepoFields,
  mergeProfileRepoList,
  preferRepoDisplayName,
  profileRepoDisplayRole,
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
