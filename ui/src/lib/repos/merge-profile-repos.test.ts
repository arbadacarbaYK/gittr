import { describe, expect, it } from "vitest";

import {
  mergeProfileRepoFields,
  mergeProfileRepoList,
  preferRepoDisplayName,
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
});
