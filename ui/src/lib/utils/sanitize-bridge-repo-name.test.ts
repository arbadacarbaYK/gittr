import { describe, expect, it } from "vitest";

import {
  resolveBridgeRepoPath,
  sanitizeBridgeRepoName,
} from "./sanitize-bridge-repo-name";

describe("sanitizeBridgeRepoName", () => {
  it("accepts bridge-valid names", () => {
    expect(sanitizeBridgeRepoName("my-repo")).toBe("my-repo");
    expect(sanitizeBridgeRepoName("foo_bar")).toBe("foo_bar");
    expect(sanitizeBridgeRepoName("VenueScheduler")).toBe("VenueScheduler");
    expect(sanitizeBridgeRepoName("my%2Drepo")).toBe("my-repo");
    expect(sanitizeBridgeRepoName("repo.git")).toBe("repo");
  });

  it("rejects traversal and Go-invalid names", () => {
    expect(sanitizeBridgeRepoName("..")).toBe("");
    expect(sanitizeBridgeRepoName("../x")).toBe("");
    expect(sanitizeBridgeRepoName("a/b")).toBe("");
    expect(sanitizeBridgeRepoName("/etc/passwd")).toBe("");
    expect(sanitizeBridgeRepoName("a\\b")).toBe("");
    expect(sanitizeBridgeRepoName("foo.bar")).toBe("");
    expect(sanitizeBridgeRepoName("a b")).toBe("");
    expect(sanitizeBridgeRepoName("Venue%20Scheduler")).toBe("");
    expect(sanitizeBridgeRepoName("%2e%2e%2fx")).toBe("");
    expect(sanitizeBridgeRepoName("")).toBe("");
  });
});

describe("resolveBridgeRepoPath", () => {
  it("keeps paths under owner dir", () => {
    const owner = "a".repeat(64);
    const r = resolveBridgeRepoPath("/repos", owner, "my-repo");
    expect(r).not.toBeNull();
    expect(r!.repoPath).toBe(`/repos/${owner}/my-repo.git`);
  });

  it("rejects escape attempts", () => {
    const owner = "a".repeat(64);
    expect(resolveBridgeRepoPath("/repos", owner, "../evil")).toBeNull();
    expect(resolveBridgeRepoPath("/repos", "nothex", "my-repo")).toBeNull();
  });
});
