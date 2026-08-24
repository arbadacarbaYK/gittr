import { describe, expect, it } from "vitest";

import {
  announcementEventMatchesRepo,
  isHexEventId,
} from "./repo-announcement-match";

describe("isHexEventId", () => {
  it("accepts 64-char hex and rejects short ids", () => {
    expect(isHexEventId("a".repeat(64))).toBe(true);
    expect(isHexEventId("abc")).toBe(false);
    expect(isHexEventId(undefined)).toBe(false);
  });
});

describe("announcementEventMatchesRepo", () => {
  const author =
    "b3c95ce33dfa84326611e8b7a9c10b78df28754c38b106a4bc0196b9be5f4e4a";

  it("matches d tags case-insensitively so Star can find the 30617", () => {
    const event = {
      tags: [["d", "AmberSocket"]],
    };
    expect(announcementEventMatchesRepo(event, author, ["ambersocket"])).toBe(
      true
    );
  });

  it("rejects a different d tag", () => {
    const event = {
      tags: [["d", "other"]],
    };
    expect(announcementEventMatchesRepo(event, author, ["ambersocket"])).toBe(
      false
    );
  });
});
