import { describe, expect, it } from "vitest";

import { normalizeGithubSourceUrl } from "../utils/normalize-github-source-url";
import { isRenderableRepoName } from "./renderable-repo-name";

describe("isRenderableRepoName", () => {
  it("accepts normal repo names", () => {
    expect(isRenderableRepoName("gittr")).toBe(true);
    expect(isRenderableRepoName("my-repo_2")).toBe(true);
  });

  it("accepts dotted names (upstream repos like next.js)", () => {
    expect(isRenderableRepoName("next.js")).toBe(true);
  });

  it("rejects foreign storage-path identifiers with slashes", () => {
    expect(
      isRenderableRepoName(
        "11c48131bda6f893a3821c36435f7405c967b93eb82e43b336f0cd2e188dfaad/gamestr"
      )
    ).toBe(false);
  });

  it("rejects URL-encoded slashes (route segments arrive encoded)", () => {
    expect(isRenderableRepoName("11c48131%2Fgamestr")).toBe(false);
  });

  it("rejects traversal, backslashes, controls, and empties", () => {
    expect(isRenderableRepoName("..")).toBe(false);
    expect(isRenderableRepoName("a\\b")).toBe(false);
    expect(isRenderableRepoName("a\u0000b")).toBe(false);
    expect(isRenderableRepoName("")).toBe(false);
    expect(isRenderableRepoName(undefined)).toBe(false);
  });
});

describe("normalizeGithubSourceUrl localhost guard", () => {
  it("still repairs mistaken-org URLs", () => {
    // URL parsing lowercases hostnames, so the mistaken org arrives lowercase.
    expect(normalizeGithubSourceUrl("https://PMK/week_calendar")).toBe(
      "https://github.com/pmk/week_calendar"
    );
  });

  it("never rewrites localhost dev URLs into fake GitHub URLs", () => {
    expect(
      normalizeGithubSourceUrl("http://localhost:5444/forge/abc/gamestr.git")
    ).toBe("http://localhost:5444/forge/abc/gamestr.git");
    expect(normalizeGithubSourceUrl("http://localhost/forge")).toBe(
      "http://localhost/forge"
    );
  });

  it("never rewrites dotless hosts with explicit ports", () => {
    expect(normalizeGithubSourceUrl("http://devbox:3000/owner/repo")).toBe(
      "http://devbox:3000/owner/repo"
    );
  });
});
