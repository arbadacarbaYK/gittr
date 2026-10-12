import { nip19 } from "nostr-tools";
import { describe, expect, it } from "vitest";

import {
  appMetaLine,
  buildLauncherWidgetFeed,
  cleanDisplayName,
  descriptionFromAnnouncement,
  formatWidgetCount,
  githubFromAnnouncementTags,
  parseGithubOwnerRepo,
  repoStarMeta,
  safeRepoName,
} from "./launcher-feed";
import { resetWidgetHopCacheForTests, widgetHopMap } from "./widget-wot";

const OWNER = "ab".repeat(32);
const OTHER = "cd".repeat(32);

describe("launcher feed formatting", () => {
  it("formats counts the way a trending row does", () => {
    expect(formatWidgetCount(42)).toBe("42");
    expect(formatWidgetCount(1400)).toBe("1.4k");
    expect(formatWidgetCount(1000)).toBe("1k");
    expect(formatWidgetCount(0)).toBe("0");
  });

  it("drops mirror suffixes and keys that are not names", () => {
    expect(cleanDisplayName("ada (mirrored user from github)")).toBe("ada");
    expect(cleanDisplayName("npub1qqqq")).toBe("");
    expect(cleanDisplayName("ab".repeat(8))).toBe("");
    expect(safeRepoName("demo")).toBe("demo");
    expect(safeRepoName("aa".repeat(32) + "/gamestr")).toBe("");
  });

  it("reads a repo blurb and a github source without inventing stars", () => {
    expect(
      descriptionFromAnnouncement({
        content: JSON.stringify({ description: "signed git" }),
        tags: [],
      })
    ).toBe("signed git");
    expect(
      githubFromAnnouncementTags([
        ["clone", "https://github.com/example/demo.git"],
      ])
    ).toEqual({ owner: "example", repo: "demo" });
    expect(parseGithubOwnerRepo("https://codeberg.org/example/demo")).toBe(
      null
    );
    expect(repoStarMeta({ nostrStars: 0, githubStars: 1400 })).toBe(
      "★ 1.4k github"
    );
    expect(repoStarMeta({ nostrStars: 4, githubStars: 2 })).toBe(
      "★ 4 nostr · ★ 2 github"
    );
    expect(repoStarMeta(undefined)).toBe("");
  });
});

describe("buildLauncherWidgetFeed", () => {
  it("ranks active repos, keeps descriptions, and links to gittr", () => {
    const feed = buildLauncherWidgetFeed({
      origin: "https://gittr.space",
      at: 10,
      names: { [OWNER]: "Ada" },
      topRepos: [
        {
          repoId: `${OWNER}/demo`,
          repoName: "demo",
          entity: OWNER,
          activityCount: 12,
          prCount: 1,
          commitCount: 9,
          issueCount: 2,
          zapCount: 0,
          lastActivity: 1,
        },
        {
          repoId: `${OTHER}/quiet`,
          repoName: "quiet",
          entity: OTHER,
          activityCount: 0,
          prCount: 0,
          commitCount: 0,
          issueCount: 0,
          zapCount: 0,
          lastActivity: 1,
        },
      ],
      recentRepos: [
        {
          entity: "npub1placeholder",
          repo: "demo",
          repoName: "demo",
          ownerPubkey: OWNER,
          lastActivity: 1,
          description: "a public repo",
        },
      ],
      repoFacts: {
        [`${OWNER}/demo`]: {
          description: "from the announcement",
          nostrStars: 3,
        },
      },
      topUsers: [
        {
          pubkey: OWNER,
          activityCount: 20,
          prMergedCount: 1,
          commitCount: 4,
          bountyClaimedCount: 0,
          reposCreatedCount: 1,
          lastActivity: 1,
        },
        {
          pubkey: OTHER,
          activityCount: 40,
          prMergedCount: 0,
          commitCount: 0,
          bountyClaimedCount: 0,
          reposCreatedCount: 0,
          lastActivity: 1,
        },
      ],
      apps: [
        {
          pubkey: OWNER,
          appId: "space.example.app",
          name: "Example",
          summary: "A phone app",
          repository: "https://github.com/example/demo",
          topics: ["nostr"],
          platformHints: ["android-arm64-v8a"],
          createdAt: 50,
        },
      ],
      appFacts: {
        "space.example.app": { githubStars: 1400 },
      },
    });

    expect(feed.repos).toHaveLength(1);
    expect(feed.repos[0]?.name).toBe("Ada/demo");
    expect(feed.repos[0]?.desc).toBe("from the announcement");
    expect(feed.repos[0]?.meta).toBe("★ 3 nostr");
    expect(feed.repos[0]?.count).toBe(12);
    expect(feed.repos[0]?.countLabel).toBe("12");
    expect(feed.repos[0]?.url).toBe(
      `https://gittr.space/${nip19.npubEncode(OWNER)}/demo`
    );
    expect(feed.people).toHaveLength(1);
    expect(feed.people[0]?.name).toBe("Ada");
    expect(feed.people[0]?.desc).toBe("1 repo");
    expect(feed.apps[0]?.meta).toBe("Android · nostr · ★ 1.4k github");
    expect(feed.apps[0]?.url).toBe(
      "https://gittr.space/apps/space.example.app"
    );
    expect(feed.apps[0]?.hay).toContain("example");
    expect(feed.links.home).toBe("https://gittr.space/");
    expect(feed.links.help).toBe("https://gittr.space/help#launcher-widgets");
  });

  it("lists fifteen repos for the phone tile", () => {
    const topRepos = Array.from({ length: 20 }, (_, index) => ({
      repoId: `${OWNER}/repo-${index}`,
      repoName: `repo-${index}`,
      entity: OWNER,
      activityCount: 30 - index,
      prCount: 0,
      commitCount: 1,
      issueCount: 0,
      zapCount: 0,
      lastActivity: index,
    }));
    const apps = Array.from({ length: 20 }, (_, index) => ({
      pubkey: OWNER,
      appId: `app.${index}`,
      name: `App ${index}`,
      createdAt: 100 - index,
    }));
    const feed = buildLauncherWidgetFeed({
      origin: "https://gittr.space",
      topRepos,
      apps,
    });
    expect(feed.repos).toHaveLength(15);
    expect(feed.repos[0]?.name.endsWith("/repo-0")).toBe(true);
    expect(feed.apps).toHaveLength(20);
    expect(feed.apps[0]?.name).toBe("App 0");
  });

  it("hides a blocked publisher and does not invent an app star line", () => {
    const feed = buildLauncherWidgetFeed({
      origin: "https://gittr.space",
      topRepos: [
        {
          repoId: `${OWNER}/demo`,
          repoName: "demo",
          entity: OWNER,
          activityCount: 4,
          prCount: 0,
          commitCount: 4,
          issueCount: 0,
          zapCount: 0,
          lastActivity: 1,
        },
      ],
      apps: [
        {
          pubkey: OWNER,
          appId: "demo.app",
          name: "Demo",
          platformHints: ["linux-x86_64"],
          topics: ["git"],
          createdAt: 1,
        },
      ],
      isBlocked: (pubkey) => pubkey === OWNER,
    });
    expect(feed.repos).toEqual([]);
    expect(feed.apps).toEqual([]);
    expect(
      appMetaLine(
        { platformHints: ["linux-x86_64"], topics: ["git"] },
        { githubStars: null, nostrStars: 0 }
      )
    ).toBe("Linux · git");
  });
});

describe("widget hop map", () => {
  it("keeps a real distance and drops self, outside, and failures", () => {
    resetWidgetHopCacheForTests();
    expect(
      widgetHopMap([
        { target: OWNER, lookup: { ok: true, hops: 1 } },
        { target: OTHER, lookup: { ok: true, hops: 0 } },
        { target: "ee".repeat(32), lookup: { ok: true, hops: null } },
        { target: "ff".repeat(32), lookup: { ok: false, hops: 2 } },
      ])
    ).toEqual({ [OWNER]: 1 });
  });
});
