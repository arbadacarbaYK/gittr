import { describe, expect, it } from "vitest";

import {
  selectDisplayRepoFileTree,
  shouldDropFlatBasenameForNestedUpload,
} from "./select-display-file-tree";

type E = { path: string; type?: string; content?: string };

function mergeSimple(a: E[], b: E[]): E[] {
  const by = new Map<string, E>();
  for (const row of [...a, ...b]) {
    if (!row.path) continue;
    const prev = by.get(row.path);
    if (!prev) {
      by.set(row.path, row);
      continue;
    }
    const pl = prev.content?.length ?? 0;
    const nl = row.content?.length ?? 0;
    by.set(row.path, nl >= pl ? row : prev);
  }
  return Array.from(by.values());
}

describe("shouldDropFlatBasenameForNestedUpload", () => {
  it("keeps root README when the same batch also uploads nested README", () => {
    const batch = new Set(["README.md", "docs/README.md", "src/a.ts"]);
    expect(
      shouldDropFlatBasenameForNestedUpload(
        "docs/README.md",
        "README.md",
        batch
      )
    ).toBe(false);
  });

  it("drops stale flat basename when only nested path is in the batch", () => {
    const batch = new Set(["docs/README.md"]);
    expect(
      shouldDropFlatBasenameForNestedUpload(
        "docs/README.md",
        "README.md",
        batch
      )
    ).toBe(true);
  });
});

describe("selectDisplayRepoFileTree", () => {
  it("with unpushed edits, keeps local README even when remote tree is shorter", () => {
    const indexed: E[] = [
      { path: "a.ts" },
      { path: "b.ts" },
      { path: "README.md", content: "# new" },
    ];
    const bridge: E[] = [{ path: "a.ts" }, { path: "b.ts" }];
    const out = selectDisplayRepoFileTree({
      indexed,
      bridgeFiles: bridge,
      preferUpstream: true,
      hasUnpushedEdits: true,
      forgeUpstreamAuthoritative: false,
      mergeIndexes: mergeSimple,
    });
    expect(out.map((f) => f.path).sort()).toEqual(
      ["README.md", "a.ts", "b.ts"].sort()
    );
    expect(out.find((f) => f.path === "README.md")?.content).toBe("# new");
  });

  it("without edits picks richest tree (not shortest)", () => {
    const indexed: E[] = [
      { path: "a.ts" },
      { path: "b.ts" },
      { path: "README.md" },
    ];
    const bridge: E[] = [{ path: "a.ts" }, { path: "b.ts" }];
    const out = selectDisplayRepoFileTree({
      indexed,
      bridgeFiles: bridge,
      preferUpstream: true,
      hasUnpushedEdits: false,
      forgeUpstreamAuthoritative: false,
      mergeIndexes: mergeSimple,
    });
    expect(out.map((f) => f.path).sort()).toEqual(
      ["README.md", "a.ts", "b.ts"].sort()
    );
  });

  it("forge authoritative without edits uses upstream listing first", () => {
    const indexed: E[] = [
      { path: "a.ts" },
      { path: "b.ts" },
      { path: "extra.ts" },
    ];
    const repoFiles: E[] = [{ path: "a.ts" }, { path: "b.ts" }];
    const out = selectDisplayRepoFileTree({
      indexed,
      repoFiles,
      preferUpstream: true,
      hasUnpushedEdits: false,
      forgeUpstreamAuthoritative: true,
      mergeIndexes: mergeSimple,
    });
    expect(out.map((f) => f.path).sort()).toEqual(["a.ts", "b.ts"].sort());
  });
});
