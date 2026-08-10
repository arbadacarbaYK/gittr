import { beforeEach, describe, expect, it, vi } from "vitest";

import { localOverrideDisplayUrl } from "./local-override-media";
import { overrideIdbMarker, rememberOverrideBlob } from "./overrides-idb";

const mockLoadOverrides = vi.fn(() => ({} as Record<string, string>));

vi.mock("./storage", () => ({
  loadRepoOverrides: (...args: unknown[]) => mockLoadOverrides(...args),
  isBinaryFile: (path: string) => /\.(gif|png|jpe?g|webp|mp4|pdf)$/i.test(path),
}));

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
      "assets/demo.gif":
        "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
    });
    const url = localOverrideDisplayUrl("npub1abc", "repo", "assets/demo.gif");
    expect(url).toMatch(/^data:image\/gif;base64,/);
    expect(url).toContain("R0lGODlh");
  });

  it("matches ./relative paths to stored override keys", () => {
    mockLoadOverrides.mockReturnValue({
      "docs/shot.png": "iVBORw0KGgo=",
    });
    const url = localOverrideDisplayUrl("npub1abc", "repo", "./docs/shot.png");
    expect(url).toMatch(/^data:image\/png;base64,/);
  });

  it("resolves IndexedDB markers from memory cache", () => {
    const b64 = "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
    rememberOverrideBlob("npub1abc", "repo", "assets/big.gif", b64);
    mockLoadOverrides.mockReturnValue({
      "assets/big.gif": overrideIdbMarker("image/gif"),
    });
    const url = localOverrideDisplayUrl("npub1abc", "repo", "assets/big.gif");
    expect(url).toMatch(/^data:image\/gif;base64,/);
    expect(url).toContain(b64);
  });

  it("returns UTF-8 for text IDB markers (not data: base64)", () => {
    const md = "# Title\n\nHello";
    rememberOverrideBlob("npub1abc", "repo", "README.md", md);
    mockLoadOverrides.mockReturnValue({
      "README.md": overrideIdbMarker("application/octet-stream"),
    });
    const url = localOverrideDisplayUrl("npub1abc", "repo", "README.md");
    expect(url).toBe(md);
    expect(url).not.toMatch(/^data:/);
  });
});
