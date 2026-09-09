import { describe, expect, it } from "vitest";

import { mergeGithubPrsAfterRefetch } from "./issue-pr-status";

describe("mergeGithubPrsAfterRefetch", () => {
  it("keeps hydrated diffs when GitHub list refetch is metadata-only", () => {
    const existing = [
      {
        id: "pr-12",
        number: "12",
        status: "open",
        changedFiles: [
          { path: "server.js", status: "modified", after: "@@ -1 +1 @@\n" },
        ],
      },
    ];
    const githubRows = [
      {
        id: "pr-12",
        number: "12",
        status: "open",
        title: "deps",
        html_url: "https://github.com/o/r/pull/12",
      },
    ];
    const merged = mergeGithubPrsAfterRefetch(existing, githubRows) as Array<{
      changedFiles?: unknown[];
      title?: string;
    }>;
    expect(merged).toHaveLength(1);
    expect(merged[0]!.title).toBe("deps");
    expect(merged[0]!.changedFiles).toHaveLength(1);
  });
});
