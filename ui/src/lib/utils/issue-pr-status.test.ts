import { describe, expect, it } from "vitest";

import {
  findIssueRowIndexByRouteParam,
  findPullRequestRowIndexByRouteParam,
  issueOrPrDisplayNumber,
  mergeGithubIssuesAfterRefetch,
  mergeGithubPrsAfterRefetch,
  shareableIssueOrPrPathId,
} from "./issue-pr-status";

const NOSTR_HEX_A =
  "127dbf67c5af53b1ed5b5f94f830f96affab7961f92437bc95fa02f50e8553ca";
const NOSTR_HEX_B =
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

describe("findPullRequestRowIndexByRouteParam", () => {
  it("opens GitHub PR #N by forge id, not the Nth row in a recency-sorted list", () => {
    const rows = [
      { id: NOSTR_HEX_A, number: "99", title: "unrelated nostr" },
      { id: "pr-12", number: "12", title: "the github pr" },
    ];
    while (rows.length < 12) {
      rows.push({
        id: `pr-${100 + rows.length}`,
        number: String(100 + rows.length),
        title: "padding",
      });
    }
    const idx = findPullRequestRowIndexByRouteParam(rows, "12");
    expect(idx).toBe(1);
    expect(rows[idx]?.title).toBe("the github pr");
  });

  it("does not prefer an unrelated Nostr row sitting at array index N", () => {
    const rows = Array.from({ length: 12 }, (_, i) =>
      i === 11
        ? { id: NOSTR_HEX_A, number: "3", title: "wrong" }
        : { id: `pr-${i + 1}`, number: String(i + 1), title: `gh ${i + 1}` }
    );
    rows[4] = { id: "pr-12", number: "12", title: "clicked" };
    expect(findPullRequestRowIndexByRouteParam(rows, "12")).toBe(4);
    expect(findIssueRowIndexByRouteParam(rows, "12")).toBe(4);
  });

  it("prefers pr-N over a Nostr row that reused the same local number", () => {
    const rows = [
      { id: NOSTR_HEX_B, number: "12", title: "local nostr #12" },
      { id: "pr-12", number: "12", title: "github #12" },
    ];
    expect(findPullRequestRowIndexByRouteParam(rows, "12")).toBe(1);
  });

  it("still finds a Nostr-only PR by its local display number", () => {
    const rows = [{ id: NOSTR_HEX_A, number: "2", title: "nostr only" }];
    expect(findPullRequestRowIndexByRouteParam(rows, "2")).toBe(0);
    expect(findPullRequestRowIndexByRouteParam(rows, NOSTR_HEX_A)).toBe(0);
  });
});

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

  it("keeps closed GitHub PRs when the refetch is open-only", () => {
    const existing = [
      { id: "pr-40", number: "40", status: "closed", title: "old closed" },
      { id: "pr-41", number: "41", status: "open", title: "still open" },
    ];
    const githubRows = [
      { id: "pr-41", number: "41", status: "open", title: "still open" },
    ];
    const merged = mergeGithubPrsAfterRefetch(existing, githubRows) as Array<{
      id?: string;
      status?: string;
    }>;
    const ids = merged.map((r) => r.id).sort();
    expect(ids).toEqual(["pr-40", "pr-41"]);
    expect(merged.find((r) => r.id === "pr-40")?.status).toBe("closed");
  });
});

describe("mergeGithubIssuesAfterRefetch", () => {
  it("keeps closed GitHub issues when the refetch is open-only", () => {
    const existing = [
      { id: "issue-3", number: "3", status: "closed", title: "done" },
      { id: "issue-4", number: "4", status: "open", title: "wip" },
    ];
    const githubRows = [
      { id: "issue-4", number: "4", status: "open", title: "wip" },
    ];
    const merged = mergeGithubIssuesAfterRefetch(
      existing,
      githubRows
    ) as Array<{
      id?: string;
    }>;
    const ids = merged.map((r) => r.id).sort();
    expect(ids).toEqual(["issue-3", "issue-4"]);
  });
});

describe("shareableIssueOrPrPathId", () => {
  it("uses the Nostr event id, not the local #2", () => {
    expect(
      shareableIssueOrPrPathId({
        id: NOSTR_HEX_A,
        number: "2",
      })
    ).toBe(NOSTR_HEX_A);
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
        id: NOSTR_HEX_A,
        number: "2",
      })
    ).toBe("2");
  });
});
