import { describe, expect, it } from "vitest";

import {
  gitSourceHttpInflight,
  noteGitSourceHttpEnd,
  noteGitSourceHttpStart,
  waitForGitSourceHttpIdle,
  withGitSourceHttp,
} from "./git-source-http-budget";

describe("git-source-http-budget", () => {
  it("reaches idle after matching start/end", async () => {
    while (gitSourceHttpInflight() > 0) noteGitSourceHttpEnd();
    noteGitSourceHttpStart();
    expect(gitSourceHttpInflight()).toBe(1);
    const idle = waitForGitSourceHttpIdle(2000);
    noteGitSourceHttpEnd();
    await idle;
    expect(gitSourceHttpInflight()).toBe(0);
  });

  it("wraps a promise so waiters see idle even when the work throws", async () => {
    while (gitSourceHttpInflight() > 0) noteGitSourceHttpEnd();
    const idle = waitForGitSourceHttpIdle(2000);
    await expect(
      withGitSourceHttp(async () => {
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");
    await idle;
    expect(gitSourceHttpInflight()).toBe(0);
  });
});
