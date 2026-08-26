import { describe, expect, it } from "vitest";

import { parseGithubLinkLastPage } from "./insights-github";

describe("parseGithubLinkLastPage", () => {
  it("reads rel=last page when per_page=1", () => {
    const link =
      '<https://api.github.com/repositories/1/commits?per_page=1&page=2>; rel="next", <https://api.github.com/repositories/1/commits?per_page=1&page=8472>; rel="last"';
    expect(parseGithubLinkLastPage(link)).toBe(8472);
  });

  it("returns null when there is no last rel", () => {
    expect(parseGithubLinkLastPage(null)).toBeNull();
    expect(
      parseGithubLinkLastPage(
        '<https://api.github.com/repositories/1/commits?per_page=1&page=2>; rel="next"'
      )
    ).toBeNull();
  });
});
