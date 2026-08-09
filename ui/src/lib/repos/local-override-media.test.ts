import { beforeEach, describe, expect, it, vi } from "vitest";

const mockLoadOverrides = vi.fn(() => ({} as Record<string, string>));

vi.mock("./storage", () => ({
  loadRepoOverrides: (...args: unknown[]) => mockLoadOverrides(...args),
  isBinaryFile: (path: string) =>
    /\.(gif|png|jpe?g|webp|mp4|pdf)$/i.test(path),
}));

import { localOverrideDisplayUrl } from "./local-override-media";

describe("localOverrideDisplayUrl", () => {
  beforeEach(() => {
    mockLoadOverrides.mockReset().mockReturnValue({});
  });

  it("returns null when no override exists", () => {
    expect(
      localOverrideDisplayUrl("npub1abc", "repo", "assets/old.gif")
    ).toBeNull();
  });

  it("wraps base64 gif override as a data URL", () => {
    mockLoadOverrides.mockReturnValue({
      "assets/demo.gif": "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
    });
    const url = localOverrideDisplayUrl(
      "npub1abc",
      "repo",
      "assets/demo.gif"
    );
    expect(url).toMatch(/^data:image\/gif;base64,/);
    expect(url).toContain("R0lGODlh");
  });

  it("matches ./relative paths to stored override keys", () => {
    mockLoadOverrides.mockReturnValue({
      "docs/shot.png": "iVBORw0KGgo=",
    });
    const url = localOverrideDisplayUrl(
      "npub1abc",
      "repo",
      "./docs/shot.png"
    );
    expect(url).toMatch(/^data:image\/png;base64,/);
  });
});
