import { describe, expect, it } from "vitest";

import {
  cloneUrlLiveHint,
  filterDisplayCloneUrlsForSidebar,
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
    expect(out.some((u) => u.includes("uid.ovh"))).toBe(false);
    // relay.gittr.space is Nostr relay hostname — not on push allowlist
    expect(out.some((u) => u.includes("relay.gittr.space"))).toBe(false);
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
});

describe("cloneUrlLiveHint", () => {
  const ngit = "https://relay.ngit.dev/npub1abc/repo.git";
  const gittr = "https://git.gittr.space/npub1abc/repo.git";

  it("marks a host that already returned a tree", () => {
    expect(
      cloneUrlLiveHint(gittr, {
        successfulSourceUrls: [gittr],
        fetchStatuses: [{ source: "git.gittr.space", status: "success" }],
      })
    ).toBe("has-files");
  });

  it("treats skipped race losers as announced, not empty", () => {
    expect(
      cloneUrlLiveHint(ngit, {
        fetchStatuses: [
          {
            source: "relay.ngit.dev",
            status: "failed",
            error: "Skipped (another source succeeded)",
          },
        ],
      })
    ).toBe("announced");
  });

  it("marks a real failed probe", () => {
    expect(
      cloneUrlLiveHint(ngit, {
        fetchStatuses: [
          { source: "relay.ngit.dev", status: "failed", error: "404" },
        ],
      })
    ).toBe("no-files");
  });

  it("stays announced when GitHub won and extras were never tried", () => {
    expect(
      cloneUrlLiveHint(ngit, {
        fetchStatuses: [{ source: "github.com", status: "success" }],
        successfulSourceUrls: ["https://github.com/org/repo.git"],
      })
    ).toBe("announced");
  });
});
