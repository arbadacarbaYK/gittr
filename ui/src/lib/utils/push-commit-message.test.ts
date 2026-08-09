import { describe, expect, it } from "vitest";
import {
  formatPushFromGittrStamp,
  resolveBridgePushCommitMessage,
} from "./push-commit-message";

describe("formatPushFromGittrStamp", () => {
  it("formats yy-mm-dd hh:mm UTC", () => {
    // 2026-08-08T23:57:53.000Z
    expect(formatPushFromGittrStamp(1786233473)).toBe(
      "Push from gittr (26-08-08 23:57)"
    );
  });
});

describe("resolveBridgePushCommitMessage", () => {
  it("uses caller message when present", () => {
    expect(resolveBridgePushCommitMessage("fix: widget", 1786233473)).toBe(
      "fix: widget"
    );
  });

  it("falls back to stamp when empty", () => {
    expect(resolveBridgePushCommitMessage("  ", 1786233473)).toBe(
      "Push from gittr (26-08-08 23:57)"
    );
    expect(resolveBridgePushCommitMessage(undefined, 1786233473)).toBe(
      "Push from gittr (26-08-08 23:57)"
    );
  });
});
