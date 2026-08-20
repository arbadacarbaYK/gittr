import { describe, expect, it } from "vitest";

import {
  buildCloneAttemptUrls,
  normalizeCloneUrl,
  sanitizeGitBranch,
} from "./shallow-clone-remote";

describe("buildCloneAttemptUrls", () => {
  it("retries nested self-hosted remotes with an explicit .git suffix", () => {
    expect(
      buildCloneAttemptUrls("https://friendly-machines.com/git/LiE")
    ).toEqual([
      "https://friendly-machines.com/git/LiE",
      "https://friendly-machines.com/git/LiE.git",
    ]);
  });

  it("does not duplicate an existing .git suffix", () => {
    expect(
      buildCloneAttemptUrls("https://friendly-machines.com/git/LiE.git")
    ).toEqual(["https://friendly-machines.com/git/LiE.git"]);
  });
});

describe("normalizeCloneUrl", () => {
  it("rewrites git:// to https", () => {
    expect(normalizeCloneUrl("git://example.com/a/b.git")).toBe(
      "https://example.com/a/b.git"
    );
  });
});

describe("sanitizeGitBranch", () => {
  it("rejects shell metacharacters", () => {
    expect(sanitizeGitBranch("main;rm -rf /")).toBe("main");
    expect(sanitizeGitBranch("feature/foo")).toBe("feature/foo");
  });
});
