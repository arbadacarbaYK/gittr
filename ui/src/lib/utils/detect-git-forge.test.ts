import { describe, expect, it } from "vitest";

import {
  detectGitForge,
  isCloneableUpstreamSourceUrl,
  normalizeGitCloneUrl,
  parseOwnerRepoFromGitUrl,
} from "./detect-git-forge";

describe("normalizeGitCloneUrl", () => {
  it("strips GitLab web UI paths", () => {
    expect(
      normalizeGitCloneUrl(
        "https://gitlab.com/group/sub/repo/-/tree/main?ref_type=heads"
      )
    ).toBe("https://gitlab.com/group/sub/repo");
  });

  it("strips Codeberg src/branch paths", () => {
    expect(
      normalizeGitCloneUrl(
        "https://codeberg.org/owner/repo/src/branch/main/README.md"
      )
    ).toBe("https://codeberg.org/owner/repo");
  });

  it("keeps plain clone URLs", () => {
    expect(normalizeGitCloneUrl("https://gitlab.com/owner/repo.git")).toBe(
      "https://gitlab.com/owner/repo.git"
    );
  });
});

describe("detectGitForge", () => {
  it("routes GitHub to the GitHub API", () => {
    expect(detectGitForge("https://github.com/a/b").useGithubApi).toBe(true);
  });

  it("routes GitLab / Codeberg / Gitea to git clone", () => {
    expect(detectGitForge("https://gitlab.com/a/b").type).toBe("gitlab");
    expect(detectGitForge("https://codeberg.org/a/b").useGithubApi).toBe(false);
    expect(detectGitForge("https://gitea.example.com/a/b").type).toBe("gitea");
  });
});

describe("parseOwnerRepoFromGitUrl", () => {
  it("keeps GitLab subgroups in owner path", () => {
    expect(
      parseOwnerRepoFromGitUrl("https://gitlab.com/group/sub/repo.git")
    ).toEqual({
      owner: "group/sub",
      repo: "repo",
      host: "gitlab.com",
    });
  });
});

describe("isCloneableUpstreamSourceUrl", () => {
  it("allows GitHub, GitLab, Codeberg", () => {
    expect(isCloneableUpstreamSourceUrl("https://github.com/a/b")).toBe(true);
    expect(isCloneableUpstreamSourceUrl("https://gitlab.com/group/repo")).toBe(
      true
    );
    expect(isCloneableUpstreamSourceUrl("https://codeberg.org/a/b")).toBe(true);
  });

  it("allows self-hosted HTTPS and git@", () => {
    expect(
      isCloneableUpstreamSourceUrl("https://git.example.com/org/repo.git")
    ).toBe(true);
    expect(
      isCloneableUpstreamSourceUrl("git@git.btclock.dev:btclock/webui.git")
    ).toBe(true);
  });

  it("rejects GRASP npub paths and empty", () => {
    expect(isCloneableUpstreamSourceUrl("")).toBe(false);
    expect(
      isCloneableUpstreamSourceUrl("https://git.gittr.space/npub1abc/repo.git")
    ).toBe(false);
  });
});
