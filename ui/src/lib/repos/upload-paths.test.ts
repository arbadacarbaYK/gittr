import {
  mergeStagedUploads,
  pathFromUploadFile,
} from "@/lib/repos/upload-paths";

import { describe, expect, it } from "vitest";

function fakeFile(name: string, relativePath?: string): File {
  const file = new File(["x"], name, { type: "text/plain" });
  if (relativePath) {
    Object.defineProperty(file, "webkitRelativePath", {
      value: relativePath,
      configurable: true,
    });
  }
  return file;
}

describe("upload-paths", () => {
  it("uses webkitRelativePath when present", () => {
    const file = fakeFile("page.tsx", "src/app/page.tsx");
    expect(pathFromUploadFile(file)).toBe("src/app/page.tsx");
  });

  it("falls back to basename", () => {
    expect(pathFromUploadFile(fakeFile("README.md"))).toBe("README.md");
  });

  it("strips leading slashes", () => {
    const file = fakeFile("a.ts", "/nested/a.ts");
    expect(pathFromUploadFile(file)).toBe("nested/a.ts");
  });

  it("merges by path and sorts", () => {
    const a = {
      file: fakeFile("a.ts", "b/a.ts"),
      path: "b/a.ts",
    };
    const b = {
      file: fakeFile("z.ts", "a/z.ts"),
      path: "a/z.ts",
    };
    const replaced = {
      file: fakeFile("a2.ts", "b/a.ts"),
      path: "b/a.ts",
    };
    const merged = mergeStagedUploads([a], [b, replaced]);
    expect(merged.map((m) => m.path)).toEqual(["a/z.ts", "b/a.ts"]);
    expect(merged[1]?.file.name).toBe("a2.ts");
  });
});
