import { beforeEach, describe, expect, it } from "vitest";

import {
  addDeletedRepoTombstones,
  clearDeletedRepoTombstones,
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
});

describe("addDeletedRepoTombstones", () => {
  it("adds new tombstones and skips duplicates", () => {
    localStorage.setItem(
      "gittr_deleted_repos",
      JSON.stringify([
        { entity: ENTITY, repo: "existing", deletedAt: 1 },
      ])
    );
    const added = addDeletedRepoTombstones([
      { entity: ENTITY, repo: "existing" },
      { entity: ENTITY, repo: "new-repo" },
      { entity: "other", repo: "new-repo" },
    ]);
    expect(added).toBe(2);
    const stored = JSON.parse(
      localStorage.getItem("gittr_deleted_repos") || "[]"
    );
    expect(stored).toHaveLength(3);
    expect(stored.map((d: any) => d.repo)).toContain("new-repo");
    expect(stored.map((d: any) => d.entity)).toContain(ENTITY);
  });

  it("is case-insensitive for duplicates", () => {
    localStorage.setItem(
      "gittr_deleted_repos",
      JSON.stringify([{ entity: ENTITY, repo: "Repo-Name", deletedAt: 1 }])
    );
    const added = addDeletedRepoTombstones([
      { entity: ENTITY, repo: "repo-name" },
    ]);
    expect(added).toBe(0);
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
