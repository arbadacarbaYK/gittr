import { beforeEach, describe, expect, it } from "vitest";

import {
  addDeletedRepoTombstones,
  clearDeletedRepoTombstones,
  clearDeletedRepoTombstonesForOwner,
  isDeletedRepoTombstoned,
  liveReposThatNeedSoftDeleteHeal,
} from "./deleted-repo-tombstones";

const OWNER =
  "9a83779e75080556c656d4d418d02a4d7edbe288a2f9e6dd2b48799ec935184c";
const ENTITY =
  "npub1n2ph08n4pqz4d3jk6n2p35p2f4ldhc5g5tu7dhftfpueajf4rpxqfjhzmc";

const store = new Map<string, string>();

beforeEach(() => {
  store.clear();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => {
        store.set(k, String(v));
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
      clear: () => store.clear(),
    },
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: globalThis,
  });
});

describe("clearDeletedRepoTombstones", () => {
  it("removes matching tombstone by entity + repo on recreate", () => {
    localStorage.setItem(
      "gittr_deleted_repos",
      JSON.stringify([
        {
          entity: ENTITY,
          repo: "local-agent",
          deletedAt: 1,
          ownerPubkey: OWNER,
        },
        { entity: ENTITY, repo: "other", deletedAt: 1 },
      ])
    );
    const removed = clearDeletedRepoTombstones({
      entity: ENTITY,
      repo: "local-agent",
      ownerPubkey: OWNER,
    });
    expect(removed).toBe(1);
    const left = JSON.parse(
      localStorage.getItem("gittr_deleted_repos") || "[]"
    );
    expect(left).toHaveLength(1);
    expect(left[0].repo).toBe("other");
  });

  it("removes by ownerPubkey when entity format differs", () => {
    localStorage.setItem(
      "gittr_deleted_repos",
      JSON.stringify([
        {
          entity: OWNER,
          repo: "local-agent",
          deletedAt: 1,
          ownerPubkey: OWNER,
        },
      ])
    );
    const removed = clearDeletedRepoTombstones({
      entity: ENTITY,
      repo: "local-agent",
      ownerPubkey: OWNER,
    });
    expect(removed).toBe(1);
  });

  it("keeps tombstone when relay announcement is older than flush", () => {
    const flushedAt = Date.now();
    localStorage.setItem(
      "gittr_deleted_repos",
      JSON.stringify([
        {
          entity: ENTITY,
          repo: "gittr-mcp",
          deletedAt: flushedAt,
          ownerPubkey: OWNER,
        },
      ])
    );
    const removed = clearDeletedRepoTombstones({
      entity: ENTITY,
      repo: "gittr-mcp",
      ownerPubkey: OWNER,
      announcedAtMs: flushedAt - 60_000,
    });
    expect(removed).toBe(0);
    expect(
      isDeletedRepoTombstoned({
        entity: ENTITY,
        repo: "gittr-mcp",
        ownerPubkey: OWNER,
        announcedAtMs: flushedAt - 60_000,
      })
    ).toBe(true);
  });

  it("clears tombstone when relay announcement is newer than flush", () => {
    const flushedAt = Date.now() - 60_000;
    localStorage.setItem(
      "gittr_deleted_repos",
      JSON.stringify([
        {
          entity: ENTITY,
          repo: "gittr-mcp",
          deletedAt: flushedAt,
          ownerPubkey: OWNER,
        },
      ])
    );
    const removed = clearDeletedRepoTombstones({
      entity: ENTITY,
      repo: "gittr-mcp",
      ownerPubkey: OWNER,
      announcedAtMs: flushedAt + 120_000,
    });
    expect(removed).toBe(1);
  });
});

describe("clearDeletedRepoTombstonesForOwner", () => {
  it("removes all tombstones for the owner pubkey", () => {
    localStorage.setItem(
      "gittr_deleted_repos",
      JSON.stringify([
        {
          entity: ENTITY,
          repo: "gittr-mcp",
          deletedAt: 1,
          ownerPubkey: OWNER,
        },
        {
          entity: ENTITY,
          repo: "tides",
          deletedAt: 1,
          ownerPubkey: OWNER,
        },
        {
          entity: "npub1other",
          repo: "someone-else",
          deletedAt: 1,
          ownerPubkey:
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        },
      ])
    );
    const removed = clearDeletedRepoTombstonesForOwner(OWNER);
    expect(removed).toBe(2);
    const left = JSON.parse(
      localStorage.getItem("gittr_deleted_repos") || "[]"
    );
    expect(left).toHaveLength(1);
    expect(left[0].repo).toBe("someone-else");
  });

  it("matches npub entity without ownerPubkey field", () => {
    localStorage.setItem(
      "gittr_deleted_repos",
      JSON.stringify([{ entity: ENTITY, repo: "only-npub", deletedAt: 1 }])
    );
    expect(clearDeletedRepoTombstonesForOwner(OWNER)).toBe(1);
  });
});

describe("addDeletedRepoTombstones", () => {
  it("adds new tombstones and skips duplicates by refreshing deletedAt", () => {
    localStorage.setItem(
      "gittr_deleted_repos",
      JSON.stringify([{ entity: ENTITY, repo: "existing", deletedAt: 1 }])
    );
    const added = addDeletedRepoTombstones([
      { entity: ENTITY, repo: "existing" },
      { entity: ENTITY, repo: "new-repo" },
      { entity: "other", repo: "new-repo" },
    ]);
    // existing refreshed + 2 new
    expect(added).toBe(3);
    const stored = JSON.parse(
      localStorage.getItem("gittr_deleted_repos") || "[]"
    );
    expect(stored).toHaveLength(3);
    const existing = stored.find(
      (d: any) => d.repo === "existing" && d.entity === ENTITY
    );
    expect(existing.deletedAt).toBeGreaterThan(1);
  });

  it("is case-insensitive for duplicates and refreshes deletedAt", () => {
    localStorage.setItem(
      "gittr_deleted_repos",
      JSON.stringify([{ entity: ENTITY, repo: "Repo-Name", deletedAt: 1 }])
    );
    const added = addDeletedRepoTombstones([
      { entity: ENTITY, repo: "repo-name" },
    ]);
    expect(added).toBe(1);
    const stored = JSON.parse(
      localStorage.getItem("gittr_deleted_repos") || "[]"
    );
    expect(stored).toHaveLength(1);
    expect(stored[0].deletedAt).toBeGreaterThan(1);
  });

  it("keeps existing tombstones when adding none", () => {
    localStorage.setItem(
      "gittr_deleted_repos",
      JSON.stringify([{ entity: ENTITY, repo: "keep", deletedAt: 1 }])
    );
    expect(addDeletedRepoTombstones([])).toBe(0);
    const stored = JSON.parse(
      localStorage.getItem("gittr_deleted_repos") || "[]"
    );
    expect(stored).toHaveLength(1);
  });
});

describe("liveReposThatNeedSoftDeleteHeal", () => {
  const eventId = "a".repeat(64);

  it("does not nag when the live 30617 is older than the local delete", () => {
    const names = liveReposThatNeedSoftDeleteHeal(
      OWNER,
      [
        {
          repo: "calendarapi",
          lastNostrEventId: eventId,
          lastNostrEventCreatedAt: 1_700_000_000,
        },
      ],
      [
        {
          repo: "calendarapi",
          ownerPubkey: OWNER,
          deletedAt: 1_800_000_000_000,
        },
      ]
    );
    expect(names).toEqual([]);
  });

  it("does not nag on a 30618-only stub with no 30617 event id", () => {
    const names = liveReposThatNeedSoftDeleteHeal(
      OWNER,
      [{ repo: "petrol-agent", lastNostrEventCreatedAt: 1_900_000_000 }],
      [
        {
          repo: "petrol-agent",
          ownerPubkey: OWNER,
          deletedAt: 1,
        },
      ]
    );
    expect(names).toEqual([]);
  });

  it("nags only when a live 30617 is newer than the local delete", () => {
    const names = liveReposThatNeedSoftDeleteHeal(
      OWNER,
      [
        {
          repo: "reopened",
          lastNostrEventId: eventId,
          lastNostrEventCreatedAt: 2_000_000_000,
        },
      ],
      [{ repo: "reopened", ownerPubkey: OWNER, deletedAt: 1_000 }]
    );
    expect(names).toEqual(["reopened"]);
  });
});
