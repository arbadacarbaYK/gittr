import { describe, expect, it, vi } from "vitest";

vi.mock("./moderation/publisher-blocklist", () => ({
  isPublisherBlocklisted: () => false,
}));

vi.mock("./nostr/clone-url-quality", () => ({
  normalizeNip34RepoIdentifier: (dTag: string, nameTag?: string) =>
    (dTag || nameTag || "").trim(),
  shouldHideNip34EventForUnusableClones: () => false,
}));

import { getLiveRecentReposFromNostr } from "./stats/live-recent-repos";

const KIND_REPOSITORY_NIP34 = 30617;
const KIND_REPOSITORY_STATE = 30618;

const OWNER_A = "a".repeat(64);
const OWNER_B = "b".repeat(64);
const OWNER_C = "c".repeat(64);

function announce(
  pubkey: string,
  name: string,
  createdAt: number,
  extraTags: string[][] = []
) {
  return {
    kind: KIND_REPOSITORY_NIP34,
    pubkey,
    created_at: createdAt,
    tags: [["d", name], ["name", name], ...extraTags],
    content: "",
  };
}

function mockSubscribe(events: unknown[]) {
  return (
    _filters: unknown[],
    relays: string[],
    onEvent: (event: unknown) => void,
    _maxDelay?: number,
    onEose?: (relayUrl: string, minCreatedAt: number) => void
  ) => {
    queueMicrotask(() => {
      for (const ev of events) onEvent(ev);
      for (const relay of relays) onEose?.(relay, 0);
    });
    return () => {};
  };
}

describe("getLiveRecentReposFromNostr", () => {
  it("ranks by 30617 announcement time, ignoring later 30618 pushes", async () => {
    const events = [
      announce(OWNER_A, "busy-old", 1_700_000_000),
      {
        kind: KIND_REPOSITORY_STATE,
        pubkey: OWNER_A,
        created_at: 1_800_000_000,
        tags: [["d", "busy-old"]],
      },
      announce(OWNER_B, "brand-new", 1_750_000_000),
    ];
    const repos = await getLiveRecentReposFromNostr(
      mockSubscribe(events) as never,
      ["wss://relay.test"],
      12
    );
    expect(repos.map((r) => r.repo)).toEqual(["brand-new", "busy-old"]);
  });

  it("returns the newest 12 even when older events arrive first", async () => {
    const events = Array.from({ length: 20 }, (_, i) =>
      announce(OWNER_C, `repo-${i}`, 1_700_000_000 + i)
    );
    const repos = await getLiveRecentReposFromNostr(
      mockSubscribe(events) as never,
      ["wss://relay.test"],
      12
    );
    expect(repos).toHaveLength(12);
    expect(repos[0]?.repo).toBe("repo-19");
    expect(repos[11]?.repo).toBe("repo-8");
  });

  it("drops soft-deleted announcements", async () => {
    const events = [
      announce(OWNER_A, "gone", 1_760_000_000, [["deleted", "true"]]),
      announce(OWNER_B, "alive", 1_750_000_000),
    ];
    const repos = await getLiveRecentReposFromNostr(
      mockSubscribe(events) as never,
      ["wss://relay.test"],
      12
    );
    expect(repos.map((r) => r.repo)).toEqual(["alive"]);
  });
});
