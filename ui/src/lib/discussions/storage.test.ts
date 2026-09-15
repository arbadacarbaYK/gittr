import { beforeEach, describe, expect, it } from "vitest";

import {
  appendDiscussion,
  collectDiscussionStorageKeys,
  discussionFromLongFormEvent,
  hideDiscussion,
  loadDiscussionById,
  loadDiscussions,
  loadHiddenDiscussionIds,
  mergeDiscussionLists,
  persistDiscussion,
} from "./storage";

const ENTITY =
  "npub1n2ph08n4pqz4d3jk6n2p35p2f4ldhc5g5tu7dhftfpueajf4rpxqfjhzmc";
const REPO = "gittr";

const store = new Map<string, string>();
let quotaOnce = false;

function installLocalStorage() {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => {
        if (
          quotaOnce &&
          k.startsWith("gittr_discussions__") &&
          !k.includes("hidden")
        ) {
          quotaOnce = false;
          const err = new Error(
            "Failed to execute 'setItem' on 'Storage': exceeded the quota."
          );
          err.name = "QuotaExceededError";
          throw err;
        }
        store.set(k, String(v));
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
      clear: () => store.clear(),
      get length() {
        return store.size;
      },
      key: (i: number) => [...store.keys()][i] ?? null,
    },
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: globalThis,
  });
}

beforeEach(() => {
  store.clear();
  quotaOnce = false;
  installLocalStorage();
});

const sample = {
  id: "48b019482a92e1b051fd6cd28eee344af62bc7408bf1387aff351257bd0503a8",
  title: "CLI-Tools",
  description: "Most users hate CLI-Tools",
  author: "9a83779e75080556c656d4d418d02a4d7edbe288a2f9e6dd2b48799ec935184c",
  createdAt: 1,
  commentCount: 0,
  comments: [],
  dTag: `${ENTITY}/${REPO}/1-abc`,
};

describe("discussion storage", () => {
  it("reads the legacy single-underscore key used before canonical __ keys", () => {
    localStorage.setItem(
      `gittr_discussions_${ENTITY}_${REPO}`,
      JSON.stringify([sample])
    );
    expect(loadDiscussions(ENTITY, REPO).map((d) => d.id)).toEqual([sample.id]);
    expect(
      collectDiscussionStorageKeys(ENTITY, REPO).some((k) =>
        k.includes(`${ENTITY}_${REPO}`)
      )
    ).toBe(true);
  });

  it("upserts by id instead of duplicating", () => {
    appendDiscussion(ENTITY, REPO, sample);
    persistDiscussion(ENTITY, REPO, {
      ...sample,
      description: "updated body",
    });
    const rows = loadDiscussions(ENTITY, REPO);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.description).toBe("updated body");
  });

  it("parses a NIP-23 long-form event", () => {
    const d = discussionFromLongFormEvent(
      {
        id: sample.id,
        pubkey: sample.author,
        created_at: 1_700_000_000,
        content: "body",
        tags: [
          ["d", "stable-d"],
          ["title", "CLI-Tools"],
          ["t", "Ideas"],
        ],
      },
      ENTITY,
      REPO
    );
    expect(d.title).toBe("CLI-Tools");
    expect(d.dTag).toBe("stable-d");
    expect(d.category).toBe("Ideas");
  });

  it("collapses replaceable retries with the same author + d tag", () => {
    const older = {
      ...sample,
      id: "aa".repeat(32),
      createdAt: 1,
    };
    const newer = {
      ...sample,
      id: "bb".repeat(32),
      createdAt: 2,
      description: "second publish",
    };
    const merged = mergeDiscussionLists([older, newer], []);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.id).toBe(newer.id);
  });

  it("hides a discussion from the merged list", () => {
    hideDiscussion(ENTITY, REPO, sample.id);
    expect(loadHiddenDiscussionIds(ENTITY, REPO).has(sample.id)).toBe(true);
    expect(
      mergeDiscussionLists([sample], [], loadHiddenDiscussionIds(ENTITY, REPO))
    ).toEqual([]);
  });

  it("retries after quota by dropping a large file-tree cache", () => {
    store.set("gittr_files__other__repo", "x".repeat(2000));
    quotaOnce = true;
    const result = appendDiscussion(ENTITY, REPO, sample);
    expect(result.ok).toBe(true);
    expect(loadDiscussionById(ENTITY, REPO, sample.id)?.title).toBe(
      "CLI-Tools"
    );
    expect(store.has("gittr_files__other__repo")).toBe(false);
  });
});
