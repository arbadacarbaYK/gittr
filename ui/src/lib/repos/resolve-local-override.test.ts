import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  forgetOverrideBlob,
  overrideIdbMarker,
  rememberOverrideBlob,
} from "./overrides-idb";
import {
  mimeForOverrideStorage,
  resolveLocalOverrideBody,
} from "./resolve-local-override";

vi.mock("./storage", () => ({
  loadRepoOverrides: (...args: unknown[]) => mockLoadOverrides(...args),
}));

const mockLoadOverrides = vi.fn(() => ({} as Record<string, string>));

describe("mimeForOverrideStorage", () => {
  it("labels markdown as text/markdown", () => {
    expect(mimeForOverrideStorage("README.md", "file", false)).toBe(
      "text/markdown"
    );
  });

  it("does not force octet-stream on text", () => {
    expect(
      mimeForOverrideStorage("docs/note.txt", "application/octet-stream", false)
    ).toBe("text/plain");
  });
});

describe("resolveLocalOverrideBody", () => {
  beforeEach(() => {
    mockLoadOverrides.mockReset().mockReturnValue({});
    forgetOverrideBlob("npub1abc", "repo");
  });

  it("returns inline override text", async () => {
    mockLoadOverrides.mockReturnValue({ "README.md": "# Hello" });
    await expect(
      resolveLocalOverrideBody("npub1abc", "repo", "README.md")
    ).resolves.toBe("# Hello");
  });

  it("expands IDB markers from memory (never returns the pointer)", async () => {
    const body = "# Big readme\n".repeat(100);
    rememberOverrideBlob("npub1abc", "repo", "README.md", body);
    mockLoadOverrides.mockReturnValue({
      "README.md": overrideIdbMarker("text/markdown"),
    });
    const out = await resolveLocalOverrideBody("npub1abc", "repo", "README.md");
    expect(out).toBe(body);
    expect(out).not.toContain("__gittr_idb__");
  });
});
