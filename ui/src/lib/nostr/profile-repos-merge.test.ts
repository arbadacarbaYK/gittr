import { describe, expect, it } from "vitest";

import {
  type ProfileRepoAccumulator,
  type ProfileRepoEvent,
  applyProfileRepoEvent,
  profileRepoRowsFromAccumulator,
} from "./profile-repos-merge";

const KIND_REPOSITORY_NIP34 = 30617;
const KIND_REPOSITORY_STATE = 30618;

const OWNER = "a".repeat(64);

function announce(
  name: string,
  createdAt: number,
  extra: Partial<ProfileRepoEvent> = {},
  extraTags: string[][] = []
): ProfileRepoEvent {
  return {
    id: `ann-${name}-${createdAt}`,
    kind: KIND_REPOSITORY_NIP34,
    pubkey: OWNER,
    created_at: createdAt,
    tags: [["d", name], ["name", name], ...extraTags],
    content: "",
    ...extra,
  };
}

function state(name: string, createdAt: number): ProfileRepoEvent {
  return {
    id: `st-${name}-${createdAt}`,
    kind: KIND_REPOSITORY_STATE,
    pubkey: OWNER,
    created_at: createdAt,
    tags: [["d", name]],
    content: "",
  };
}

function rowsOf(...events: ProfileRepoEvent[]) {
  const acc: ProfileRepoAccumulator = new Map();
  for (const ev of events) applyProfileRepoEvent(acc, ev);
  return profileRepoRowsFromAccumulator(acc);
}

describe("profile-repos merge (latest 30617 wins)", () => {
  it("drops a repo when the latest 30617 is soft-deleted", () => {
    const repos = rowsOf(
      announce("calendarapi", 1_700_000_000),
      announce("calendarapi", 1_700_000_100, {}, [["deleted", "true"]])
    );
    expect(repos.map((r) => r.repo)).toEqual([]);
  });

  it("ignores an older live 30617 after a newer delete", () => {
    const repos = rowsOf(
      announce("nip-05-api", 1_700_000_200, {}, [["deleted", "true"]]),
      announce("nip-05-api", 1_700_000_000)
    );
    expect(repos.map((r) => r.repo)).toEqual([]);
  });

  it("does not let a later 30618 resurrect a deleted 30617", () => {
    const repos = rowsOf(
      announce("test", 1_700_000_000),
      announce("test", 1_700_000_050, {}, [["deleted", "true"]]),
      state("test", 1_700_000_999)
    );
    expect(repos.map((r) => r.repo)).toEqual([]);
  });

  it("does not let a 30618 that arrived first win over a later deleted 30617", () => {
    const repos = rowsOf(
      state("oomwoo", 1_800_000_000),
      announce("oomwoo", 1_700_000_000, {}, [["deleted", "true"]])
    );
    expect(repos.map((r) => r.repo)).toEqual([]);
  });

  it("keeps a live repo and lets 30618 bump lastActivity", () => {
    const repos = rowsOf(
      announce("alive", 1_700_000_000, {}, [["description", "A live repo"]]),
      state("alive", 1_700_000_500)
    );
    expect(repos).toHaveLength(1);
    expect(repos[0]?.repo).toBe("alive");
    expect(repos[0]?.description).toBe("A live repo");
    expect(repos[0]?.lastActivity).toBe(1_700_000_500 * 1000);
    expect(repos[0]?.lastNostrEventCreatedAt).toBe(1_700_000_000);
    expect(repos[0]?.stateEventId).toBe("st-alive-1700000500");
  });

  it("lists a 30618-only repo when no 30617 was seen", () => {
    const repos = rowsOf(state("state-only", 1_700_000_000));
    expect(repos.map((r) => r.repo)).toEqual(["state-only"]);
  });

  it("keeps a newer live announce over an older delete", () => {
    const repos = rowsOf(
      announce("reopened", 1_700_000_000, {}, [["deleted", "true"]]),
      announce("reopened", 1_700_000_200)
    );
    expect(repos.map((r) => r.repo)).toEqual(["reopened"]);
  });
});
