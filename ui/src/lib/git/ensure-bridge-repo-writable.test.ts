import { describe, expect, it } from "vitest";

import { gitDirAllowsGroupWrite } from "./ensure-bridge-repo-writable";

describe("gitDirAllowsGroupWrite", () => {
  it("rejects a root-owned bare repo", () => {
    expect(gitDirAllowsGroupWrite("root root 755")).toBe(false);
  });

  it("rejects git-nostr ownership without group write", () => {
    expect(gitDirAllowsGroupWrite("git-nostr git-nostr 755")).toBe(false);
  });

  it("accepts group-writable git-nostr dirs, including setgid", () => {
    expect(gitDirAllowsGroupWrite("git-nostr git-nostr 775")).toBe(true);
    expect(gitDirAllowsGroupWrite("git-nostr git-nostr 2775")).toBe(true);
  });
});
