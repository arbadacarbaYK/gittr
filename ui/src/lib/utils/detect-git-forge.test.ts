import { describe, expect, it } from "vitest";

import {
  detectGitForge,
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
    expect(
      normalizeGitCloneUrl("https://gitlab.com/owner/repo.git")
    ).toBe("https://gitlab.com/owner/repo.git");
  });
});

describe("detectGitForge", () => {
  it("routes GitHub to the GitHub API", () => {
    expect(detectGitForge("https://github.com/a/b").useGithubApi).toBe(true);
  });

  it("routes GitLab / Codeberg / Gitea to git clone", () => {
    expect(detectGitForge("https://gitlab.com/a/b").type).toBe("gitlab");
    expect(detectGitForge("https://codeberg.org/a/b").useGithubApi).toBe(
      false
    );
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
