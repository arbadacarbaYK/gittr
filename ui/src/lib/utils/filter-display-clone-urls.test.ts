import { describe, expect, it } from "vitest";

import {
  cloneUrlLiveHint,
  cloneUrlLiveHintShowsBadge,
  dedupeNormalizedCloneUrls,
  filterDisplayCloneUrlsForSidebar,
  mergeCloneUrlLists,
  orderCloneUrlsForSidebar,
} from "./filter-display-clone-urls";
import { GRASP_SERVERS_FOR_PUSHING } from "./grasp-servers";

describe("filterDisplayCloneUrlsForSidebar", () => {
  const npub = "npub1abc";
  const repo = "repo";
  const urls = [
    `https://git.gittr.space/${npub}/${repo}.git`,
    `https://git.shakespeare.diy/${npub}/${repo}.git`,
    `https://gitnostr.com/${npub}/${repo}.git`,
    `https://relay.ngit.dev/${npub}/${repo}.git`,
    `https://ngit.danconwaydev.com/${npub}/${repo}.git`,
    `https://relay.gittr.space/${npub}/${repo}.git`, // known GRASP hostname but not on push allowlist
    `https://github.com/org/${repo}.git`,
    `http://23.1.2.3:7334/${npub}/${repo}.git`,
    `https://uid.ovh/${npub}/${repo}.git`, // excluded / not on push allowlist
    `nostr://${npub}/${repo}`,
  ];

  it("does_not_collapse_to_primary_only_when_primary_present", () => {
    const out = filterDisplayCloneUrlsForSidebar(urls, {
      primaryGitServerEnv: "https://git.gittr.space",
      sourceUrl: `https://github.com/org/${repo}`,
    });
    for (const host of GRASP_SERVERS_FOR_PUSHING) {
      expect(out.some((u) => u.includes(host))).toBe(true);
    }
    expect(out).toContain(`https://github.com/org/${repo}.git`);
    expect(out).toContain(`nostr://${npub}/${repo}`);
    expect(out.some((u) => u.includes("23.1.2.3"))).toBe(false);
    expect(out.some((u) => u.includes("uid.ovh"))).toBe(true);
    expect(out.some((u) => u.includes("relay.gittr.space"))).toBe(true);
  });

  it("keeps third-party GRASP when primary is absent from the announce", () => {
    const onlyThird = [
      `https://git.shakespeare.diy/${npub}/${repo}.git`,
      `https://github.com/org/${repo}.git`,
    ];
    const out = filterDisplayCloneUrlsForSidebar(onlyThird, {
      primaryGitServerEnv: "https://git.gittr.space",
      sourceUrl: `https://github.com/org/${repo}`,
    });
    expect(out).toContain(`https://git.shakespeare.diy/${npub}/${repo}.git`);
  });

  it("canonicalizes accidental https://htree:// rewrite to htree://", () => {
    const npubFull =
      "npub1vx40p5mkcwyrg2gnthf343y39tf0zqxl56ajvql2m9q3rxremynsfp37lu";
    const out = filterDisplayCloneUrlsForSidebar(
      [
        `htree://${npubFull}/gyoza-hanto`,
        `https://htree://${npubFull}/gyoza-hanto.git`,
      ],
      { primaryGitServerEnv: "https://git.gittr.space" }
    );
    expect(out.every((u) => u.startsWith("htree://"))).toBe(true);
    expect(out.some((u) => u.startsWith("https://htree://"))).toBe(false);
  });
});

describe("cloneUrlLiveHint", () => {
  const ngit = "https://relay.ngit.dev/npub1abc/repo.git";
  const gittr = "https://git.gittr.space/npub1abc/repo.git";
  const github = "https://github.com/org/repo.git";

  it("badges GitHub has-files when this visit loaded the tree from GitHub", () => {
    expect(
      cloneUrlLiveHint(github, {
        fetchStatuses: [{ source: "github.com", status: "success" }],
        successfulSourceUrls: [github],
      })
    ).toBe("has-files");
    expect(cloneUrlLiveHintShowsBadge("has-files")).toBe(true);
  });

  it("does not badge gittr just because GitHub won the Code-tab race", () => {
    expect(
      cloneUrlLiveHint(gittr, {
        fetchStatuses: [{ source: "github.com", status: "success" }],
        successfulSourceUrls: [github],
      })
    ).toBe("announced");
    expect(cloneUrlLiveHintShowsBadge("announced")).toBe(false);
  });

  it("badges gittr when ls-remote sees refs even if GitHub won the tree", () => {
    expect(
      cloneUrlLiveHint(gittr, {
        fetchStatuses: [{ source: "github.com", status: "success" }],
        successfulSourceUrls: [github],
        remoteHeads: {
          "https://git.gittr.space/npub1abc/repo": "has-files",
        },
      })
    ).toBe("has-files");
  });

  it("ignores skipped file-fetch rows and uses the independent probe", () => {
    expect(
      cloneUrlLiveHint(ngit, {
        fetchStatuses: [
          {
            source: "relay.ngit.dev",
            status: "failed",
            error: "Skipped (another source succeeded)",
          },
        ],
        remoteHeads: {
          "https://relay.ngit.dev/npub1abc/repo": "has-files",
        },
      })
    ).toBe("has-files");
  });

  it("marks a host with no git refs", () => {
    expect(
      cloneUrlLiveHint(ngit, {
        remoteHeads: {
          "https://relay.ngit.dev/npub1abc/repo": "no-files",
        },
      })
    ).toBe("no-files");
  });

  it("badges extra GRASP when this visit loaded a tree from them", () => {
    expect(
      cloneUrlLiveHint(ngit, {
        fetchStatuses: [{ source: "relay.ngit.dev", status: "success" }],
      })
    ).toBe("has-files");
  });
});

describe("clone URL list helpers", () => {
  const npub = "npub1abc";
  const repo = "gittr";
  const gittr = `https://git.gittr.space/${npub}/${repo}.git`;
  const ngit = `https://relay.ngit.dev/${npub}/${repo}.git`;
  const shakespeare = `https://git.shakespeare.diy/${npub}/${repo}.git`;
  const github = "https://github.com/arbadacarbaYK/gittr";
  const githubGit = "https://github.com/arbadacarbaYK/gittr.git";

  it("does not let a thinner later snapshot drop Push mirrors", () => {
    expect(mergeCloneUrlLists([gittr, shakespeare, ngit], [ngit])).toEqual(
      expect.arrayContaining([gittr, shakespeare, ngit])
    );
  });

  it("shows one GitHub row when source and .git both exist", () => {
    expect(dedupeNormalizedCloneUrls([github, githubGit])).toEqual([githubGit]);
  });

  it("puts this deployment git host first and forge source last", () => {
    const ordered = orderCloneUrlsForSidebar([ngit, githubGit, gittr], {
      primaryGitServerEnv: "https://git.gittr.space",
      sourceUrl: github,
    });
    expect(ordered[0]).toBe(gittr);
    expect(ordered[ordered.length - 1]).toBe(githubGit);
  });
});
