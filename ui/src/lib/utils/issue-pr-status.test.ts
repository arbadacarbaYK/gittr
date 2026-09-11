import { describe, expect, it } from "vitest";

import {
  issueOrPrDisplayNumber,
  mergeGithubPrsAfterRefetch,
  shareableIssueOrPrPathId,
} from "./issue-pr-status";

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

describe("shareableIssueOrPrPathId", () => {
  it("uses the Nostr event id, not the local #2", () => {
    expect(
      shareableIssueOrPrPathId({
        id: "127dbf67c5af53b1ed5b5f94f830f96affab7961f92437bc95fa02f50e8553ca",
        number: "2",
      })
    ).toBe("127dbf67c5af53b1ed5b5f94f830f96affab7961f92437bc95fa02f50e8553ca");
  });

  it("keeps GitHub/Gitea forge numbers", () => {
    expect(shareableIssueOrPrPathId({ id: "issue-12", number: "12" })).toBe(
      "12"
    );
    expect(shareableIssueOrPrPathId({ id: "pr-4", number: "4" })).toBe("4");
  });
});

describe("issueOrPrDisplayNumber", () => {
  it("shows the local number in the UI", () => {
    expect(
      issueOrPrDisplayNumber({
        id: "127dbf67c5af53b1ed5b5f94f830f96affab7961f92437bc95fa02f50e8553ca",
        number: "2",
      })
    ).toBe("2");
  });
});
