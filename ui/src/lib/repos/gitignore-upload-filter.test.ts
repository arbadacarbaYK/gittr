import { describe, expect, it } from "vitest";

import {
  isGitInternalPath,
  isPathGitignored,
  mergeGitignoreBodies,
  parseGitignoreRules,
  splitStagedUploadsByGitignore,
} from "./gitignore-upload-filter";

const rulesFrom = (content: string, dir = "") =>
  parseGitignoreRules(content, dir);

describe("parseGitignoreRules / isPathGitignored", () => {
  it("ignores comments and blank lines", () => {
    const rules = rulesFrom("# comment\n\nnode_modules/\n");
    expect(rules).toHaveLength(1);
  });

  it("matches simple names at any depth", () => {
    const rules = rulesFrom("*.log\n.env\n");
    expect(isPathGitignored("debug.log", rules)).toBe(true);
    expect(isPathGitignored("a/b/debug.log", rules)).toBe(true);
    expect(isPathGitignored(".env", rules)).toBe(true);
    expect(isPathGitignored("config/.env", rules)).toBe(true);
    expect(isPathGitignored("src/main.ts", rules)).toBe(false);
  });

  it("directory patterns ignore everything below", () => {
    const rules = rulesFrom("node_modules/\ndist/\n");
    expect(isPathGitignored("node_modules/react/index.js", rules)).toBe(true);
    expect(isPathGitignored("packages/app/node_modules/x.js", rules)).toBe(
      true
    );
    expect(isPathGitignored("dist/bundle.js", rules)).toBe(true);
    expect(isPathGitignored("distX/bundle.js", rules)).toBe(false);
  });

  it("bare directory name (no trailing slash) also ignores contents", () => {
    const rules = rulesFrom("build\n");
    expect(isPathGitignored("build/out.js", rules)).toBe(true);
    expect(isPathGitignored("a/build/out.js", rules)).toBe(true);
  });

  it("leading slash anchors to the gitignore dir", () => {
    const rules = rulesFrom("/secret.txt\n");
    expect(isPathGitignored("secret.txt", rules)).toBe(true);
    expect(isPathGitignored("sub/secret.txt", rules)).toBe(false);
  });

  it("inner slash anchors too", () => {
    const rules = rulesFrom("docs/tmp\n");
    expect(isPathGitignored("docs/tmp/x.md", rules)).toBe(true);
    expect(isPathGitignored("other/docs/tmp/x.md", rules)).toBe(false);
  });

  it("negation re-includes (last match wins)", () => {
    const rules = rulesFrom("*.log\n!keep.log\n");
    expect(isPathGitignored("debug.log", rules)).toBe(true);
    expect(isPathGitignored("keep.log", rules)).toBe(false);
  });

  it("double-star crosses directories", () => {
    const rules = rulesFrom("**/generated/*.ts\nlogs/**\n");
    expect(isPathGitignored("generated/a.ts", rules)).toBe(true);
    expect(isPathGitignored("src/deep/generated/a.ts", rules)).toBe(true);
    expect(isPathGitignored("logs/x/y.txt", rules)).toBe(true);
  });

  it("nested .gitignore scopes to its directory", () => {
    const rules = rulesFrom("*.tmp\n", "packages/app");
    expect(isPathGitignored("packages/app/cache.tmp", rules)).toBe(true);
    expect(isPathGitignored("packages/app/deep/cache.tmp", rules)).toBe(true);
    expect(isPathGitignored("cache.tmp", rules)).toBe(false);
  });
});

describe("isGitInternalPath", () => {
  it("detects .git internals at any level", () => {
    expect(isGitInternalPath(".git/config")).toBe(true);
    expect(isGitInternalPath("sub/.git/HEAD")).toBe(true);
    expect(isGitInternalPath(".github/workflows/ci.yml")).toBe(false);
    expect(isGitInternalPath(".gitignore")).toBe(false);
  });
});

describe("splitStagedUploadsByGitignore", () => {
  const fakeFile = (content: string): File =>
    ({ text: async () => content } as unknown as File);

  it("skips ignored files, keeps .gitignore itself, drops .git internals", async () => {
    const staged = [
      { path: ".gitignore", file: fakeFile("node_modules/\n.env\n") },
      { path: ".env", file: fakeFile("SECRET=1") },
      { path: "node_modules/x/index.js", file: fakeFile("x") },
      { path: ".git/config", file: fakeFile("[core]") },
      { path: "src/index.ts", file: fakeFile("code") },
    ];
    const { kept, skipped } = await splitStagedUploadsByGitignore(staged);
    expect(kept.map((s) => s.path)).toEqual([".gitignore", "src/index.ts"]);
    expect(skipped.map((s) => s.path).sort()).toEqual([
      ".env",
      ".git/config",
      "node_modules/x/index.js",
    ]);
  });

  it("keeps everything when no .gitignore is present (except .git/)", async () => {
    const staged = [
      { path: "README.md", file: fakeFile("# hi") },
      { path: ".git/HEAD", file: fakeFile("ref") },
    ];
    const { kept, skipped } = await splitStagedUploadsByGitignore(staged);
    expect(kept.map((s) => s.path)).toEqual(["README.md"]);
    expect(skipped.map((s) => s.path)).toEqual([".git/HEAD"]);
  });

  it("applies existing repo .gitignore when the batch has none", async () => {
    const staged = [
      { path: ".env", file: fakeFile("SECRET=1") },
      { path: "src/index.ts", file: fakeFile("code") },
    ];
    const { kept, skipped } = await splitStagedUploadsByGitignore(staged, [
      { path: ".gitignore", content: ".env\n" },
    ]);
    expect(kept.map((s) => s.path)).toEqual(["src/index.ts"]);
    expect(skipped.map((s) => s.path)).toEqual([".env"]);
  });

  it("prefers staged .gitignore over existing for the same path", async () => {
    const staged = [
      { path: ".gitignore", file: fakeFile("# empty — allow .env\n") },
      { path: ".env", file: fakeFile("SECRET=1") },
      { path: "src/index.ts", file: fakeFile("code") },
    ];
    const { kept, skipped } = await splitStagedUploadsByGitignore(staged, [
      { path: ".gitignore", content: ".env\n" },
    ]);
    expect(kept.map((s) => s.path).sort()).toEqual([
      ".env",
      ".gitignore",
      "src/index.ts",
    ]);
    expect(skipped).toEqual([]);
  });
});

describe("mergeGitignoreBodies", () => {
  it("lets staged overwrite existing at the same path", () => {
    const merged = mergeGitignoreBodies(
      [{ path: ".gitignore", content: ".env\n" }],
      [{ path: ".gitignore", content: "*.log\n" }]
    );
    expect(merged).toEqual([{ path: ".gitignore", content: "*.log\n" }]);
  });
});
