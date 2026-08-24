import { describe, expect, it } from "vitest";

import {
  gittrForkPointer,
  importApiForUrl,
  isGithubOwnerRepoShorthand,
  parseGittrRepoPointer,
  pickForkImportUrls,
  rewriteGittrWebUrlToGitRemote,
} from "./fork-import-source";

const NPUB = "npub1n2ph08n4pqz4d3jk6n2p35p2f4ldhc5g5tu7dhftfpueajf4rpxqfjhzmc";

describe("parseGittrRepoPointer", () => {
  it("parses npub/repo and gittr.space web URLs", () => {
    expect(parseGittrRepoPointer(`${NPUB}/picorgan`)).toEqual({
      entity: NPUB,
      repo: "picorgan",
    });
    expect(
      parseGittrRepoPointer(`https://gittr.space/${NPUB}/picorgan`)
    ).toEqual({
      entity: NPUB,
      repo: "picorgan",
    });
  });

  it("rejects GitHub owner/repo shorthand", () => {
    expect(parseGittrRepoPointer("AndronixApp/AndronixOrigin")).toBeNull();
  });
});

describe("isGithubOwnerRepoShorthand", () => {
  it("accepts GitHub owner/repo and rejects npub pointers", () => {
    expect(isGithubOwnerRepoShorthand("owner/repo")).toBe(true);
    expect(isGithubOwnerRepoShorthand(`${NPUB}/picorgan`)).toBe(false);
  });
});

describe("rewriteGittrWebUrlToGitRemote", () => {
  it("maps the website URL to git.gittr.space", () => {
    expect(
      rewriteGittrWebUrlToGitRemote(`https://gittr.space/${NPUB}/picorgan`)
    ).toBe(`https://git.gittr.space/${NPUB}/picorgan.git`);
  });

  it("leaves GitHub URLs alone", () => {
    expect(
      rewriteGittrWebUrlToGitRemote("https://github.com/owner/repo")
    ).toBeNull();
  });
});

describe("pickForkImportUrls", () => {
  it("prefers a forge source over GRASP clones", () => {
    const urls = pickForkImportUrls({
      sourceUrl: "https://github.com/owner/picorgan",
      clone: [`https://git.gittr.space/${NPUB}/picorgan.git`],
      forkEntity: NPUB,
      forkRepo: "picorgan",
    });
    expect(urls[0]).toEqual({
      url: "https://github.com/owner/picorgan",
      via: "forge-source",
    });
    expect(urls.some((u) => u.via === "clone")).toBe(true);
  });

  it("uses clone tags for nostr-only repos", () => {
    const urls = pickForkImportUrls({
      clone: [`https://git.gittr.space/${NPUB}/picorgan.git`],
      forkEntity: NPUB,
      forkRepo: "picorgan",
    });
    expect(urls[0]?.via).toBe("clone");
    expect(urls[0]?.url).toContain("git.gittr.space");
  });

  it("infers GRASP clones when nothing else is known", () => {
    const urls = pickForkImportUrls({
      forkEntity: NPUB,
      forkRepo: "picorgan",
    });
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.every((u) => u.via === "inferred-grasp")).toBe(true);
    expect(urls[0]?.url).toContain(`${NPUB}/picorgan.git`);
  });
});

describe("gittrForkPointer", () => {
  it("stores a /npub/repo parent pointer", () => {
    expect(gittrForkPointer(NPUB, "picorgan")).toBe(`/${NPUB}/picorgan`);
  });
});

describe("importApiForUrl", () => {
  it("uses GitHub API for github.com and git clone otherwise", () => {
    expect(importApiForUrl("https://github.com/a/b")).toBe("github");
    expect(
      importApiForUrl(`https://git.gittr.space/${NPUB}/picorgan.git`)
    ).toBe("git");
  });
});
