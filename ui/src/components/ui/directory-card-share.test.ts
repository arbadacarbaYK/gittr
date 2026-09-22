import { describe, expect, it } from "vitest";

import { directoryCardShareUrl } from "./directory-card-share";

describe("directoryCardShareUrl", () => {
  it("keeps a live https site and prefixes a gittr app path", () => {
    expect(
      directoryCardShareUrl(
        "https://gitnostr.pages.gittr.space",
        "https://gittr.space"
      )
    ).toBe("https://gitnostr.pages.gittr.space");
    expect(
      directoryCardShareUrl("/apps/space.gittr.app", "https://gittr.space")
    ).toBe("https://gittr.space/apps/space.gittr.app");
  });

  it("drops empty and non-http targets", () => {
    expect(directoryCardShareUrl("", "https://gittr.space")).toBe("");
    expect(
      directoryCardShareUrl("javascript:alert(1)", "https://gittr.space")
    ).toBe("");
    expect(directoryCardShareUrl("//evil.example", "https://gittr.space")).toBe(
      ""
    );
  });
});
