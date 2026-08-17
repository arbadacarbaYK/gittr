import { describe, expect, it } from "vitest";

import {
  applyGithubForkMetaToRepo,
  githubParentForkedFrom,
  isDisplayableForkAttribution,
  isGittrForkPointer,
  isRealForkAttribution,
  resolveStoredForkedFrom,
  sanitizeForkedFromField,
} from "./fork-attribution";

describe("isGittrForkPointer", () => {
  it("accepts npub and /entity/repo forks", () => {
    expect(
      isGittrForkPointer(
        "/npub1n2ph08n4pqz4d3jk6n2p35p2f4ldhc5g5tu7dhftfpueajf4rpxqfjhzmc/gittr"
      )
    ).toBe(true);
    expect(
      isGittrForkPointer(
        "npub1n2ph08n4pqz4d3jk6n2p35p2f4ldhc5g5tu7dhftfpueajf4rpxqfjhzmc/gittr"
      )
    ).toBe(true);
  });

  it("rejects GitHub shorthand and URLs", () => {
    expect(isGittrForkPointer("AndronixApp/AndronixOrigin")).toBe(false);
    expect(isGittrForkPointer("https://github.com/a/b")).toBe(false);
  });
});

describe("isDisplayableForkAttribution", () => {
  it("rejects own GRASP shakespeare clone URLs", () => {
    expect(
      isDisplayableForkAttribution(
        "https://git.shakespeare.diy/npub1n2ph08n4pqz4d3jk6n2p35p2f4ldhc5g5tu7dhftfpueajf4rpxqfjhzmc/local-agent"
      )
    ).toBe(false);
  });

  it("rejects gittr / ngit grasp paths", () => {
    expect(
      isDisplayableForkAttribution("https://git.gittr.space/npub1abc/repo.git")
    ).toBe(false);
  });

  it("accepts real forge upstreams", () => {
    expect(
      isDisplayableForkAttribution("https://github.com/other/project")
    ).toBe(true);
    expect(isDisplayableForkAttribution("https://codeberg.org/org/repo")).toBe(
      true
    );
  });

  it("rejects this repo’s own GitHub URL", () => {
    expect(
      isDisplayableForkAttribution("https://github.com/me/gittr-mcp", {
        sourceUrl: "https://github.com/me/gittr-mcp",
      })
    ).toBe(false);
  });

  it("accepts a gittr npub/repo fork pointer", () => {
    expect(
      isDisplayableForkAttribution(
        "/npub1n2ph08n4pqz4d3jk6n2p35p2f4ldhc5g5tu7dhftfpueajf4rpxqfjhzmc/gittr"
      )
    ).toBe(true);
  });
});

describe("sanitizeForkedFromField", () => {
  it("clears grasp URLs and keeps github", () => {
    expect(
      sanitizeForkedFromField(
        "https://git.shakespeare.diy/npub1aaa/local-agent.git"
      )
    ).toBeUndefined();
    expect(sanitizeForkedFromField("https://github.com/a/b.git")).toBe(
      "https://github.com/a/b"
    );
  });

  it("clears self-import GitHub URLs that duplicate sourceUrl", () => {
    expect(
      sanitizeForkedFromField("https://github.com/me/gittr-mcp.git", {
        sourceUrl: "https://github.com/me/gittr-mcp",
      })
    ).toBeUndefined();
  });

  it("keeps gittr fork pointers", () => {
    expect(
      sanitizeForkedFromField(
        "/npub1n2ph08n4pqz4d3jk6n2p35p2f4ldhc5g5tu7dhftfpueajf4rpxqfjhzmc/repo"
      )
    ).toBe(
      "/npub1n2ph08n4pqz4d3jk6n2p35p2f4ldhc5g5tu7dhftfpueajf4rpxqfjhzmc/repo"
    );
  });
});

describe("githubParentForkedFrom", () => {
  it("returns parent only when GitHub marks a different repo as a fork", () => {
    expect(
      githubParentForkedFrom({
        htmlUrl: "https://github.com/me/andronixorigin",
        isFork: true,
        parentHtmlUrl: "https://github.com/AndronixApp/AndronixOrigin",
      })
    ).toBe("https://github.com/AndronixApp/AndronixOrigin");
    expect(
      githubParentForkedFrom({
        htmlUrl: "https://github.com/me/gittr",
        isFork: false,
        parentHtmlUrl: "https://github.com/other/gittr",
      })
    ).toBeUndefined();
    expect(
      githubParentForkedFrom({
        htmlUrl: "https://github.com/me/gittr",
        isFork: true,
        parentHtmlUrl: "https://github.com/me/gittr",
      })
    ).toBeUndefined();
  });
});

describe("resolveStoredForkedFrom", () => {
  it("clears a self-import URL when GitHub says it is not a fork", () => {
    expect(
      resolveStoredForkedFrom({
        existingForkedFrom: "https://github.com/me/gittr-mcp",
        sourceUrl: "https://github.com/me/gittr-mcp",
        githubIsFork: false,
        githubHtmlUrl: "https://github.com/me/gittr-mcp",
      })
    ).toBeUndefined();
  });

  it("uses GitHub parent for a real GitHub fork", () => {
    expect(
      resolveStoredForkedFrom({
        existingForkedFrom: "https://github.com/me/andronixorigin",
        sourceUrl: "https://github.com/me/andronixorigin",
        githubIsFork: true,
        githubHtmlUrl: "https://github.com/me/andronixorigin",
        githubParentHtmlUrl: "https://github.com/AndronixApp/AndronixOrigin",
      })
    ).toBe("https://github.com/AndronixApp/AndronixOrigin");
  });

  it("keeps a gittr fork pointer even when a GitHub source exists", () => {
    expect(
      resolveStoredForkedFrom({
        existingForkedFrom:
          "/npub1n2ph08n4pqz4d3jk6n2p35p2f4ldhc5g5tu7dhftfpueajf4rpxqfjhzmc/gittr",
        sourceUrl: "https://github.com/me/gittr",
        githubIsFork: false,
      })
    ).toBe(
      "/npub1n2ph08n4pqz4d3jk6n2p35p2f4ldhc5g5tu7dhftfpueajf4rpxqfjhzmc/gittr"
    );
  });
});

describe("applyGithubForkMetaToRepo", () => {
  it("adds parent when GitHub reports a fork", () => {
    const row = {
      sourceUrl: "https://github.com/me/ChicksOnTheBlocks",
      forkedFrom: undefined as string | undefined,
    };
    const out = applyGithubForkMetaToRepo(row, {
      isFork: true,
      htmlUrl: row.sourceUrl,
      parentHtmlUrl: "https://github.com/bitcointurm/Satoshi24",
    });
    expect(out.forkedFrom).toBe("https://github.com/bitcointurm/Satoshi24");
  });

  it("leaves row unchanged when GitHub says not a fork", () => {
    const row = {
      sourceUrl: "https://github.com/AndronixApp/AndronixOrigin",
    };
    expect(
      applyGithubForkMetaToRepo(row, {
        isFork: false,
        htmlUrl: row.sourceUrl,
      })
    ).toBe(row);
  });
});

describe("isRealForkAttribution", () => {
  it("treats self-import as not a fork and parent URL as a fork", () => {
    expect(
      isRealForkAttribution("https://github.com/me/gittr", {
        sourceUrl: "https://github.com/me/gittr",
      })
    ).toBe(false);
    expect(
      isRealForkAttribution("https://github.com/AndronixApp/AndronixOrigin", {
        sourceUrl: "https://github.com/me/andronixorigin",
      })
    ).toBe(true);
  });
});
