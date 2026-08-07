import { describe, expect, it } from "vitest";

// Matching rules unit test (no bare repo required)
describe("listBareRepoTreeLastCommits mapping", () => {
  it("matches files exactly and dirs by prefix", () => {
    const children = [
      { type: "file" as const, path: "README.md" },
      { type: "dir" as const, path: "docs" },
      { type: "file" as const, path: "package.json" },
    ];
    const needed = new Set(children.map((c) => c.path));
    const result: Record<string, string> = {};
    const touchedPaths = ["docs/AGENT.md", "README.md"];
    const commitId = "aaa";
    for (const touched of touchedPaths) {
      for (const child of children) {
        if (!needed.has(child.path)) continue;
        if (child.type === "file") {
          if (touched === child.path) {
            result[child.path] = commitId;
            needed.delete(child.path);
          }
        } else {
          const prefix = `${child.path}/`;
          if (touched === child.path || touched.startsWith(prefix)) {
            result[child.path] = commitId;
            needed.delete(child.path);
          }
        }
      }
    }
    expect(result["README.md"]).toBe("aaa");
    expect(result["docs"]).toBe("aaa");
    expect(result["package.json"]).toBeUndefined();
  });
});
