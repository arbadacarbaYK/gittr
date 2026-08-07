import { describe, expect, it } from "vitest";

import {
  parseTreeLastCommitLog,
  TREE_LAST_COMMIT_MARKER,
} from "./bare-repo-tree-last-commits";

const children = [
  { type: "file" as const, path: "README.md" },
  { type: "dir" as const, path: "docs" },
  { type: "file" as const, path: "package.json" },
];

const HASH =
  "04a8c01ae73cdad5e7e72eb1aa6993765791ff33";
const HASH2 =
  "aeeea7baa1c1011cd4c2564450c4ed088b84dc4d";

describe("parseTreeLastCommitLog", () => {
  it("maps files exactly and dirs by prefix (marker format)", () => {
    const stdout =
      `${TREE_LAST_COMMIT_MARKER}${HASH}\x1ffeat: reverse lookup\x1farb\x1f1786060000\n` +
      `docs/AGENT.md\n` +
      `README.md\n` +
      `\n` +
      `${TREE_LAST_COMMIT_MARKER}${HASH2}\x1fchore: deps\x1farb\x1f1786050000\n` +
      `package.json\n`;

    const result = parseTreeLastCommitLog(stdout, children);
    expect(result["README.md"]?.id).toBe(HASH);
    expect(result["docs"]?.id).toBe(HASH);
    expect(result["package.json"]?.id).toBe(HASH2);
    expect(result["README.md"]?.timestamp).toBe(1786060000);
  });

  it("regression: %x00 record-split orphans path lines (marker parser is the fix)", () => {
    // Realistic git --format='…%x00' --name-only bytes: NUL ends the pretty
    // line; paths follow on later lines. Splitting the whole stdout on NUL
    // leaves path-only "records" whose first line is a filename — that is what
    // emptied Code-tab timestamps. Marker split does not have that failure.
    const nulSeparated =
      `${HASH}\x1ffeat: reverse lookup\x1farb\x1f1786060000\0` +
      `docs/AGENT.md\n` +
      `README.md\n` +
      `\n` +
      `${HASH2}\x1fchore: deps\x1farb\x1f1786050000\0` +
      `package.json\n`;

    const orphanPathHeaders: string[] = [];
    const nulSplitHits: Record<string, string> = {};
    for (const record of nulSeparated.split("\0").filter((r) => r.trim())) {
      const lines = record.split("\n").map((l) => l.trim()).filter(Boolean);
      const header = lines[0] || "";
      const id = header.split("\x1f")[0] || "";
      if (!/^[0-9a-f]{40}$/i.test(id)) {
        orphanPathHeaders.push(header);
        continue;
      }
      // Header-only records after NUL: paths lived in the *next* chunk → miss.
      for (let i = 1; i < lines.length; i++) {
        const p = lines[i]!;
        if (children.some((c) => c.path === p)) nulSplitHits[p] = id;
      }
    }
    expect(orphanPathHeaders).toContain("docs/AGENT.md");
    expect(nulSplitHits["README.md"]).toBeUndefined();
    expect(nulSplitHits["package.json"]).toBeUndefined();

    // Same bytes with the production marker format → full map
    const marked =
      `${TREE_LAST_COMMIT_MARKER}${HASH}\x1ffeat: reverse lookup\x1farb\x1f1786060000\n` +
      `docs/AGENT.md\n` +
      `README.md\n` +
      `\n` +
      `${TREE_LAST_COMMIT_MARKER}${HASH2}\x1fchore: deps\x1farb\x1f1786050000\n` +
      `package.json\n`;
    const result = parseTreeLastCommitLog(marked, children);
    expect(result["README.md"]?.id).toBe(HASH);
    expect(result["docs"]?.id).toBe(HASH);
    expect(result["package.json"]?.id).toBe(HASH2);
  });

  it("skips invalid headers and keeps going", () => {
    const stdout =
      `${TREE_LAST_COMMIT_MARKER}not-a-hash\x1fx\x1fy\x1f1\nREADME.md\n` +
      `${TREE_LAST_COMMIT_MARKER}${HASH}\x1fok\x1farb\x1f1786060000\nREADME.md\n`;
    const result = parseTreeLastCommitLog(stdout, children);
    expect(result["README.md"]?.id).toBe(HASH);
  });
});
