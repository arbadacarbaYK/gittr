import { describe, expect, it } from "vitest";

import { lsRemoteStdoutHasRefs } from "./remote-has-git-refs";

describe("lsRemoteStdoutHasRefs", () => {
  it("is true when a branch SHA is listed", () => {
    expect(
      lsRemoteStdoutHasRefs(
        "8a000f74e27ef6639a5048719b64c569e9756a01\trefs/heads/main\n"
      )
    ).toBe(true);
  });

  it("is false for an empty bare repo", () => {
    expect(lsRemoteStdoutHasRefs("")).toBe(false);
    expect(lsRemoteStdoutHasRefs("\n")).toBe(false);
  });
});
