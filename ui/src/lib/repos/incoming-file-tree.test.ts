import { describe, expect, it } from "vitest";

import { prepareFetchedFileTree } from "./incoming-file-tree";

describe("prepareFetchedFileTree", () => {
  it("applies a smaller forge listing when local extras are hollow", () => {
    const remote = [
      { path: "README.md", content: "# forge" },
      { path: "index.html" },
    ];
    const local = [
      ...remote,
      { path: "dist/frame-00.png" },
      { path: "dist/frame-33.png" },
    ];
    const r = prepareFetchedFileTree({
      incoming: remote,
      local,
      hasUnpushedEdits: true,
      sourceType: "github",
      sourceUrl: "https://github.com/org/repo",
      incomingBranch: "main",
      activeBranch: "main",
    });
    expect(r.hollowExtrasOnly).toBe(true);
    expect(r.apply).toBe(true);
    expect(r.files.map((f) => f.path).sort()).toEqual([
      "README.md",
      "index.html",
    ]);
  });

  it("keeps real local uploads when a GRASP listing is thinner", () => {
    const remote = [{ path: "README.md" }, { path: "index.html" }];
    const local = [...remote, { path: "docs/notes.md", content: "keep me" }];
    const r = prepareFetchedFileTree({
      incoming: remote,
      local,
      hasUnpushedEdits: true,
      sourceType: "nostr-git",
      sourceUrl: "https://github.com/org/repo",
      incomingBranch: "main",
      activeBranch: "main",
    });
    expect(r.hollowExtrasOnly).toBe(false);
    expect(r.apply).toBe(true);
    expect(r.files.some((f) => f.path === "docs/notes.md")).toBe(true);
    expect(r.files).toHaveLength(3);
  });

  it("does not apply a listing for a different branch", () => {
    const r = prepareFetchedFileTree({
      incoming: [{ path: "README.md" }],
      local: [{ path: "README.md" }, { path: "a.ts", content: "x" }],
      incomingBranch: "dev",
      activeBranch: "main",
    });
    expect(r.apply).toBe(false);
  });

  it("applies master listing when the UI is still on main and local is empty", () => {
    const incoming = [
      { path: "README.md" },
      { path: "package.json" },
      { path: "src/index.ts" },
    ];
    const r = prepareFetchedFileTree({
      incoming,
      local: [],
      incomingBranch: "master",
      activeBranch: "main",
    });
    expect(r.apply).toBe(true);
    expect(r.files).toHaveLength(3);
  });

  it("applies master listing onto an existing main tree of the same size", () => {
    const files = [{ path: "README.md" }, { path: "a.ts", content: "x" }];
    const r = prepareFetchedFileTree({
      incoming: files,
      local: files,
      incomingBranch: "master",
      activeBranch: "main",
    });
    expect(r.apply).toBe(true);
  });
});
