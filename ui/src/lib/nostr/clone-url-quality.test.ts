import { describe, expect, it } from "vitest";

import { pickUserFacingCloneUrl } from "./clone-url-quality";

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
