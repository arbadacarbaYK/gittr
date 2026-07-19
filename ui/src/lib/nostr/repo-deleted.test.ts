import { describe, expect, it } from "vitest";

import {
  applyDeletionMarkersToRepoData,
  deletionMarkersFromEvent,
  isRepoAnnouncementDeleted,
} from "./repo-deleted";

describe("repo-deleted", () => {
  it("detects deleted:true from 30617 content JSON", () => {
    expect(
      isRepoAnnouncementDeleted({
        tags: [["d", "is-this-thing-on"]],
        content: JSON.stringify({
          deleted: true,
          publicRead: true,
          publicWrite: false,
        }),
      })
    ).toBe(true);
  });

  it("detects deleted tag", () => {
    expect(
      deletionMarkersFromEvent({
        tags: [
          ["d", "x"],
          ["deleted", "true"],
        ],
        content: "",
      })
    ).toEqual({ deleted: true });
  });

  it("detects archived from content", () => {
    expect(
      isRepoAnnouncementDeleted({
        tags: [["d", "x"]],
        content: '{"archived":true}',
      })
    ).toBe(true);
  });

  it("does not treat normal announcements as deleted", () => {
    expect(
      isRepoAnnouncementDeleted({
        tags: [
          ["d", "spanglish"],
          ["name", "spanglish"],
        ],
        content: "",
      })
    ).toBe(false);
  });

  it("applyDeletionMarkersToRepoData sets flags", () => {
    const repo: { deleted?: boolean; archived?: boolean } = {};
    applyDeletionMarkersToRepoData(repo, {
      tags: [["status", "deleted"]],
      content: "",
    });
    expect(repo.deleted).toBe(true);
  });
});
