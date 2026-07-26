import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../repos/storage", () => ({
  loadStoredRepos: vi.fn(() => []),
}));

vi.mock("../utils/entity-resolver", () => ({
  getRepoOwnerPubkey: vi.fn((repo: { ownerPubkey?: string }, entity: string) =>
    repo?.ownerPubkey || (/^[0-9a-f]{64}$/i.test(entity) ? entity : "")
  ),
  resolveEntityToPubkeyAsync: vi.fn(async (entity: string) => {
    if (/^[0-9a-f]{64}$/i.test(entity)) return entity.toLowerCase();
    if (entity.startsWith("npub1")) {
      return null;
    }
    return null;
  }),
}));

vi.mock("../utils/repo-finder", () => ({
  findRepoByEntityAndNameAsync: vi.fn(async () => undefined),
}));

vi.mock("../nostr/relay-env", () => ({
  getDefaultRelayUrls: vi.fn(() => []),
}));

vi.mock("../nostr/server-relay-subscribe", () => ({
  PLATFORM_STATS_RELAYS: [],
}));

vi.mock("../nostr/repo-stars", () => ({
  repoAnnouncementDTagCandidates: vi.fn((slug: string) => [slug]),
}));

import { loadStoredRepos } from "./storage";
import { resolveEntityToPubkeyAsync } from "../utils/entity-resolver";
import { findRepoByEntityAndNameAsync } from "../utils/repo-finder";

import {
  parseAnnouncementHydration,
  resolveRepoForPublish,
} from "./resolve-repo-for-publish";

const OWNER = "a".repeat(64);

describe("parseAnnouncementHydration", () => {
  it("reads d and r euc tags", () => {
    expect(
      parseAnnouncementHydration([
        ["d", "gittr"],
        ["r", "deadbeef".repeat(5), "euc"],
      ])
    ).toEqual({
      repositoryName: "gittr",
      earliestUniqueCommit: "deadbeef".repeat(5),
    });
  });

  it("falls back to name when d missing", () => {
    expect(parseAnnouncementHydration([["name", "My Repo"]])).toEqual({
      repositoryName: "My Repo",
    });
  });
});

describe("resolveRepoForPublish", () => {
  beforeEach(() => {
    vi.mocked(loadStoredRepos).mockReturnValue([]);
    vi.mocked(findRepoByEntityAndNameAsync).mockResolvedValue(undefined);
    vi.mocked(resolveEntityToPubkeyAsync).mockImplementation(
      async (entity: string) =>
        /^[0-9a-f]{64}$/i.test(entity) ? entity.toLowerCase() : null
    );
  });

  it("returns null for empty entity/repo", async () => {
    expect(await resolveRepoForPublish("", "x")).toBeNull();
    expect(await resolveRepoForPublish("x", "")).toBeNull();
  });

  it("returns null when entity cannot resolve", async () => {
    vi.mocked(resolveEntityToPubkeyAsync).mockResolvedValue(null);
    expect(
      await resolveRepoForPublish("user@example.com", "repo", {
        fetchAnnouncement: async () => null,
      })
    ).toBeNull();
  });

  it("resolves from cache hit", async () => {
    const stored = {
      entity: OWNER,
      repo: "gittr",
      repositoryName: "gittr",
      ownerPubkey: OWNER,
      earliestUniqueCommit: "c".repeat(40),
      defaultBranch: "main",
    };
    vi.mocked(findRepoByEntityAndNameAsync).mockResolvedValue(stored as any);
    const ctx = await resolveRepoForPublish(OWNER, "gittr", {
      fetchAnnouncement: async () => null,
    });
    expect(ctx).toMatchObject({
      fromStorage: true,
      ownerPubkey: OWNER,
      repositoryName: "gittr",
      earliestUniqueCommit: "c".repeat(40),
      defaultBranch: "main",
    });
    expect(ctx?.storedRepo).toBe(stored);
  });

  it("resolves cold cache via entity + announcement hydration", async () => {
    const ctx = await resolveRepoForPublish(OWNER, "gittr", {
      fetchAnnouncement: async () => ({
        repositoryName: "gittr",
        earliestUniqueCommit: "ab".repeat(20),
      }),
    });
    expect(ctx).toEqual({
      entity: OWNER,
      repo: "gittr",
      repositoryName: "gittr",
      ownerPubkey: OWNER,
      earliestUniqueCommit: "ab".repeat(20),
      defaultBranch: undefined,
      fromStorage: false,
    });
  });

  it("falls back to URL repo slug when announcement missing", async () => {
    const ctx = await resolveRepoForPublish(OWNER, "my-repo", {
      fetchAnnouncement: async () => null,
    });
    expect(ctx).toMatchObject({
      fromStorage: false,
      repositoryName: "my-repo",
      ownerPubkey: OWNER,
    });
  });
});
