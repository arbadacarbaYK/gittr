import { describe, expect, it } from "vitest";

import {
  activitiesFromPagesSites,
  activitiesFromRecentRepos,
  activitiesFromSoftwareApps,
  mergeHomepageRecentActivity,
  pageUpdatedMs,
} from "./homepage-recent-activity";

describe("pageUpdatedMs", () => {
  it("reads ISO timestamps", () => {
    expect(pageUpdatedMs({ updatedIso: "2026-09-12T10:00:00.000Z" })).toBe(
      Date.parse("2026-09-12T10:00:00.000Z")
    );
    expect(pageUpdatedMs({ updatedLabel: "2h ago" })).toBe(0);
  });
});

describe("mergeHomepageRecentActivity", () => {
  it("does not use local activity ids and keeps a mix of lanes", () => {
    const now = Date.now();
    const merged = mergeHomepageRecentActivity({
      leaderboard: [
        {
          id: "ev-pr",
          type: "pr_created",
          timestamp: now - 1000,
          user: "aa".repeat(32),
          entity: "npub1example",
          repo: "gittr",
          repoName: "gittr",
        },
      ],
      recentRepos: [
        {
          entity:
            "npub1w3sqdkrhn0gyuvsex32effzgnfpyde6qrrc4u467flg5e9txh4wsfn5vjg",
          repo: "archy",
          repoName: "archy",
          ownerPubkey: "ab".repeat(32),
          lastActivity: now,
        },
      ],
      apps: [
        {
          pubkey: "cd".repeat(32),
          appId: "com.example.app",
          name: "Example App",
          createdAt: Math.floor((now - 2000) / 1000),
        },
      ],
      pages: [
        {
          title: "Docs",
          siteUrl: "https://pages.gittr.space/npub1abc/",
          authorDisplay: "npub1abc",
          pathCount: 1,
          pathsStatusUrl: "",
          snapshots: 1,
          hits: 1,
          updatedLabel: "today",
          updatedIso: new Date(now - 3000).toISOString(),
        },
      ],
      count: 12,
    });
    const types = merged.map((a) => a.type);
    expect(types).toContain("repo_created");
    expect(types).toContain("app_published");
    expect(types).toContain("page_published");
    expect(types).toContain("pr_created");
    expect(merged.some((a) => String(a.id).startsWith("activity-"))).toBe(
      false
    );
  });

  it("maps recent repos and apps", () => {
    expect(
      activitiesFromRecentRepos([
        {
          entity: "npub1x",
          repo: "foo",
          repoName: "foo",
          ownerPubkey: "ee".repeat(32),
          lastActivity: 1_700_000_000_000,
        },
      ])[0]?.type
    ).toBe("repo_created");
    expect(
      activitiesFromSoftwareApps([
        {
          pubkey: "ff".repeat(32),
          appId: "id",
          name: "App",
          createdAt: 1_700_000_000,
          gittrRepoPath: "/npub1x/repo",
        },
      ])[0]?.metadata?.href
    ).toBe("/npub1x/repo");
    expect(
      activitiesFromPagesSites([
        {
          title: "Site",
          siteUrl: "https://example.pages.gittr.space/",
          authorDisplay: "x",
          pathCount: 0,
          pathsStatusUrl: "",
          snapshots: 0,
          hits: 0,
          updatedLabel: "n",
          updatedIso: "2026-01-01T00:00:00.000Z",
        },
      ])[0]?.type
    ).toBe("page_published");
  });
});
