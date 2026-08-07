import { describe, expect, it } from "vitest";

import { filterDisplayCloneUrlsForSidebar } from "./filter-display-clone-urls";

describe("filterDisplayCloneUrlsForSidebar", () => {
  const urls = [
    "https://git.gittr.space/npub1abc/repo.git",
    "https://git.shakespeare.diy/npub1abc/repo.git",
    "https://gitnostr.com/npub1abc/repo.git",
    "https://relay.ngit.dev/npub1abc/repo.git",
    "https://github.com/org/repo.git",
    "http://23.1.2.3:7334/npub1abc/repo.git",
  ];

  it("keeps pushable GRASP mirrors plus forge source and primary", () => {
    const out = filterDisplayCloneUrlsForSidebar(urls, {
      primaryGitServerEnv: "https://git.gittr.space",
      sourceUrl: "https://github.com/org/repo",
    });
    expect(out).toContain("https://git.gittr.space/npub1abc/repo.git");
    expect(out).toContain("https://git.shakespeare.diy/npub1abc/repo.git");
    expect(out).toContain("https://gitnostr.com/npub1abc/repo.git");
    expect(out).toContain("https://relay.ngit.dev/npub1abc/repo.git");
    expect(out).toContain("https://github.com/org/repo.git");
    expect(out.some((u) => u.includes("23.1.2.3"))).toBe(false);
  });
});
