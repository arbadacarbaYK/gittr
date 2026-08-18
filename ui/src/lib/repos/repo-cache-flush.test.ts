import { describe, expect, it } from "vitest";

import {
  classifyForeignReposForFlush,
  classifyOwnReposForFlush,
  uniqueReposByOwnerAndName,
} from "./repo-cache-flush";

const ME = "aa".repeat(32);
const OTHER = "bb".repeat(32);
const OTHER2 = "cc".repeat(32);

function catalogRepo(
  ownerPubkey: string,
  name: string,
  extra: Record<string, unknown> = {}
) {
  return {
    entity: ownerPubkey,
    ownerPubkey,
    repositoryName: name,
    repo: name,
    name,
    ...extra,
  };
}

const isMine = (repo: { ownerPubkey?: string }) => repo.ownerPubkey === ME;

describe("repo cache flush counts", () => {
  it("collapses duplicate catalog rows of the same other-people repo", () => {
    const repos = [
      catalogRepo(ME, "mine"),
      catalogRepo(OTHER, "alpha"),
      catalogRepo(OTHER, "alpha"),
      catalogRepo(OTHER, "beta"),
      catalogRepo(OTHER2, "gamma"),
    ];
    expect(uniqueReposByOwnerAndName(repos)).toHaveLength(4);

    const classified = classifyForeignReposForFlush(repos, isMine);
    expect(classified.foreignRepos).toHaveLength(3);
    expect(classified.keptOwnRepos).toBe(1);
    expect(classified.duplicateRowsCollapsed).toBe(1);
    expect(classified.keptForeignLocal).toBe(0);
  });

  it("does not count unpushed local other-people repos as yours", () => {
    const classified = classifyForeignReposForFlush(
      [
        catalogRepo(ME, "mine"),
        catalogRepo(OTHER, "draft", { status: "local" }),
        catalogRepo(OTHER2, "explore-leftover"),
      ],
      isMine
    );
    expect(classified.foreignRepos).toHaveLength(1);
    expect(classified.foreignRepos[0].repo).toBe("explore-leftover");
    expect(classified.keptOwnRepos).toBe(1);
    expect(classified.keptForeignLocal).toBe(1);
    expect(classified.keptRepos).toHaveLength(2);
  });

  it("counts unique own repos and leaves others", () => {
    const classified = classifyOwnReposForFlush(
      [
        catalogRepo(ME, "gittr"),
        catalogRepo(ME, "gittr"),
        catalogRepo(ME, "lab"),
        catalogRepo(OTHER, "someone-else"),
      ],
      isMine
    );
    expect(classified.ownRepos).toHaveLength(2);
    expect(classified.keptRepos).toHaveLength(1);
    expect(classified.duplicateRowsCollapsed).toBe(1);
  });

  it("second pass after dropping foreign unique repos is empty", () => {
    const first = classifyForeignReposForFlush(
      [
        catalogRepo(ME, "mine"),
        catalogRepo(OTHER, "alpha"),
        catalogRepo(OTHER, "alpha"),
      ],
      isMine
    );
    const second = classifyForeignReposForFlush(first.keptRepos, isMine);
    expect(second.foreignRepos).toHaveLength(0);
    expect(second.duplicateRowsCollapsed).toBe(0);
    expect(second.keptOwnRepos).toBe(1);
  });
});
