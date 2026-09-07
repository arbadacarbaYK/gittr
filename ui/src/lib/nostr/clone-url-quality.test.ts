import { describe, expect, it } from "vitest";

import {
  gitCloneUrlsForFileFetch,
  isLikelyGitCloneUrl,
  pickUserFacingCloneUrl,
} from "./clone-url-quality";

const npub = "npub1k0y4eceal2zryes3azm6nsgt0r0jsa2v8zcsdf9uqxttn0jlfe9q04c9h8";

describe("pickUserFacingCloneUrl", () => {
  it("keeps GitHub when the repo has an external source", () => {
    const url = pickUserFacingCloneUrl({
      cloneUrls: [
        `https://relay.ngit.dev/${npub}/amber-up.git`,
        `https://git.gittr.space/${npub}/amber-up.git`,
      ],
      sourceUrl: "https://github.com/greenart7c3/amber-up",
    });
    expect(url).toContain("github.com");
  });

  it("prefers git.gittr.space on nostr-only announces that listed it", () => {
    const url = pickUserFacingCloneUrl({
      cloneUrls: [
        `https://relay.ngit.dev/${npub}/officecli.git`,
        `https://git.gittr.space/${npub}/officecli.git`,
      ],
    });
    expect(url).toContain("git.gittr.space");
  });
});

describe("isLikelyGitCloneUrl", () => {
  it("keeps known GRASP and forge remotes", () => {
    expect(
      isLikelyGitCloneUrl(`https://relay.ngit.dev/${npub}/officecli.git`)
    ).toBe(true);
    expect(isLikelyGitCloneUrl("https://github.com/org/repo.git")).toBe(true);
  });

  it("rejects Nostr-relay homepages that are not GRASP git hosts", () => {
    expect(
      isLikelyGitCloneUrl(
        `https://relay.poster.place/${npub}/project-brutality-xdc.git`
      )
    ).toBe(false);
  });
});

describe("gitCloneUrlsForFileFetch", () => {
  it("drops relay homepages and keeps GRASP", () => {
    expect(
      gitCloneUrlsForFileFetch([
        `https://relay.poster.place/${npub}/project-brutality-xdc.git`,
        `https://relay.ngit.dev/${npub}/project-brutality-xdc.git`,
      ])
    ).toEqual([`https://relay.ngit.dev/${npub}/project-brutality-xdc.git`]);
  });
});
