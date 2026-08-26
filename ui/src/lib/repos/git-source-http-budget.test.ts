import { describe, expect, it } from "vitest";

import {
  gitSourceHttpInflight,
  noteGitSourceHttpEnd,
  noteGitSourceHttpStart,
  waitForGitSourceHttpIdle,
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
});
