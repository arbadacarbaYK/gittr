import { describe, expect, it } from "vitest";

import {
  applyPrivacyTagsToRepoData,
  isPublicReadFromEvent,
  publicReadFromTags,
  publicWriteFromTags,
} from "./repo-public-read";

describe("repo-public-read", () => {
  it("reads public-read false from tags", () => {
    expect(
      publicReadFromTags([
        ["d", "spanglish"],
        ["public-read", "false"],
      ])
    ).toBe(false);
  });

  it("treats missing tag as undefined (caller defaults to public)", () => {
    expect(publicReadFromTags([["d", "spanglish"]])).toBeUndefined();
  });

  it("isPublicReadFromEvent defaults missing tag to public", () => {
    expect(
      isPublicReadFromEvent({
        kind: 30617,
        tags: [["d", "x"]],
        content: "",
        created_at: 1,
        pubkey: "a".repeat(64),
        id: "b".repeat(64),
        sig: "c".repeat(128),
      } as any)
    ).toBe(true);
  });

  it("isPublicReadFromEvent honors public-read false", () => {
    expect(
      isPublicReadFromEvent({
        kind: 30617,
        tags: [
          ["d", "spanglish"],
          ["public-read", "false"],
        ],
        content: "",
        created_at: 1,
        pubkey: "a".repeat(64),
        id: "b".repeat(64),
        sig: "c".repeat(128),
      } as any)
    ).toBe(false);
  });

  it("applyPrivacyTagsToRepoData sets private from tags", () => {
    const repo: { publicRead?: boolean; publicWrite?: boolean } = {};
    applyPrivacyTagsToRepoData(repo, [
      ["public-read", "false"],
      ["public-write", "false"],
    ]);
    expect(repo.publicRead).toBe(false);
    expect(repo.publicWrite).toBe(false);
    expect(publicWriteFromTags([["public-write", "true"]])).toBe(true);
  });
});
