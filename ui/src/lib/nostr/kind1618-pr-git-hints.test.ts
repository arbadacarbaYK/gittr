import { describe, expect, it } from "vitest";

import { parseKind1618PrGitHints } from "./kind1618-pr-git-hints";

describe("parseKind1618PrGitHints", () => {
  it("reads clone, c, merge-base, and branch-name", () => {
    const hints = parseKind1618PrGitHints([
      [
        "a",
        "30617:9a83779e75080556c656d4d418d02a4d7edbe288a2f9e6dd2b48799ec935184c:gittr-mcp",
      ],
      ["subject", "fix: align MCP server version with package release"],
      ["c", "5ce5c6b9c40edff54b55345e5b2c207237d4ca5c"],
      ["merge-base", "4eeab4318c8aed3b89d6d213b09551cbc3a6823e"],
      [
        "clone",
        "https://git.shakespeare.diy/npub1n2ph08n4pqz4d3jk6n2p35p2f4ldhc5g5tu7dhftfpueajf4rpxqfjhzmc/gittr-mcp.git",
      ],
      ["branch-name", "version-release-alignment"],
      ["r", "fab5cb7fa1b938de2ff32d8997c3553c1ccb6570"],
    ]);
    expect(hints.currentCommitId).toBe(
      "5ce5c6b9c40edff54b55345e5b2c207237d4ca5c"
    );
    expect(hints.mergeBase).toBe("4eeab4318c8aed3b89d6d213b09551cbc3a6823e");
    expect(hints.branchName).toBe("version-release-alignment");
    expect(hints.cloneUrls[0]).toContain("shakespeare.diy");
  });

  it("accepts several clone URLs on one tag", () => {
    const hints = parseKind1618PrGitHints([
      [
        "clone",
        "https://git.gittr.space/npub1abc/repo.git",
        "https://git.shakespeare.diy/npub1abc/repo.git",
      ],
    ]);
    expect(hints.cloneUrls).toHaveLength(2);
  });
});
