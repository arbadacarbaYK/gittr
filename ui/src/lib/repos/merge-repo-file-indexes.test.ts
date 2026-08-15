import { describe, expect, it } from "vitest";

import { mergeRepoFileIndexes } from "./merge-repo-file-indexes";

describe("mergeRepoFileIndexes size overlay", () => {
  it("attaches size onto contentful rows that lack size", () => {
    const prev = [
      { path: "README.md", content: "# hi" },
      { path: "src/main.ts", content: "export {}" },
    ];
    const listing = [
      { path: "README.md", size: 4 },
      { path: "src/main.ts", size: 42 },
      { path: "extra.txt", size: 1 },
    ];
    const merged = mergeRepoFileIndexes(prev, listing);
    const readme = merged.find((f) => f.path === "README.md");
    const main = merged.find((f) => f.path === "src/main.ts");
    expect(readme?.content).toBe("# hi");
    expect(readme?.size).toBe(4);
    expect(main?.content).toBe("export {}");
    expect(main?.size).toBe(42);
    expect(merged.some((f) => f.path === "extra.txt")).toBe(true);
  });
});
