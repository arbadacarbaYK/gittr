import { describe, expect, it } from "vitest";

import {
  isGenericHttpsGitRemoteUrl,
  isRefetchableUpstreamSourceUrl,
} from "./upstream-git-url";

const npub = "npub1k0y4eceal2zryes3azm6nsgt0r0jsa2v8zcsdf9uqxttn0jlfe9q04c9h8";

describe("generic HTTPS remotes", () => {
  it("treats a nested self-hosted clone as refetchable (not a source tag)", () => {
    const url = "https://friendly-machines.com/git/LiE.git";
    expect(isGenericHttpsGitRemoteUrl(url)).toBe(true);
    expect(isRefetchableUpstreamSourceUrl(url)).toBe(true);
  });

  it("does not treat gittr GRASP npub paths as generic forges", () => {
    const url = `https://git.gittr.space/${npub}/demo.git`;
    expect(isGenericHttpsGitRemoteUrl(url)).toBe(false);
    expect(isRefetchableUpstreamSourceUrl(url)).toBe(false);
  });
});
