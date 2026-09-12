import { describe, expect, it } from "vitest";

import { parseGitLogPipeLines } from "./parse-git-log-pipe";

describe("parseGitLogPipeLines", () => {
  it("parses hash, subject, author, and unix seconds to ms", () => {
    const rows = parseGitLogPipeLines(
      "01b3e287781c007d8eefa1f3d21d3a762eb45bdd|init|Ada|ada@example.com|1700000000|abc def\n",
      "main"
    );
    expect(rows).toEqual([
      {
        id: "01b3e287781c007d8eefa1f3d21d3a762eb45bdd",
        message: "init",
        author: "Ada",
        authorEmail: "ada@example.com",
        timestamp: 1700000000 * 1000,
        branch: "main",
        parentIds: ["abc", "def"],
      },
    ]);
  });

  it("skips truncated lines", () => {
    expect(parseGitLogPipeLines("only-hash")).toEqual([]);
  });
});
